# Werewolf Plan 4b + 4c — Scope Sketch (not yet executable)

> Companion to `2026-05-05-werewolf-plan-4a-persistence-and-projection.md`. The 4a plan is fully fleshed out and ready for `superpowers:subagent-driven-development`. This document is **not** an executable plan — it's a scope agreement so the user and the next planner know what 4b and 4c will own. Each sub-plan will be written in full TDD detail after 4a lands and we can pin against its actual interfaces.

---

## Plan 4b — API Routes + Realtime Hub Integration

**Goal:** Expose the werewolf match artifacts (built in 4a) over HTTP and WebSocket. Make a running match observable in real time without breaking the information-isolation invariants 4a established.

**Depends on:** Plan 4a (interfaces + redaction primitives must exist).

**Owns these deferred items:**
- Item 5 — `apps/api` read-only werewolf routes
- Item 6 — RealtimeHub integration
- Item 7 (cont.) — TTL cleanup attached to a runtime scheduler

**Files (anticipated):**
- New: `apps/api/src/werewolf-match-artifact-store-factory.ts` (env: `WEREWOLF_MATCH_ARTIFACT_STORE`, `WEREWOLF_MATCH_ARTIFACT_BASE_DIR`)
- New: `apps/api/src/routes/werewolf-matches.ts` — `GET /werewolf-matches`, `GET /werewolf-matches/:id`, `/:id/replay`, `/:id/decision-trace`
- New: `packages/werewolf-orchestrator/src/hub-integration.ts` — `attachWerewolfHub(orchestrator, hub, { topicFor })`. Subscribes to the orchestrator's emitter, runs each event through `replayEventToPublic`, and publishes:
    - `match:<gameId>` (public, all spectators)
    - `player:<userId>:<gameId>` (private, the seated player only — carries `WerewolfPrivateState` snapshots)
- New: `packages/werewolf-orchestrator/src/match-ttl-cleaner.ts` — opt-in scheduler that calls `deleteMatch` for completed matches older than N minutes
- Modify: `apps/api/src/server.ts` — wire werewolf store, attach hub, register routes
- Modify: `apps/api/src/routes/ws.ts` — handle `match:` and `player:` topic prefixes (server-side enforcement that clients can't subscribe to other users' player topics, identical to poker's seat-topic gate)
- Modify: `packages/realtime/src/wire.ts` — add `werewolfMatchTopic(gameId)` and `werewolfPlayerTopic(userId, gameId)` helpers

**Public projection contracts (locked by tests):**
- `GET /api/v1/werewolf-matches` returns the index without `seed`
- `GET /api/v1/werewolf-matches/:id` returns manifest + summary, no `seed`, no `files` block
- `GET /api/v1/werewolf-matches/:id/replay` returns events that have already been filtered by `replayEventToPublic` at *persistence time* (4a guarantees this), so this route is a passthrough
- `GET /api/v1/werewolf-matches/:id/decision-trace` strips `privateStateHash` and `reasoningSummary` from each trace
- WS: a connection authenticated as `userId` only sees `player:<userId>:<gameId>` events for matches where it's been registered as that player. Server-side gate; client subscriptions to `player:*` are rejected unless the userId matches.

**Non-goals (still deferred):** WerewolfHttpAgentAdapter, demo, analysis summary, decision-trace search/filter API.

**Estimated tasks:** 10–12.

---

## Plan 4c — End-to-End Demo + Real Adapters

**Goal:** Drive a full 9-AI werewolf match end-to-end through the API and WebSocket, with real `WerewolfHttpAgentAdapter` instances. Produces a reproducible local demo and a Vitest E2E suite.

**Depends on:** Plans 4a + 4b.

**Owns these deferred items:**
- Item 4 (cont.) — real `WerewolfHttpAgentAdapter` (and a stub `WerewolfWsAgentAdapter` with NotImplementedError parity to poker)
- The example app (`examples/werewolf-local-simulation`) and related docs
- Optional: `MatchAnalysisSummary`-equivalent for werewolf (per-agent latency / fallback / role distribution stats) so the artifact has analysis parity with poker

**Files (anticipated):**
- New: `packages/agent-runtime/src/werewolf-http-agent-adapter.ts` — implements `IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>`, validates response with `WerewolfDecisionResponseSchema`, AbortController-driven timeout
- New: `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts` — stub via `NotImplementedError` (parity with poker's `WsAgentAdapter`); a real implementation can land later
- New: `examples/werewolf-local-simulation/`
    - `index.ts` — boots the API server in-process, creates a 9-AI match using `WerewolfRandomMockAgent`s through the public HTTP path, writes per-match artifacts to `examples/werewolf-local-simulation/output/`
    - `package.json`, `tsconfig.json`, `README.md`
- New: E2E test `packages/werewolf-orchestrator/src/__tests__/werewolf-e2e.test.ts` (or alongside the API) that:
    1. Starts an in-process API server with `MemoryWerewolfMatchArtifactStore`
    2. Subscribes a WS client to a `match:<gameId>` topic
    3. Drives 9 mock-agent HTTP servers
    4. Runs the match via the orchestrator
    5. Asserts: WS observed N public events; private night actions never leaked actor identity to the public WS topic; persisted artifact matches the live event stream (after public filtering)
- New / Modify: `examples/werewolf-local-simulation/output/.gitignore` (`*.json`, `*.jsonl`)
- Modify: `pnpm` workspace `package.json` — add `pnpm demo:werewolf` script

**Documentation:**
- Add a `docs/agent-poker-werewolf-platform-overview.md` or similar (lighter than poker's full spec — the engine + protocol docs already exist)
- Update `CLAUDE.md` to include werewolf demo commands alongside `pnpm demo`

**Estimated tasks:** 6–8.

---

## Sequencing & integration test strategy

- **4a → 4b → 4c**: each one's tests can be green without the next one existing.
- **No flaky network in tests**: 4c's E2E test uses an in-process Fastify instance and `WerewolfRandomMockAgent` over `localhost`. No external HTTP calls.
- **Reproducibility**: every demo run uses a fixed seed; seeds plus seat order plus `WerewolfRandomMockAgent` seeds determine the entire match transcript. The artifact-stored `replayEventCount` and `stepCount` should match across runs.

## When to write the full 4b plan

Write 4b in full TDD detail once Plan 4a is committed and CI is green. The exact constructor signature of `WerewolfOrchestrator` (which 4b extends with hub attachment) will be locked by 4a's commits, so 4b's tasks can name file paths and method signatures with no guesswork.
