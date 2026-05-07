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
