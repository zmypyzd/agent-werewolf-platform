# TODOS

Cross-PR follow-ups. Each item should have enough context that someone picking it up in 3 months understands the motivation, current state, and starting point.

---

## supportedGames capability on UserAgentConfig

**What:** Add `supportedGames: GameType[]` field to `UserAgentConfig` (SQLite + Zod + CRUD + UI). Validate at seat time so an agent built for one game can't be seated in another.

**Why:** Today an HTTP endpoint is a black box — poker orchestrator sends `AgentDecisionRequest`, werewolf sends `WerewolfDecisionRequest` (different Zod shapes). If a poker-only agent is seated in werewolf, the failure manifests at first decision via Zod parse error, not at seat time. Bad UX, not unsafe.

**Pros:**
- Fail-fast at seat time ("this agent doesn't support werewolf, pick another")
- capability-aware multi-game architecture; cleaner extension when a 3rd game lands
- mirror of how marketplaces typically gate compatibility

**Cons:**
- SQLite migration + backfill `['poker']` for existing rows
- Zod schema + CRUD route updates (POST/PATCH /me/agents)
- UI filter on agent picker
- seat-time validation in both poker and werewolf seat routes
- ~5 additional files touched

**Context:** Decided to defer in the werewolf-agent-seating PR (D4=B in the plan-eng-review on 2026-05-07). At that PR's scope (~5 files for the core feature), bundling this would have ~doubled diff size and crossed scope boundary. Trigger for revival: first user report of seating a poker-only agent in werewolf and getting a confusing match-start failure.

**Depends on:** werewolf-agent-seating PR landing first (current scope, branch main).

**Starting point:** `packages/persistence/src/store-interface.ts:62` (UserAgentConfig type), `packages/persistence/src/sqlite/sqlite-user-agent-config-store.ts` (schema), `apps/api/src/routes/me-agents.ts` (CRUD + Zod), `apps/api/src/routes/tables.ts:310-348` (poker seat-time validation point), the new `werewolf-games.ts` invite-agent route (werewolf seat-time validation point).

---

## Backfill phase metadata in werewolf lobby projection

**What:** Include `currentPhase`, `dayNumber`, `nightNumber` in the
`GET /api/v1/werewolf-games/:id` response when `status === 'running'` /
`'completed'`, and read them in `werewolfRoomReducer` lobby-sync.

**Why:** Late-joining or reloading spectators see real events scrolling
in the timeline but the phase indicator can only say "对局进行中 / GAME
IN PROGRESS" until the next `phase.changed` event lands (which on a
slow night phase can be 10–20s of dead air). The poll already carries
seat alive/role state for this exact reason — phase metadata is the
last missing piece.

**Context:** Found by /qa on 2026-05-09 against
`agent-werewolf-platform.vercel.app`. The user-visible bug
("WAITING FOR PLAYERS" on a running match) was patched at the FE in
commit `8726ed8` with a generic fallback. This TODO is the proper
upstream fix that gives the precise reading.

**Why deferred from the QA fix:** Commit `8726ed8` is FE-only and
zero-risk. Backfilling phase requires touching the registry's
`InternalEntry` (track current phase from `phase.changed`),
`publicEntry()` projection, the lobby-sync reducer path, and probably
a regression test on `werewolf-games-info-isolation.test.ts` to confirm
the new fields don't leak pre-start. Right size for a small follow-up
PR, wrong size for a same-day QA fix.

**Starting point:** `apps/api/src/werewolf-lobby-registry.ts:204-235`
(`publicEntry`), `:440-468` (`start()` — already subscribes to
`phase.changed` for deaths, can reuse the same subscription),
`apps/web/src/werewolf-room/werewolfRoomReducer.ts:107-180`
(`lobby-sync` handler), `apps/web/src/werewolf-room/WerewolfPhaseIndicator.tsx`
(remove the "running unknown phase" fallback once the data is
authoritative).
