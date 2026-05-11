# Reverse-WebSocket Transport for External Werewolf Agents — Design

**Status:** proposal
**Date:** 2026-05-11
**Owner:** TBD
**Background:** [docs/werewolf-http-agent-guide.md](./werewolf-http-agent-guide.md) describes the existing HTTP transport. This doc proposes an additive WS transport.

## Why

The current invite flow assumes the external agent can host a publicly reachable inbound HTTP endpoint. For the target audience (a coding agent invited to "just play one match"), this is the single biggest friction point:

- Free no-auth tunnels (cloudflared quick tunnels, localtunnel, serveo) are unreliable in 2026.
- ngrok requires account signup before first byte.
- Deploying to a PaaS (Render/Railway/Fly) requires pre-existing accounts and 5+ minutes of setup.
- Failures are silent: registration accepts any well-formed URL, the orchestrator substitutes `validActions[0]` when it can't reach the agent, and the user just sees a mute seat.

Goal: an agent that only needs **outbound** network connectivity can be seated within ~30 seconds of getting an invite.

## Goals / Non-goals

**Goals**
- External agents seat-able with zero port exposure, zero tunnel, zero deploy.
- Strictly additive: existing HTTP transport keeps working; in-process adapter unchanged.
- Platform actively tracks agent online/offline; `seatAgent` and lobby UI know.
- A first-party SDK so end-users only write a `decide()` function.

**Non-goals**
- Rewriting the HTTP path or the in-process adapter.
- Browser-resident agents. Target is Node.js / Python coding agents.
- Replacing the player-UI `/ws` endpoint. Agent transport is a separate route, separate auth, separate message schema.

## Architecture overview

```
┌──────────────────┐      (1) POST /agents/invites/:tok/register
│  Agent process   │ ─────────────────────────────────────►  ┌──────────────────────┐
│  (user writes    │ ◄───── { wsToken, wsConnectUrl } ────── │ apps/api             │
│   decide())      │                                          │                      │
└──────────────────┘                                          │ ┌──────────────────┐ │
         │                                                    │ │ /agents/connect  │ │
         │ (2) WS open w/ Bearer wsToken                      │ │  WS upgrade      │ │
         └──────────────────────────────────────────────────► │ └────────┬─────────┘ │
         ◄──────────  hello (server→agent) ─────────────────  │          │           │
                                                              │   ┌──────▼──────┐    │
                                          ┌─── decide ────────┼── │ AgentConn   │    │
                                          │   (correlationId) │   │ Registry    │    │
                                          ▼                   │   └──────▲──────┘    │
                                    decide.response           │          │           │
         ─────────────────────────────────────────────────►   │   ┌──────┴──────┐    │
                                                              │   │ WsAgent     │    │
                                                              │   │ Adapter     │    │
                                                              │   │ (impl IAgent)│   │
                                                              │   └──────▲──────┘    │
                                                              │          │           │
                                                              │   ┌──────┴──────┐    │
                                                              │   │match-runner │    │
                                                              │   │ TimeoutHdlr │    │
                                                              │   └─────────────┘    │
                                                              └──────────────────────┘
```

**Key observation: the codebase is already laid out for multi-transport**

- `AgentRecord.protocol` is already an enum `'http' | 'longpoll' | 'inproc'` (`packages/persistence/src/postgres/postgres-agent-store.ts:18-31`). Adding `'ws'` is an extension, not a redesign.
- `IAgent<TReq, TRes>` is a pure interface (`packages/agent-runtime/src/agent-interface.ts:3-10`); the HTTP adapter (`packages/agent-runtime/src/werewolf-http-agent-adapter.ts:9-37`) is one of several possible implementations.
- `TimeoutHandler`, `werewolfFallback`, and Zod schema validation are transport-agnostic (`packages/agent-runtime/src/timeout-handler.ts`, `packages/werewolf-orchestrator/src/match-runner.ts:171-211`). The WS path reuses all of this.
- `@fastify/websocket` is already registered (`apps/api/src/server.ts:2`); the existing player-UI `/ws` (`apps/api/src/routes/ws.ts:26-100`) is a sibling of the proposed `/agents/connect` route, not its parent.

## Wire protocol

### Endpoint

```
GET wss://werewolf-api-ttsb.onrender.com/api/v1/agents/connect
Authorization: Bearer <wsToken>
```

Auth happens at WS upgrade in Fastify's `preValidation` hook. The token is **not** in the query string (avoids leaking via access logs).

### Frame format

All frames are JSON with a top-level discriminator: `{ type, ... }`. Define two Zod discriminated unions in a new file `packages/agent-protocol/src/agent-ws-schemas.ts`: `AgentWsServerMessageSchema` and `AgentWsClientMessageSchema`.

**Server → Agent**

| type | payload | when |
|---|---|---|
| `hello` | `{ protocolVersion: 1, agentId, serverConnectionId }` | immediately after auth succeeds |
| `decide` | `{ correlationId, request: WerewolfDecisionRequest }` | orchestrator needs a decision |
| `cancel` | `{ correlationId, reason }` | match ended / fallback already taken / decision no longer needed |
| `ping` | `{ ts }` | every 30s |
| `goodbye` | `{ code, reason }` | platform-initiated close (replaced, banned, server shutdown) |

**Agent → Server**

| type | payload | when |
|---|---|---|
| `decide.response` | `{ correlationId, action, reasoningSummary? }` | decision complete |
| `decide.error` | `{ correlationId, code, message }` | internal failure; equivalent to triggering fallback |
| `pong` | `{ ts }` | reply to ping |

**Reuse existing schemas.** `request.WerewolfDecisionRequest` and `decide.response.action` re-use the existing definitions in `packages/agent-protocol/src/werewolf-schemas.ts:170-196`. Do not duplicate.

### Correlation

A single WS multiplexes concurrent decisions across multiple matches. `correlationId` is a server-generated ULID; the agent must echo it back. The pending map lives in the server-side `AgentConnection` — the agent SDK shouldn't need to track anything.

## Server-side components

### `AgentConnectionRegistry` (new)

**Location:** `packages/agent-runtime/src/ws/agent-connection-registry.ts`

```ts
class AgentConnectionRegistry {
  acquire(agentId: string): AgentConnection | null;
  register(agentId: string, conn: AgentConnection): void;
  unregister(agentId: string, conn: AgentConnection): void;  // only if conn is the currently-registered one
  on(event: 'online' | 'offline', handler: (agentId: string) => void): void;
}
```

Single instance, constructed in `buildServer()` alongside `RealtimeHub`, injected into both the WS route and the lobby-registry.

**Last-write-wins for duplicate registrations.** A second connection for the same `agentId` causes the older connection to receive `goodbye{code:'replaced'}` and be closed; in-flight decisions on the old connection reject with `decide.error{code:'connection_replaced'}`. This makes the "laptop sleeps → agent restarts → agent reconnects" case lose at most one decision instead of crashing the match.

**Relationship to RealtimeHub.** Do not merge them. RealtimeHub is broadcast pub/sub (players subscribe to `match:*` for live updates). The registry is point-to-point RPC (one agent, one wire, correlation-IDs). Auth and lifecycle are different. The registry should *use* RealtimeHub to broadcast `agent.status:<agentId>` events for the lobby UI — that's collaboration, not consolidation.

### `WerewolfWsAgentAdapter` (new)

**Location:** `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts`

Implements `IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>`. A thin "look up a live connection in the registry and run an RPC over it" wrapper:

```ts
class WerewolfWsAgentAdapter implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse> {
  constructor(
    readonly agentId: string,
    readonly name: string,
    private readonly registry: AgentConnectionRegistry,
  ) {}

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const conn = this.registry.acquire(this.agentId);
    if (!conn) throw new AgentOfflineError(this.agentId);
    return conn.rpc(req); // assigns correlationId, registers pending entry, sends decide frame, awaits response
  }
}
```

**Note: no timeout logic in the adapter.** `TimeoutHandler` already wraps it (`match-runner.ts:205-211`) and produces fallbacks on timeout. The adapter only owns "if the connection exists, send and await." However, the adapter's `rpc()` MUST set its own hard ceiling slightly above `req.deadlineMs` (e.g. `deadlineMs * 2`) to avoid leaking pending entries when `TimeoutHandler` drops the outer promise. On that ceiling, send a `cancel` frame to the agent, reject the promise, and clear the pending map entry.

### WS upgrade route (new)

**Location:** `apps/api/src/routes/agents-ws.ts`, registered under `/api/v1` scope in `server.ts`.

1. In `preValidation`, read `Authorization: Bearer <token>`, hash with sha256, look up `AgentRecord.wsTokenHash` — 401 if no match.
2. After upgrade: build an `AgentConnection` (wraps the socket, owns the pending map, runs the ping/pong timer), call `registry.register(agentId, conn)`.
3. Send `hello` immediately.
4. On socket close, call `registry.unregister`; reject all pending entries with `connection_closed`.

**Heartbeat:** ping every 30s; close the socket if no pong within 10s.

### Dispatch polymorphism

**Change point:** `seatAgent()` in `apps/api/src/werewolf-lobby-registry.ts:490-509`.

Currently hardcodes `new WerewolfHttpAgentAdapter(...)`. Replace with:

```ts
const adapter = (() => {
  switch (cfg.protocol) {
    case 'http':   return new WerewolfHttpAgentAdapter(cfg.id, cfg.name, cfg.callbackUrl, ...);
    case 'ws':     return new WerewolfWsAgentAdapter(cfg.id, cfg.name, this.agentRegistry);
    case 'inproc': return /* current path */;
    default:       throw new AppError('unsupported_agent_protocol', ...);
  }
})();
```

`agentRegistry` is injected through the lobby-registry constructor, mirroring how `realtimeHub` is currently wired.

## Registration flow changes

### Request body — discriminated union

The current schema (used by `apps/api/src/routes/agent-invites.ts:177`) only accepts `endpointUrl`. Replace with:

```ts
const RegisterAgentInviteRequestSchema = z.object({
  displayName: z.string().min(1).max(64),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  transport: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('http'),
      endpointUrl: z.string().url(),
      authHeaderName: z.string().optional(),
      authHeaderValue: z.string().optional(),
    }),
    z.object({ kind: z.literal('ws') }),
  ]),
});
```

**Backward compatibility.** Keep the legacy schema as a fallback: if the body has top-level `endpointUrl` and no `transport`, coerce to `{ kind: 'http', endpointUrl }`. Existing callers keep working.

### Response

HTTP path response unchanged. WS path response includes:

```ts
{
  agentId: 'cfg-...',
  protocol: 'ws',
  wsConnectUrl: 'wss://werewolf-api-ttsb.onrender.com/api/v1/agents/connect',
  wsToken: '<one-time bearer, 32 bytes base64url>',
  // wsToken is returned exactly once; server stores only sha256(wsToken)
}
```

Token issuance and storage mirror the existing `agent_invites` pattern (`PostgresAgentInviteStore.findByRawToken()`, referenced from `apps/api/src/routes/agent-invites.ts:190`).

### Endpoint reachability check at registration time

| transport | check |
|---|---|
| `http` | Registration handler immediately POSTs a synthetic `decide` ping to `endpointUrl`; requires HTTP 200 + valid response schema. On failure, return `400 endpoint_unreachable` with a clear message. (This addresses the "silent mute seat" complaint that motivated the broader rework.) |
| `ws` | Cannot probe: the agent hasn't connected yet. Return `wsToken` plus an explicit message: "Connect to `wsConnectUrl` within N minutes or your agent will appear offline in the lobby." |

## Data / DB changes

```sql
-- migration: add ws to agent protocol enum, add token hash column
ALTER TYPE agent_protocol ADD VALUE 'ws';
ALTER TABLE agents ADD COLUMN ws_token_hash TEXT NULL;
-- callbackUrl stays NULL for ws agents; do not drop the column (still used by http agents)
```

`AgentRecord` (`packages/persistence/src/postgres/postgres-agent-store.ts:18-31`) gains `wsTokenHash?: string | null`.

## SDK: what users actually write

Publish `@agent-werewolf/agent-sdk` to npm:

```ts
import { WerewolfAgent } from '@agent-werewolf/agent-sdk';

new WerewolfAgent({
  token: process.env.WEREWOLF_AGENT_TOKEN!,
  url: 'wss://werewolf-api-ttsb.onrender.com/api/v1/agents/connect',
  decide: async (req) => {
    // req: WerewolfDecisionRequest (re-exported zod type)
    // return a WerewolfAction; SDK wraps it as decide.response
    return req.validActions[0];
  },
}).start();
```

SDK responsibilities:

- WS connect with `Authorization: Bearer` header
- ping/pong + reconnect with exponential backoff
- correlationId routing (the user's `decide()` is unaware)
- Validate inbound `request` and outbound `action` against the existing Zod schemas (re-exported from `agent-protocol`)
- If `decide()` throws, emit `decide.error{code:'handler_threw'}` and stay connected — never crash the agent process

**The new invite prompt** then collapses to two lines:

```
1. npm i @agent-werewolf/agent-sdk
2. Fill in decide() in the snippet below and run it. Your token is below.
```

The end-to-end "invite → seated" experience drops from ~30 minutes of fumbling (this design's motivating session) to ~30 seconds.

## Edge cases

| scenario | behavior |
|---|---|
| Agent hasn't connected; user tries to seat it | Lobby shows `agent_offline`; `seatAgent` returns 409. Lobby UI subscribes to `agent.status:<agentId>` over RealtimeHub for live updates. |
| Agent disconnects mid-match | In-flight decisions reject → `TimeoutHandler` produces `werewolfFallback` (same path as HTTP timeout today). Match continues. Subsequent calls hit `acquire() === null` and fall back again. Lobby UI marks the seat offline. |
| Agent reconnects | Old connection receives `goodbye{code:'replaced'}` and closes. New connection takes over. Decisions issued during the gap fall back. |
| Agent decision exceeds `deadlineMs` | `TimeoutHandler` fires; the WS adapter at `deadlineMs * 2` sends `cancel` so the agent stops computing for a dead correlationId. |
| Agent returns an action not in `validActions` | Existing match-runner validation (`match-runner.ts:260, 270-293`) handles it: emits `agent.invalid_action` and uses fallback. No change required for WS. |
| Agent returns `decide.error` | Treated as decision failure; immediate fallback; `invalidReason` recorded in the decision trace. |
| Same agent runs in multiple matches | Single WS multiplexes via `correlationId`; the server-side pending map handles concurrency. |
| Two simultaneous WS for the same agent | Last-write-wins; older socket is closed. |

## Observability

**Decision trace** (existing structure in `packages/persistence`) gains:

- `transport: 'http' | 'ws' | 'inproc'`
- WS-only events: `agent.disconnect_during_decision`, `agent.late_response` (response arrived after the correlationId was cancelled)

**Metrics** (if/when the platform integrates a metrics backend):

- `agent_ws_connections_active` (gauge by agentId)
- `agent_ws_decision_latency_ms` (histogram, frame-out → frame-in)
- `agent_ws_disconnects_total{reason}`

## Implementation phases

| Phase | Scope | Blocks next? |
|---|---|---|
| **P0** | DB migration: add `'ws'` to `agent_protocol` enum, add `ws_token_hash` column; sync Zod schemas. | yes |
| **P1** | Server: `AgentConnectionRegistry`, `WerewolfWsAgentAdapter`, `/agents/connect` route, lobby-registry switch, registration body union (with HTTP reachability probe). | yes |
| **P2** | Publish `@agent-werewolf/agent-sdk` to npm; new invite prompt template. | no (P1 alone makes WS usable, but UX is poor without an SDK) |
| **P3** | Lobby UI shows agent online/offline via `agent.status` events on RealtimeHub. | no |
| **P4** | Deprecation warning on the HTTP path (removable ~6 months out). | no |

P0 + P1 + P2 is the MVP. P3 polishes UX. P4 is cleanup.

## Open decisions

1. **Token lifetime.** Above proposes a long-lived `wsToken` (revocable from a future dashboard UI), so the agent process can restart and reconnect with the same secret. Alternative: one-time token swapped for a session token at connect. Long-lived is simpler; recommend that.
2. **Multiple connections per agent.** Forbidden vs last-write-wins. Last-write-wins is friendlier for the laptop-blip case. If anyone wants horizontal "multiple agent replicas, round-robin" later, that's a separate feature; out of MVP scope.
3. **Cross-language SDKs.** TS/Node first, Python next (the `websockets` lib makes this ~100 lines). Other languages can build directly on the wire protocol.
4. **Broadcast `agent.status` to spectators?** Lets a spectator UI show "seat 7 dropped". Belongs in P3 if pursued.
