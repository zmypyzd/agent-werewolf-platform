# TODOS

Cross-PR follow-ups. Each item should have enough context that someone picking it up in 3 months understands the motivation, current state, and starting point.

---

## supportedGames capability on UserAgentConfig — DEFERRED to Phase 2 auth migration

**What:** Add `supportedGames: GameType[]` field so an agent built for one game can't be seated in another. Original plan: SQLite + Zod + CRUD + UI + seat-time validation in both poker and werewolf routes.

**Why deferred (re-evaluated 2026-05-09, partially advanced post-merge of Stage 2 JWT migration):**

Stage 2 of the auth migration (PR #2, merged 2026-05-09) moved `/me/agents` and
`/agents/invites` to JWT + Postgres. The remaining cookie/SQLite routes are
poker tables, werewolf-games, simulate, and auth itself. Updated table:

| Path | Store | Protocol | Auth |
|---|---|---|---|
| `/me/agents` (CRUD) | Postgres `agents` ✅ | HTTP webhook | JWT ✅ |
| `/agents/invites/*` (manage) + `/agents/invites/:token/register` (public) | Postgres `agents` + `agent_invites` ✅ | HTTP | JWT (mgmt) / public (register) ✅ |
| `/me/werewolf-agents` (CRUD) | Postgres `agents` ✅ | Longpoll only | Cookie (legacy) |
| `/tables/:id/seats/agent` (poker seat) | SQLite `user_agent_configs` (legacy) | HTTP | Cookie (legacy) |
| `/werewolf-games/:id/seats/:idx/invite-agent` (werewolf seat) | SQLite `user_agent_configs` (legacy) | HTTP | Cookie (legacy) |

The seat-time routes are the load-bearing case for `supportedGames` and they
still read SQLite. Building `supportedGames` on SQLite now and re-doing it
when those routes flip to Postgres is the same waste the original deferral
called out — the call is unchanged.

The cross-game seating bug is real (werewolf invite-agent uses the SQLite store with no game-type guard, so a poker-shaped HTTP agent seated in werewolf gets `WerewolfDecisionRequest` payloads and Zod-fails into the fallback path), but:

1. **Architecture conflict:** investing `supportedGames` into SQLite means redoing it on Postgres at Phase 2. Best done in the Phase 2 PR where the Postgres `agents` table is already being reshaped.
2. **No user pressure:** zero reports of mis-seated agents on production.
3. **Migration runner missing:** SQLite connector at `connection.ts:13-20` only loads `schema.sql` (with `IF NOT EXISTS` guards); the `migrations/` dir is orphaned. Adding a column means either building a migration runner first (independent work) or hacking the schema file (dirty — SQLite has poor `ALTER TABLE` support for default values on existing rows).
4. **Realistic effort:** ~9-10 files, 280-350 lines (TODO originally estimated 5 files — undercounted the migration runner and UI work).
5. **Failure mode is non-fatal:** mis-seated agent gets fallback random actions, match completes, the agent operator sees confused behavior in their endpoint logs.

**Trigger for revival (any of):**
- First user report of seating a poker-shaped agent in werewolf (or vice versa) and being confused
- The Phase 2 auth migration begins (then bundle `supportedGames` into the Postgres `agents` reshape — single PR, no SQLite waste)
- A third game lands (poker + werewolf + X) — capability gating becomes load-bearing

**Cheaper interim mitigation (not yet shipped):** instead of a schema field, the orchestrator could log a warning when an agent returns invalid actions in N consecutive decisions, naming the likely shape mismatch. ~10 lines, no migration. File a separate small TODO if the user friction shows up.

**Starting point (when revived):** prefer working on the Postgres `agents` table (`packages/persistence/src/postgres/postgres-agent-store.ts:33`) rather than the SQLite path. Add `supportedGames` to `AgentRecord` + `NewAgent` + `PatchAgent`, plumb through the SQL schema, and gate at both seat routes. SQLite path can be removed entirely once Phase 2 auth lands.

---

## ~~Backfill phase metadata in werewolf lobby projection~~ — SHIPPED 2026-05-09

Shipped in `f4b26d0` (backend) + `97f8210` (frontend). The lobby endpoint
now carries `currentPhase` / `dayNumber` / `nightNumber` for running and
completed games; the reducer applies them on lobby-sync only while local
phase is at its initial value, so SSE updates can't be stomped by stale
polls. Pre-start isolation pinned in `werewolf-games-info-isolation.test.ts`.
Verified on `agent-werewolf-platform.vercel.app` — anon hard-reload of a
running match paints the precise day/night reading from t=0.

The FE running-unknown-phase fallback in
`apps/web/src/werewolf-room/WerewolfPhaseIndicator.tsx` stays in place as
defense-in-depth (server restart, transient races between SSE and the
first lobby poll).
