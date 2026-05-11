# Werewolf Platform — Deployment Guide

This guide covers the recommended Phase 4 deployment topology for the
werewolf module: **Render-hosted API + Vercel-hosted SPA + Supabase
managed Postgres**.

## Architecture overview

```
                 ┌──────────────────────────┐
                 │          User            │
                 └────────────┬─────────────┘
                              │ HTTPS
                              ▼
                 ┌──────────────────────────┐
                 │   Vercel (apps/web)      │
                 │   Static SPA + edge      │
                 │   rewrites /api → API    │
                 └────────────┬─────────────┘
                              │ rewrite (same-origin to browser)
                              ▼
                 ┌──────────────────────────┐
                 │   Render (apps/api)      │
                 │   Long-lived Fastify     │
                 │   • REST routes          │
                 │   • SSE /werewolf/stream │
                 │   • mailbox /wait /action│
                 │   • orchestrator (in-proc│
                 │     until Phase 3)       │
                 └────────────┬─────────────┘
                              │
                              ▼
                 ┌──────────────────────────┐
                 │   Supabase (Postgres)    │
                 │   • agents / invites     │
                 │   • mailbox tables       │
                 │   • match artifacts      │
                 └──────────────────────────┘
```

The Vercel rewrites are crucial: they keep the SPA's API calls
**same-origin** from the browser's perspective, which sidesteps CORS
and cross-site cookie configuration entirely. The browser sees one
origin (`app.example.com`); Vercel transparently proxies `/api/*` and
`/ws` to the Render-hosted API.

## Prerequisites

- Render account (or Fly.io, Railway, etc. — any Docker-compatible host)
- Vercel account
- Supabase project (free tier is enough for staging)
- Domain name(s); not strictly required, but helpful for cookies

## 1. Provision Supabase

```bash
# Apply the schema migrations.
supabase link --project-ref <ref>
supabase db push
```

Migrations land under `supabase/migrations/` — they're committed to
the repo. After `db push`, capture three values from the project's
**API settings** page:

- `SUPABASE_URL` — `https://<ref>.supabase.co`
- `SUPABASE_ANON_KEY` — public, safe to ship to the browser
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, server-only

## 2. Deploy the API to Render

Push the repo to GitHub. In Render:

1. **New → Web Service → Build from Dockerfile**
2. Set **Dockerfile path**: `./Dockerfile`
3. **Environment**: add the Supabase keys + any operational toggles:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — server-side only
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — mirror the first two so the
     Vite SPA build inlines them. Required if you bundle the SPA into the API
     container (see Section 2.5 below). Only the anon key reaches the browser;
     the service-role key never does.
   - `NODE_ENV=production`
   - `WEREWOLF_BRIEFING_ENABLED=1` (optional)
4. **Health check path**: `/health` (Dockerfile already wires the same
   endpoint; Render's external check confirms the deploy is live).
5. **Auto-deploy**: enable for the `main` branch.

Render injects `$PORT`; the Fastify boot in `apps/api/src/index.ts`
reads it. The Dockerfile's `EXPOSE 3000` is just metadata — Render
doesn't require it to match.

After the first deploy, capture the public URL Render assigns
(e.g. `https://werewolf-api-abc.onrender.com`). This becomes the
`API_HOST` env on Vercel below.

### Smoke check the API

```bash
curl -s https://<render-host>/health | jq
# { "data": { "status": "ok", "uptimeMs": ..., "version": "0.1.0" } }

curl -s https://<render-host>/api/v1/werewolf/wait
# 401 — proves the mailbox routes are wired and rejecting unauthed
# requests.
```

If `Werewolf storage:` in the boot log says `in-memory (SQLite for
auth)`, the Supabase env triple isn't being read — re-check the env
panel.

## 2.5. (Alternative) Bundle the SPA into the API container

Stage 1 of the external-contributor-invite work (PR #2) added a web build stage to
the Dockerfile. With it, the Render container serves both the SPA at `/` and the
API at `/api/v1/*` from the same origin. This removes the need for Vercel rewrites
or Vercel-hosted SPA hosting entirely:

- **Browser → Render directly.** Same origin, no CORS, no Vercel proxy hop.
- **Single artifact.** One image, one deploy, one URL.
- **Trade-off.** You lose Vercel's edge CDN for static assets — fine for staging
  and small-team production; revisit if cold-start CDN matters.

To use this path:

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on Render (see Section 2
   step 3). The Dockerfile passes these as `--build-arg` to the web build stage,
   and Vite inlines them into the SPA bundle.
2. Set `PUBLIC_DIR=apps/api/public` on Render (the runner stage `COPY`s
   `apps/web/dist` there). Default in `apps/api/src/index.ts` is the same path,
   so this env var is only needed if you override.
3. Confirm the API boot log shows `Werewolf storage: Postgres (Supabase)` and
   `curl https://<host>/` returns `<html>...<title>Agent Poker</title>...`.

Skip Section 3 entirely if you take this path.

## 3. (Alternative) Deploy the SPA to Vercel

```bash
vercel --prod
```

Or via the dashboard: import the repo, set:

- **Root Directory**: `.` (vercel.json at repo root coordinates the build)
- **Build Command**: configured in `vercel.json`, leave blank in UI
- **Output Directory**: configured in `vercel.json`, leave blank in UI
- **Install Command**: configured in `vercel.json`, leave blank in UI
- **Environment Variables**:
  - `API_HOST` = the Render hostname **without `https://`** (e.g.
    `werewolf-api-abc.onrender.com`). Vercel substitutes this into
    the rewrite rules at deploy time.

`vercel.json` declares two rewrites:

- `/api/*` → `https://$API_HOST/api/*`
- `/ws` → `https://$API_HOST/ws` (Vercel does not support WebSocket
  rewrites; this rewrite is reserved for HTTP/2 + a future SSE-only
  refactor — see Phase 5)

Plus a SPA fallback: anything that isn't `/api`, `/ws`, or `/assets/*`
rewrites to `/index.html` so React Router handles the URL.

### Smoke check the SPA

Visit the Vercel-assigned URL. The lobby should load. Open dev tools:
- `GET /api/v1/health` returns 200 (proxied through to Render)
- `GET /api/v1/werewolf/stream/<gameId>` opens an `EventStream` connection
  (will be an empty stream if no match is running)

## 4. Optional: split-origin deploy (no Vercel rewrites)

For deployments where the SPA and API live on different origins **and
you don't want to use Vercel rewrites** (e.g. self-hosted SPA, or
operating in a region Vercel doesn't cover):

1. Set `VITE_API_BASE_URL=https://api.example.com` at SPA build time
   (e.g. `apps/web/.env.production`).
2. Add a CORS plugin to the Fastify server allowing the SPA origin
   (Phase 4.5 — not yet wired in code).
3. Configure session cookies with `SameSite=None; Secure` so the
   browser sends them on cross-site requests.

This path is supported by code (`VITE_API_BASE_URL` is honored, see
`apps/web/src/lib/api.ts`) but operationally heavier than the
recommended same-origin-via-rewrites topology.

## 5. Common operational checks

| Symptom | Likely cause |
|---|---|
| Boot log says SQLite, not Postgres | One of the SUPABASE_* env vars is missing on Render |
| Boot fails with `SUPABASE_SERVICE_ROLE_KEY carries role="anon"` | The anon key was placed in the service-role slot. Re-copy from Supabase → Project Settings → API. |
| `permission denied for table werewolf_*` at runtime | `service_role` is missing GRANTs on the werewolf tables. Apply `supabase/migrations/20260508030000_werewolf_service_role_grants.sql` via `supabase db push`. |
| `/api/v1/werewolf/wait` returns 404 | bundle.mailbox didn't initialize — check Render logs for Supabase connect errors at boot |
| SSE `/werewolf/stream/<id>` immediately closes | Vercel cold-start; first hit re-opens. Check `Cache-Control` and `X-Accel-Buffering` headers (`vercel.json` sets them, but a custom proxy in front would need to too) |
| Cookie auth fails on Vercel-hosted UI | Browser SameSite=Lax cookies don't cross sites. Either use Vercel rewrites (recommended) or switch to `SameSite=None; Secure` (split-origin path). |
| `pnpm install` fails on Render Docker build | better-sqlite3 needs `python3 / make / g++` — Dockerfile installs them in the base stage; deleting that line will break the build |
| Container starts then crashes with `WebSocketFactory.getWebSocketConstructor` | Node 20 has no global WebSocket; `@supabase/supabase-js` ≥2.45 initializes RealtimeClient eagerly inside `createClient()`. Any code path that constructs a Supabase client must pass `realtime: { transport: WebSocket }` from the `ws` package. See `packages/auth/src/auth-service.ts` and `packages/persistence/src/postgres/supabase-clients.ts`. |
| `registerUrl` / `redirect_uri` returns `http://` instead of `https://` on Render | Render terminates TLS at the load balancer and forwards plain HTTP to the container. Fastify must be constructed with `{ trustProxy: true }` so `req.protocol` and `req.hostname` honor `X-Forwarded-Proto` and `X-Forwarded-Host`. See `apps/api/src/server.ts:172`. |
| Postgres `permission denied for table agents` / `agent_invites` / `profiles` | `service_role` is missing GRANTs on the agent tables. Apply `supabase/migrations/20260509000000_agent_service_role_grants.sql` via `supabase db push`. |

## 5.5. Production storage map — what survives a restart

Render's **free tier does not support persistent disks**
(https://render.com/docs/disks#which-plans-support-disks). The
container's filesystem is ephemeral — every deploy and every idle
spin-down (free tier sleeps after 15 minutes of no traffic) wipes any
SQLite database that lives inside it. The platform deliberately keeps
**all werewolf hot-path data in Supabase Postgres** so this only
affects vestigial / legacy paths.

What follows a restart:

| Data | Storage | Survives restart? |
|---|---|---|
| Werewolf agents (created via `POST /agents/invites/<token>/register`) | Postgres `public.agents` | ✓ |
| Werewolf agent invites | Postgres `public.agent_invites` | ✓ |
| Werewolf matches + replay events + decision traces + mailbox | Postgres `werewolf_*` tables | ✓ |
| Supabase Auth users + their JWTs | Supabase Auth | ✓ |
| `agent.status:<id>` realtime pub/sub state | In-memory `AgentConnectionRegistry` only — events are transient (REST `/me/werewolf-agents` provides the current snapshot) | n/a (event stream, not state) |
| Legacy cookie-session users (SQLite `users`) | In-container SQLite (`:memory:` on Render free tier) | ✗ |
| Legacy cookie sessions (SQLite `sessions`) | Same | ✗ |
| Legacy SQLite `user_agent_configs` | Same | ✗ |
| Poker `tables` + `hands` | Same | ✗ |

For the werewolf user flow that's the primary product target today
(Supabase Auth login → register agent via invite → seat in match), the
restart cost is **zero**. The legacy SQLite-only paths are unaffected
**only because nobody actively uses them**; if poker or cookie-session
auth becomes a hot path again, this caveat upgrades from "live with
it" to "must fix."

To eliminate the caveat:

- **Simplest** — upgrade the Render service to **Starter ($7/mo)**,
  attach a 1GB disk at `/var/data`, and set the env var
  `DATABASE_PATH=/var/data/auth.db` on the service. `openDatabase()`
  in `packages/persistence/src/sqlite/connection.ts` already reads
  `process.env.DATABASE_PATH`, so no code change is required. The same
  upgrade also removes the 15-minute idle spin-down — which is a
  bigger perceived-latency win than SQLite persistence on its own
  (cold-start adds ~30s to whichever request happens to wake the
  container, including the first agent invite of a session).

- **No code, no money** — migrate the remaining SQLite tables
  (users, sessions, user_agent_configs, tables, hands) to Postgres
  and remove the SQLite path entirely. The auth side already has
  `SupabaseAuthService` and Supabase Auth as the production identity
  source, so the legacy cookie-session path is the main thing to
  retire. Estimated 1–2 days of refactor; out of scope for any of the
  P0–P3 commits in this PR chain.

## 6. What's not covered yet (Phase 4.5+)

- **Sentry / observability** — deferred to Phase 3 (orchestrator process split)
- **CORS plugin** — deferred until split-origin deploy is needed
- **Render Blueprint (`render.yaml`)** — provision via UI for now; the
  Blueprint format is a follow-up so the whole environment is
  reproducible from the repo
- **Vercel Cron** for `expire_old_werewolf_decision_requests` —
  currently relies on RPC being called manually; Phase 4.5 will wire
  a Vercel-cron-triggered route
