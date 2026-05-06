# Werewolf Platform Overview

Companion to the poker platform docs. The werewolf system reuses the
same monorepo, the same dependency DAG, and the same realtime hub +
artifact-store machinery. This doc collects the werewolf-specific
pieces in one place.

## Component layering

```
shared (types: WerewolfGameState, WerewolfPublicState, WerewolfPrivateState,
        WerewolfReplayEvent, WerewolfDecisionTrace, AppError)
   │
   ├── agent-protocol (Zod: WerewolfDecisionRequestSchema, WerewolfDecisionResponseSchema)
   │
   ├── werewolf-engine (pure reducer: createGame, applyAction,
   │                    getPublicState, getPrivateState, getValidActions)
   │
   ├── agent-runtime (IAgent, TimeoutHandler, WerewolfRandomMockAgent,
   │                  WerewolfMockAgent, WerewolfHttpAgentAdapter,
   │                  WerewolfWsAgentAdapter)
   │
   ├── persistence (WerewolfMatchArtifactStore, WerewolfDecisionTraceStore;
   │                Memory + Object/File backends)
   │
   ├── realtime (RealtimeHub; werewolfMatchTopic, werewolfPlayerTopic;
   │             werewolfReplayEventToPublic redaction)
   │
   └── werewolf-orchestrator (WerewolfMatchRunner, WerewolfOrchestrator,
                              attachWerewolfHub, WerewolfMatchTtlCleaner)
```

`apps/api` consumes all of the above; `examples/werewolf-local-simulation`
drives the orchestrator through the real HTTP path.

## Information-isolation invariants

The werewolf domain is much stricter than poker about hidden information.
Five protected points, each defended by ≥2 layers and pinned by tests:

1. **Night actor identity** — `agent.action_requested` / `agent.action_received`
   replay events in night phases must not include `playerId` or `agentId`.
   Defended by: `werewolfReplayEventToPublic` (filters before persistence
   and before WS publish) + `attachWerewolfHub` (publishes only the public
   projection).
2. **Match seed** — never appears on `match.started` events that reach
   spectators or in `/api/v1/werewolf-matches/:id` responses. Defended by:
   `werewolfReplayEventToPublic` + `apps/api/src/routes/werewolf-matches.ts`
   stripping `seed` from summary + manifest's `files` block.
3. **`speak` action `inner` field** — agent's private rationale for the
   public speech. Stripped from the public `speak` replay event. Defended
   by: `sanitizeActionForBroadcast` + `werewolfReplayEventToPublic`.
4. **Decision trace `privateStateHash` + `reasoningSummary`** — persist
   for analysis but never serve over the public route. Defended by: type
   layer (`WerewolfDecisionTrace` carries them; the route's
   `PublicWerewolfDecisionTrace` Omit drops them) + the route's
   destructure-and-spread in `apps/api/src/routes/werewolf-matches.ts`.
5. **`player:<userId>:<gameId>` topic** — server-side gate in
   `apps/api/src/routes/ws.ts:isOwnPlayerTopic` (subscribe-time) +
   per-player ownership map in `attachWerewolfHub` (publish-time).

## Runtime data flow (one decision)

```
WerewolfOrchestrator.runMatch
  → WerewolfMatchRunner.run loop
    → engine.getValidActions(state, playerId)
    → buildWerewolfDecisionRequest(...)              (agent-runtime)
    → TimeoutHandler<…>(adapter, timeoutMs, werewolfFallback).requestDecision
        → WerewolfHttpAgentAdapter.requestDecision   (POSTs over HTTP, validates response)
    → validateWerewolfAction(state, response.action) (action-validator)
    → engine.applyAction(state, action)
    → emit WerewolfReplayEvent to orchestrator's emitter
        → attachWerewolfHub forwards public projection to RealtimeHub
        → match-runner's on('replay-event', …) buffers for persistence
    → emit private-state event for the next actor
        → attachWerewolfHub forwards to player:<userId>:<gameId>
  → at game-over: orchestrator persists the artifact via
    IWerewolfMatchArtifactStore.saveMatchArtifact
```

## Local demo

```bash
pnpm install
pnpm demo:werewolf
```

What it does (`examples/werewolf-local-simulation/index.ts`):

1. Boots one Fastify server per seat on `127.0.0.1:0`, each wrapping a
   seeded `WerewolfRandomMockAgent`.
2. Builds 9 `WerewolfHttpAgentAdapter` instances pointed at those
   servers.
3. Hands them to `WerewolfOrchestrator.registerAgent` and runs one match.
4. Persists the artifact to `examples/werewolf-local-simulation/output/matches/<gameId>/`.

The demo is the canonical reproduction of the production runtime path
without any external network hop.

## Tests

- Engine reducer: `packages/werewolf-engine/src/__tests__/`
- Action validator + fallback: `packages/werewolf-orchestrator/src/__tests__/`
- HTTP adapter: `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts`
- E2E (orchestrator + HTTP adapters + WS hub + persisted artifact):
  `apps/api/src/__tests__/werewolf-http-e2e.test.ts`
- E2E (in-process agents + WS hub + persisted artifact):
  `apps/api/src/__tests__/werewolf-matches.integration.test.ts`

## Out of scope

The werewolf platform deliberately omits, as of Plan 4c:

- A `MatchAnalysisSummary`-equivalent and `/api/v1/werewolf-matches/:id/analysis`
  route. The data needed (per-agent latency, fallback rate, intent/confidence
  distribution by phase) is already captured in the persisted decision-trace
  artifact; an aggregator + route can land in a follow-up plan once a
  consumer is ready.
- A real `WerewolfWsAgentAdapter`. The class exists as a placeholder
  throwing `NotImplementedError`; a real implementation can land later
  without churning callers.
- Web UI for werewolf matches. `apps/web` currently surfaces the poker
  flow only; a werewolf live view is future work.
