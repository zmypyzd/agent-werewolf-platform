# Agent Poker Platform — API and Protocol Reference

Version: 1.0.0  
Date: 2026-04-24

---

## 1. REST API

### 1.1 Base URL and Versioning

All Phase 1 endpoints are prefixed with `/api/v1`.

Content-Type: `application/json` for all requests and responses.

### 1.2 Standard Response Envelope

**Success**:
```json
{
  "data": { ... }
}
```

**Error**:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "statusCode": 404,
    "details": { }
  }
}
```

### 1.3 Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `TABLE_NOT_FOUND` | 404 | tableId does not exist |
| `HAND_NOT_FOUND` | 404 | handId does not exist |
| `AGENT_NOT_FOUND` | 404 | agentId does not exist on this table |
| `TABLE_FULL` | 409 | No empty seats on the table |
| `HAND_IN_PROGRESS` | 409 | Cannot start hand; one is already running |
| `NOT_ENOUGH_PLAYERS` | 400 | Need ≥2 seated agents to start hand |
| `INVALID_CONFIG` | 400 | Table or blind config failed validation |
| `SCHEMA_VALIDATION_FAILED` | 400 | Request body failed Zod schema validation |
| `SIMULATION_FAILED` | 500 | Internal error during simulation |
| `INTERNAL_ERROR` | 500 | Unhandled internal error |

---

### 1.4 Endpoint Reference

#### POST /api/v1/tables

Create a new table.

**Request body**:
```json
{
  "name": "Test Table 1",
  "maxSeats": 6,
  "blindConfig": {
    "smallBlind": 25,
    "bigBlind": 50,
    "ante": 0
  },
  "seed": "my-deterministic-seed",
  "defaultTimeoutMs": 5000
}
```

Fields:
- `name`: string, required
- `maxSeats`: integer, 2–9, required
- `blindConfig.smallBlind`: integer > 0, required
- `blindConfig.bigBlind`: integer > smallBlind, required
- `blindConfig.ante`: integer ≥ 0, required
- `seed`: string, optional (if omitted: random UUID used)
- `defaultTimeoutMs`: integer > 0, optional (default: 5000)

**Response 201**:
```json
{
  "data": {
    "tableId": "tbl-abc123",
    "config": {
      "tableId": "tbl-abc123",
      "name": "Test Table 1",
      "maxSeats": 6,
      "blindConfig": { "smallBlind": 25, "bigBlind": 50, "ante": 0 },
      "defaultTimeoutMs": 5000,
      "seed": "my-deterministic-seed"
    },
    "status": "waiting",
    "seats": [null, null, null, null, null, null],
    "currentHandId": null,
    "handNumber": 0,
    "button": 0,
    "createdAt": 1745500000000
  }
}
```

---

#### GET /api/v1/tables

List all tables.

**Response 200**:
```json
{
  "data": [
    { "tableId": "tbl-abc123", "name": "Test Table 1", "status": "waiting", "seatedCount": 0 },
    { "tableId": "tbl-def456", "name": "Test Table 2", "status": "playing", "seatedCount": 4 }
  ]
}
```

---

#### GET /api/v1/tables/:tableId

Get full table state.

**Response 200**: Full `TableState` object (see domain model in spec).

**Response 404**: `TABLE_NOT_FOUND`

---

#### DELETE /api/v1/tables/:tableId

Delete a table. Only allowed when `status !== 'playing'`.

**Response 200**:
```json
{ "data": { "deleted": true } }
```

---

#### POST /api/v1/tables/:tableId/agents

Add an agent to the table. Assigns to first available seat.

**Request body**:
```json
{
  "name": "RandomBot-1",
  "adapterType": "mock",
  "strategy": "random",
  "buyIn": 1000
}
```

Fields:
- `name`: string, required
- `adapterType`: `"mock"`, required for Phase 1 (`"http"` and `"websocket"` accepted but return 501)
- `strategy`: `"random" | "always-call" | "always-fold" | "aggressive"` — required when `adapterType === "mock"`
- `buyIn`: integer > 0, required
- `endpoint`: string URL, required when `adapterType === "http"` or `"websocket"`

**Response 200**:
```json
{
  "data": {
    "agentId": "agent-rand-1",
    "seatIndex": 0,
    "stack": 1000,
    "status": "waiting"
  }
}
```

**Response 409**: `TABLE_FULL`

---

#### DELETE /api/v1/tables/:tableId/agents/:agentId

Remove agent from table. Only when `status !== 'playing'`.

**Response 200**:
```json
{ "data": { "removed": true } }
```

---

#### POST /api/v1/tables/:tableId/hands/start

Start the next hand. Runs the hand synchronously (awaits completion before responding).

**Request body**: none

**Response 200**:
```json
{
  "data": {
    "handId": "hand-001",
    "handNumber": 1,
    "seed": "my-deterministic-seed-1",
    "completedAt": 1745500001234,
    "durationMs": 1234,
    "communityCards": [
      { "rank": "A", "suit": "s" },
      { "rank": "K", "suit": "h" },
      { "rank": "7", "suit": "d" },
      { "rank": "2", "suit": "c" },
      { "rank": "J", "suit": "s" }
    ],
    "results": [
      { "playerId": "p1", "seatIndex": 0, "potIndex": 0, "winAmount": 150, "netChange": 100 },
      { "playerId": "p2", "seatIndex": 1, "potIndex": 0, "winAmount": 0, "netChange": -50 }
    ],
    "finalPots": [{ "amount": 150, "eligiblePlayerIds": ["p1","p2"] }]
  }
}
```

**Response 400**: `NOT_ENOUGH_PLAYERS`  
**Response 409**: `HAND_IN_PROGRESS`

---

#### GET /api/v1/tables/:tableId/state

Get current public game state (if hand in progress) or null.

**Response 200**:
```json
{
  "data": {
    "handId": "hand-001",
    "tableId": "tbl-abc123",
    "phase": "flop",
    "players": [
      { "playerId": "p1", "seatIndex": 0, "stack": 950, "status": "active", "totalBetInHand": 50, "currentRoundBet": 0 },
      { "playerId": "p2", "seatIndex": 1, "stack": 800, "status": "active", "totalBetInHand": 200, "currentRoundBet": 0 }
    ],
    "communityCards": [
      { "rank": "A", "suit": "s" },
      { "rank": "K", "suit": "h" },
      { "rank": "7", "suit": "d" }
    ],
    "pots": [{ "amount": 250, "eligiblePlayerIds": ["p1","p2"] }],
    "button": 0,
    "smallBlindIndex": 1,
    "bigBlindIndex": 0,
    "currentActorIndex": 1,
    "currentRoundMinBet": 0,
    "minRaiseAmount": 50,
    "allActions": []
  }
}
```

Returns `{ "data": null }` if no hand in progress.

---

#### GET /api/v1/tables/:tableId/hands

List all completed hand summaries for this table.

**Response 200**:
```json
{
  "data": [
    { "handId": "hand-001", "handNumber": 1, "seed": "...", "startedAt": 1745500000000, "completedAt": 1745500001234 },
    { "handId": "hand-002", "handNumber": 2, "seed": "...", ... }
  ]
}
```

---

#### GET /api/v1/tables/:tableId/hands/:handId

Get full hand summary.

**Response 200**: Full `HandSummary` object.

**Response 404**: `HAND_NOT_FOUND`

---

#### GET /api/v1/tables/:tableId/hands/:handId/replay

Get all replay events for a hand, ordered by `sequence`.

**Response 200**:
```json
{
  "data": [
    {
      "eventId": "evt-001",
      "handId": "hand-001",
      "tableId": "tbl-abc123",
      "sequence": 0,
      "eventType": "hand.started",
      "timestamp": 1745500000000,
      "data": { "handNumber": 1, "seed": "my-seed-1", "playerIds": ["p1","p2"], "button": 0 }
    },
    {
      "eventId": "evt-002",
      "sequence": 1,
      "eventType": "blinds.posted",
      "timestamp": 1745500000010,
      "data": {
        "smallBlind": { "playerId": "p2", "amount": 25 },
        "bigBlind": { "playerId": "p1", "amount": 50 }
      }
    }
  ]
}
```

---

#### POST /api/v1/simulate

Run a complete multi-hand simulation. Creates a table, adds agents, runs N hands, returns results.

**Request body**:
```json
{
  "name": "Simulation Run 1",
  "maxSeats": 6,
  "blindConfig": { "smallBlind": 25, "bigBlind": 50, "ante": 0 },
  "seed": "sim-seed-001",
  "defaultTimeoutMs": 5000,
  "agents": [
    { "name": "Bot1", "strategy": "random", "buyIn": 1000 },
    { "name": "Bot2", "strategy": "always-call", "buyIn": 1000 },
    { "name": "Bot3", "strategy": "aggressive", "buyIn": 1000 },
    { "name": "Bot4", "strategy": "always-fold", "buyIn": 1000 }
  ],
  "numHands": 5
}
```

**Response 200**:
```json
{
  "data": {
    "tableId": "tbl-sim-001",
    "hands": [ /* array of HandSummary */ ],
    "finalStacks": {
      "agent-0": 1250,
      "agent-1": 800,
      "agent-2": 1100,
      "agent-3": 850
    },
    "totalHands": 5
  }
}
```

---

## 2. Agent Decision Protocol

### 2.1 Overview

The agent decision protocol is the internal contract between `TableOrchestrator` and any `IAgent` implementation. In Phase 1, all agents are in-process MockAgents. In Phase 2+, HTTP/WS adapters translate this protocol to external network calls.

### 2.2 IAgent Interface

```typescript
// packages/agent-runtime/src/agent-interface.ts

interface IAgent {
  readonly agentId: string;
  readonly name: string;
  /**
   * Called by HandRunner once per action opportunity.
   * Must resolve within timeoutMs (enforced by TimeoutHandler).
   * Must return an AgentDecisionResponse with requestId matching req.requestId.
   */
  requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse>;
}
```

### 2.3 AgentDecisionRequest

Full JSON example:
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "handId": "hand-001",
  "tableId": "tbl-abc123",
  "agentId": "agent-rand-1",
  "publicState": {
    "handId": "hand-001",
    "tableId": "tbl-abc123",
    "phase": "flop",
    "players": [
      {
        "playerId": "p1",
        "seatIndex": 0,
        "stack": 950,
        "status": "active",
        "totalBetInHand": 50,
        "currentRoundBet": 0
      },
      {
        "playerId": "p2",
        "seatIndex": 1,
        "stack": 750,
        "status": "active",
        "totalBetInHand": 250,
        "currentRoundBet": 100
      },
      {
        "playerId": "p3",
        "seatIndex": 2,
        "stack": 0,
        "status": "all-in",
        "totalBetInHand": 1000,
        "currentRoundBet": 0
      }
    ],
    "communityCards": [
      { "rank": "A", "suit": "s" },
      { "rank": "K", "suit": "h" },
      { "rank": "7", "suit": "d" }
    ],
    "pots": [
      { "amount": 300, "eligiblePlayerIds": ["p1","p2","p3"] },
      { "amount": 1000, "eligiblePlayerIds": ["p2","p3"] }
    ],
    "button": 2,
    "smallBlindIndex": 0,
    "bigBlindIndex": 1,
    "currentActorIndex": 0,
    "currentRoundMinBet": 100,
    "minRaiseAmount": 100,
    "allActions": [
      {
        "actionId": "act-001",
        "handId": "hand-001",
        "playerId": "p1",
        "phase": "preflop",
        "actionType": "call",
        "amount": 50,
        "stackAfter": 950,
        "sequence": 0,
        "timestamp": 1745500000100
      }
    ]
  },
  "privateState": {
    "playerId": "p1",
    "holeCards": [
      { "rank": "A", "suit": "c" },
      { "rank": "A", "suit": "d" }
    ]
  },
  "legalActions": [
    { "type": "fold" },
    { "type": "call", "callAmount": 100 },
    { "type": "raise", "minAmount": 200, "maxAmount": 950 },
    { "type": "all-in", "maxAmount": 950 }
  ],
  "timeoutMs": 5000
}
```

**Security invariant**: `privateState.holeCards` always contains exactly the requesting agent's 2 hole cards. `publicState.players` never includes hole cards. The platform must verify this before calling any agent.

### 2.4 AgentDecisionResponse

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "agentId": "agent-rand-1",
  "actionType": "raise",
  "amount": 300
}
```

Rules:
- `requestId` must match the corresponding `AgentDecisionRequest.requestId`.
- `agentId` must match `AgentDecisionRequest.agentId`.
- `actionType` must be one of the types listed in `legalActions`.
- `amount` is required for `bet` and `raise` (the total bet size, not increment).
- `amount` is optional for `all-in` (if present, must equal player's stack).
- `amount` must be absent or `0` for `fold`, `check`, `call`.
- For `call`, the platform ignores `amount` and always applies `callAmount` from `legalActions`.

### 2.5 Error Response (from HTTP Agent Adapter, Phase 2+)

When an HTTP Agent endpoint returns an error:
```json
{
  "error": {
    "code": "AGENT_ERROR",
    "message": "Agent internal error",
    "statusCode": 500
  }
}
```

The platform treats any non-200 response or Zod validation failure as an invalid action and applies fallback.

### 2.6 Timeout Strategy

```
Platform sends AgentDecisionRequest
        │
        ▼
TimeoutHandler starts countdown (default: 5000ms)
        │
    ┌───┴───────────────────────┐
    │                           │
Agent responds               Timeout fires
    │                           │
    ▼                           ▼
Validate response          Log agent.timeout event
    │                           │
Valid? ──No──▶ Fallback     Apply fallback
    │
Apply action
```

**Fallback action determination**:
1. If `check` is in `legalActions`: apply `check`.
2. Else: apply `fold`.

Rationale: fold is safe (never creates an illegal game state), check is preferable to avoid punishing an agent for a latency spike.

### 2.7 Invalid Action Strategy

When an agent returns a response that fails Zod validation or contains an action not in `legalActions`:

1. Log `agent.invalid_action` event with the received response and the fallback.
2. Apply fallback (same logic as timeout fallback).
3. The hand continues normally.

Invalid action does NOT increment a penalty counter in Phase 1. Phase 2+ may add strike system.

### 2.8 Information Isolation Rules

The following information is **NEVER** sent to an agent:

| Information | Who has it | Why excluded |
|---|---|---|
| Other players' hole cards | Game engine only | Core game rule — hidden cards |
| Deck remaining cards | Game engine only | Would give unfair advantage |
| Other agents' timeout settings | Platform only | No strategic use case |
| Table seed | Platform only | Would allow predicting future cards |

### 2.9 HTTP Agent Adapter Protocol (Phase 2+, Specification)

When implemented, the HTTP Agent Adapter will:

1. POST to `agent.endpoint` with `AgentDecisionRequest` as JSON body.
2. Set `Content-Type: application/json` and `X-Request-Id: {requestId}` headers.
3. Set request timeout to `req.timeoutMs`.
4. Validate response body against `AgentDecisionResponseSchema`.
5. On network error / timeout / validation failure: apply fallback action.

Expected endpoint contract (implemented by the external agent):
```
POST {endpoint}/decide
Content-Type: application/json
Body: AgentDecisionRequest

Response 200:
Content-Type: application/json
Body: AgentDecisionResponse
```

### 2.10 WebSocket Agent Adapter Protocol (Phase 2+, Specification)

The WS adapter maintains a persistent connection per agent:

```
Platform connects to: ws://{endpoint}/agent-ws
Platform sends: { type: "decision_request", payload: AgentDecisionRequest }
Agent responds: { type: "decision_response", payload: AgentDecisionResponse }
```

Heartbeat: platform sends `{ type: "ping" }` every 10s; agent must respond `{ type: "pong" }` within 5s.

---

## 3. Realtime Event Protocol

### 3.1 Event Envelope

All events follow this structure:
```typescript
interface ReplayEvent {
  eventId: string;         // UUID
  handId: string;
  tableId: string;
  sequence: number;        // 0-based, strictly monotonic within a hand
  eventType: string;       // see event catalog below
  timestamp: number;       // Unix milliseconds
  data: Record<string, unknown>;
}
```

### 3.2 Event Catalog

#### `hand.started`
```json
{
  "handNumber": 1,
  "seed": "my-seed-1",
  "playerIds": ["p1", "p2", "p3"],
  "button": 2,
  "blindConfig": { "smallBlind": 25, "bigBlind": 50, "ante": 0 }
}
```

#### `antes.posted`
```json
{
  "antes": [
    { "playerId": "p1", "amount": 10 },
    { "playerId": "p2", "amount": 10 }
  ]
}
```

#### `blinds.posted`
```json
{
  "smallBlind": { "playerId": "p2", "amount": 25, "seatIndex": 1 },
  "bigBlind": { "playerId": "p3", "amount": 50, "seatIndex": 2 }
}
```

#### `hole_cards.dealt`

This event is **per-player private**. In Phase 1 (in-process), only the relevant agent reads it. In Phase 2 WebSocket, it is sent only to the subscribing client for that player.

```json
{
  "playerId": "p1",
  "holeCards": [
    { "rank": "A", "suit": "c" },
    { "rank": "A", "suit": "d" }
  ]
}
```

The `hole_cards.dealt` events in the JSONL replay file contain all players' cards (for replay analysis). When served via API for external use, `holeCards` must be redacted unless it's a completed hand.

#### `betting_round.started`
```json
{
  "phase": "flop",
  "communityCards": [
    { "rank": "A", "suit": "s" },
    { "rank": "K", "suit": "h" },
    { "rank": "7", "suit": "d" }
  ],
  "firstActorIndex": 1
}
```

#### `community_cards.dealt`
```json
{
  "phase": "flop",
  "cards": [
    { "rank": "A", "suit": "s" },
    { "rank": "K", "suit": "h" },
    { "rank": "7", "suit": "d" }
  ]
}
```

#### `action.requested`
```json
{
  "agentId": "agent-rand-1",
  "playerId": "p1",
  "legalActions": [
    { "type": "fold" },
    { "type": "call", "callAmount": 50 },
    { "type": "raise", "minAmount": 100, "maxAmount": 950 },
    { "type": "all-in", "maxAmount": 950 }
  ]
}
```

#### `action.received`
```json
{
  "agentId": "agent-rand-1",
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "actionType": "raise",
  "amount": 200,
  "wasTimeout": false,
  "wasInvalid": false
}
```

#### `action.applied`
```json
{
  "actionId": "act-007",
  "playerId": "p1",
  "phase": "flop",
  "actionType": "raise",
  "amount": 200,
  "stackAfter": 750,
  "sequence": 7,
  "potTotal": 450
}
```

#### `betting_round.complete`
```json
{
  "phase": "flop",
  "pots": [
    { "amount": 450, "eligiblePlayerIds": ["p1","p2"] }
  ]
}
```

#### `showdown.started`
```json
{
  "players": [
    {
      "playerId": "p1",
      "seatIndex": 0,
      "holeCards": [{ "rank": "A", "suit": "c" }, { "rank": "A", "suit": "d" }]
    },
    {
      "playerId": "p2",
      "seatIndex": 1,
      "holeCards": [{ "rank": "K", "suit": "s" }, { "rank": "K", "suit": "h" }]
    }
  ]
}
```

#### `showdown.result`
```json
{
  "playerId": "p1",
  "holeCards": [{ "rank": "A", "suit": "c" }, { "rank": "A", "suit": "d" }],
  "bestCards": [
    { "rank": "A", "suit": "c" }, { "rank": "A", "suit": "d" },
    { "rank": "A", "suit": "s" }, { "rank": "K", "suit": "h" }, { "rank": "K", "suit": "d" }
  ],
  "category": "full_house",
  "description": "Full House, Aces over Kings"
}
```

#### `pot.awarded`
```json
{
  "potIndex": 0,
  "amount": 500,
  "winnerIds": ["p1"],
  "splitAmount": 500,
  "reason": "best_hand"
}
```

For split pots:
```json
{
  "potIndex": 0,
  "amount": 200,
  "winnerIds": ["p1", "p3"],
  "splitAmount": 100,
  "remainderChipTo": "p1",
  "reason": "tie"
}
```

#### `hand.completed`
```json
{
  "handId": "hand-001",
  "handNumber": 1,
  "durationMs": 1234,
  "results": [
    { "playerId": "p1", "seatIndex": 0, "potIndex": 0, "winAmount": 500, "netChange": 450 },
    { "playerId": "p2", "seatIndex": 1, "potIndex": 0, "winAmount": 0, "netChange": -50 }
  ],
  "finalStacks": { "p1": 1450, "p2": 950 }
}
```

#### `agent.timeout`
```json
{
  "agentId": "agent-rand-1",
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "elapsedMs": 5012,
  "fallbackAction": { "actionType": "check" }
}
```

#### `agent.invalid_action`
```json
{
  "agentId": "agent-rand-1",
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "received": {
    "actionType": "bet",
    "amount": 999999
  },
  "reason": "amount 999999 exceeds maxAmount 950",
  "fallbackAction": { "actionType": "check" }
}
```

#### `table.created`
```json
{
  "tableId": "tbl-abc123",
  "config": { ... }
}
```

#### `agent.seated`
```json
{
  "agentId": "agent-rand-1",
  "seatIndex": 2,
  "stack": 1000
}
```

### 3.3 Event Sequence for a Complete Hand

Typical sequence numbers for a 2-player hand:
```
0: hand.started
1: blinds.posted
2: hole_cards.dealt (p1 private)
3: hole_cards.dealt (p2 private)
4: betting_round.started { phase: "preflop" }
5: action.requested { p2 }
6: action.received { p2, call }
7: action.applied { p2, call }
8: action.requested { p1 }
9: action.received { p1, check }
10: action.applied { p1, check }
11: betting_round.complete { phase: "preflop" }
12: community_cards.dealt { flop, 3 cards }
13: betting_round.started { phase: "flop" }
... (flop actions) ...
24: community_cards.dealt { turn, 1 card }
... (turn actions) ...
30: community_cards.dealt { river, 1 card }
... (river actions) ...
38: showdown.started
39: showdown.result { p1 }
40: showdown.result { p2 }
41: pot.awarded
42: hand.completed
```

### 3.4 Phase 2 WebSocket Transport

Clients subscribe to a table:
```
GET /api/v1/tables/:tableId/ws  (upgrade to WebSocket)
```

After connection, client receives all new events in real-time.  
Client may optionally send `{ type: "replay", fromSequence: 0 }` to receive all past events from the current hand.

The server does not send `hole_cards.dealt` events for other players to WebSocket clients. It only sends the client's own private events based on their authenticated player identity.

---

## 4. TypeScript Interface Reference

All types are defined in `packages/shared/src/types.ts` and exported from `@agent-poker/shared`. All Zod schemas are in `packages/agent-protocol/src/schemas.ts` and exported from `@agent-poker/agent-protocol`.

Key interface imports for external consumers:
```typescript
import type {
  Card, Rank, Suit,
  ActionType, HandPhase, PlayerStatus,
  LegalAction, GameAction,
  PublicPlayer, PlayerInHand,
  Pot, SidePot,
  AgentDecisionRequest, AgentDecisionResponse,
  HandSummary, HandResult, ReplayEvent,
  TableConfig, TableState, BlindConfig, SeatInfo,
  AgentInfo,
} from '@agent-poker/shared';

import {
  AgentDecisionRequestSchema,
  AgentDecisionResponseSchema,
} from '@agent-poker/agent-protocol';
```
