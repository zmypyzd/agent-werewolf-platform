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
3. **Environment**: add the three Supabase keys + any operational toggles:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
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

## 3. Deploy the SPA to Vercel

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
| `/api/v1/werewolf/wait` returns 404 | bundle.mailbox didn't initialize — check Render logs for Supabase connect errors at boot |
| SSE `/werewolf/stream/<id>` immediately closes | Vercel cold-start; first hit re-opens. Check `Cache-Control` and `X-Accel-Buffering` headers (`vercel.json` sets them, but a custom proxy in front would need to too) |
| Cookie auth fails on Vercel-hosted UI | Browser SameSite=Lax cookies don't cross sites. Either use Vercel rewrites (recommended) or switch to `SameSite=None; Secure` (split-origin path). |
| `pnpm install` fails on Render Docker build | better-sqlite3 needs `python3 / make / g++` — Dockerfile installs them in the base stage; deleting that line will break the build |

## 6. What's not covered yet (Phase 4.5+)

- **Sentry / observability** — deferred to Phase 3 (orchestrator process split)
- **CORS plugin** — deferred until split-origin deploy is needed
- **Render Blueprint (`render.yaml`)** — provision via UI for now; the
  Blueprint format is a follow-up so the whole environment is
  reproducible from the repo
- **Vercel Cron** for `expire_old_werewolf_decision_requests` —
  currently relies on RPC being called manually; Phase 4.5 will wire
  a Vercel-cron-triggered route
