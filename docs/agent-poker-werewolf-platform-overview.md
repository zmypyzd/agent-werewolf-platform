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
Six protected points, each defended by ≥2 layers and pinned by tests:

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
6. **Lobby internal fields** — `creatorUserId`, `seed`, `matchPk`,
   `rosterByPlayerId`, `deathsByPlayerId`, and any future
   `InternalEntry`-only field never cross the API boundary on
   `/api/v1/werewolf-games` responses. Defended by:
   `apps/api/src/werewolf-lobby-registry.ts:publicEntry` using an
   **allowlist projection** — only fields named in
   `PUBLIC_ENTRY_FIELDS` are copied into the response, and a
   compile-time `_AllPublicFieldsCovered` check pins that list against
   `WerewolfLobbyEntry`'s keys. New fields added to `InternalEntry` are
   private by default; surfacing one requires an explicit edit to this
   list. Pinned by `apps/api/src/__tests__/werewolf-lobby-registry.regression-public-allowlist.test.ts`
   and the existing `werewolf-lobby-registry.test.ts` per-field privacy
   assertions (`creatorUserId`, `seed`).

**Not on this list — and intentionally so**: `role` / `side` on each
player. As of ISSUE-005 the spectator surface reveals the full roster
once the match has started. Two delivery channels (live dogfood found
that one channel alone wasn't sufficient — see "Why both channels"
below):

1. **`match.started` replay event** — the orchestrator emits role+side
   on this event; `werewolfReplayEventToPublic` passes them through to
   the realtime topic and to the persisted public artifact. Locked in
   by `packages/realtime/src/__tests__/werewolf-filter.test.ts` so a
   future overzealous redactor can't accidentally strip them.
2. **Lobby endpoint `/api/v1/werewolf-games/:id`** — once
   `status === 'running' | 'completed'`, each seat carries `role` and
   `side` directly. Pre-start (`waiting` / `ready`) the fields are
   absent, so a viewer of the lobby endpoint cannot derive the roster
   before the game begins. Pinned by
   `apps/api/src/__tests__/werewolf-games-running-roster.test.ts`
   (post-start) and
   `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`
   (pre-start invariant).

**Why both channels**: WS topics don't replay buffered events. The web
client only opens its WS subscription once it sees `status='running'`
on the 2-5s lobby poll — by which time `match.started` has already
been published and is gone. Without channel #2 the spectator surface
sees generic placeholders forever on first-load / refresh-mid-match /
late-join / reconnect. With both channels, the lobby-sync poll
delivers the roster reliably, while the realtime stream remains the
right path for any future client that subscribes before `match.started`
fires (e.g. a native client that opens the WS at game-create time).

Both channels are safe by the same argument: agents read private info
via the decision-request envelope (already redacted by
`getPrivateState`), they never read it from either of these channels.

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

## Demo UI

A demo-level frontend lives at `/werewolf` (no auth). It lets a user create
a game, fill it with `WerewolfRandomMockAgent` instances via the new
`POST /api/v1/werewolf-games/...` lifecycle endpoints, start the match,
and watch it stream over the existing `match:<gameId>` WS topic. See
`docs/superpowers/specs/2026-05-06-werewolf-demo-ui-design.md` for the
spec and `docs/superpowers/plans/2026-05-06-werewolf-demo-ui.md` for the
implementation plan.

The demo surface is a **spectator broadcast view** — every role/side is
revealed from match-start so the 9-seat board acts as a scoreboard from
t=0 (ISSUE-005). The role badge on top of each card shows the player's
role; the dead-seat status line prefers the cause-of-death copy (✝ 被
狼刀 / 被毒 / 被放逐 / 被开枪) over the role label, since the role is
already conveyed by the badge and the cause is the freshest information
about a corpse (ISSUE-004 + 005). PK revote copy is "进入第 N 轮 PK 投
票" with `pkRound` as the 1-based PK index (ISSUE-006).

How the web actually receives the roster: the `WerewolfRoomPage`
already polls `/api/v1/werewolf-games/:id` every 2-5 seconds for
lobby-sync, and the reducer's `lobby-sync` handler writes incoming
`role` / `side` onto `SeatVM.revealedRole` / `revealedSide`. The
`match.started` event also carries the roster, but the WS subscription
opens only after `state.status === 'running'`, which the web learns
from that same lobby poll — so the poll is the actual delivery
mechanism on the demo path. The WS-event channel exists for any future
client that subscribes before the match starts.

Information-isolation invariants on the demo path:

- Lobby seat info pre-start (`status='waiting' | 'ready'`) never
  carries role or side. Pinned by
  `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`.
- Match seed never echoed on any public surface (see invariant #2 above).
- Night actor never highlighted in agent.action_* events emitted during
  night phases (see invariant #1 above).
- Once the match has started, **both** the lobby endpoint and the
  realtime spectator stream carry role/side by design — this is the
  broadcast view, not a leak (agents never read either; see "Not on
  this list" above).

Pinned by tests in `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`,
`apps/api/src/__tests__/werewolf-games-running-roster.test.ts`,
`apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`,
`apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.regression-spectator-reveal.test.ts`,
`packages/werewolf-orchestrator/src/__tests__/match-runner.regression-spectator-reveal.test.ts`,
and `packages/realtime/src/__tests__/werewolf-filter.test.ts`.

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
- A persisted-artifact replay UI at `/werewolf-matches/:id`. The API
  artifact route already exists; only a viewer is missing.
