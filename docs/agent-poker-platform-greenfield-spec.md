# Agent Poker Platform — Greenfield Specification

Version: 1.0.0  
Date: 2026-04-24  
Status: Authoritative — all implementation must conform to this document.

---

## 1. Product Goals

Build a multi-agent Texas Hold'em poker platform for technical experimentation and entertainment. The platform must support multiple AI agents playing on the same table, with the platform enforcing all game rules, managing hand lifecycle, recording history, and providing a clean API.

### Phase 1 (MVP) — Game Engine + Agent Runtime + Local Simulation
- Complete No-Limit Texas Hold'em game engine (pure logic, no UI required).
- Table orchestrator that manages seats, hands, and agent decisions.
- Agent runtime that executes local MockAgents and defines protocol for future external agents.
- Seeded reproducible dealing for tests and replay.
- Full hand lifecycle: blinds → preflop → flop → turn → river → showdown → pot distribution.
- JSONL-based hand history and replay events persisted to disk.
- Minimal REST API for managing tables, agents, and reading results.
- Local simulation demo (CLI, no browser needed).
- Unit tests and integration tests covering all core mechanics.

### Phase 2 — Frontend + User Participation
- React + Vite frontend for observing hands in real time.
- User accounts (register/login).
- Users can sit at tables and submit actions via HTTP.
- WebSocket / SSE for real-time state push.
- PostgreSQL replaces in-memory storage.

### Phase 3 — External Agent Ecosystem
- HTTP Agent Adapter: external agents accept POST requests.
- WebSocket Agent Adapter: external agents maintain a persistent WS connection.
- OpenClaw Adapter (or any third-party agent) as a concrete integration example.
- Agent registration, authentication, isolation, and rate limiting.

---

## 2. Non-Goals (All Phases)

The following are **permanently excluded** from this platform:

- Real money gambling, wagering, or betting markets.
- Recharge, withdrawal, fund transfer, or any financial transaction.
- Odds calculation for betting purposes.
- Any feature that could constitute operating an unlicensed gambling service.

The following are **deferred to Phase 2 or later**:

- Tournament mode (multi-table, blind escalation).
- Rebuy or add-on mechanics.
- Rake calculation.
- Full frontend UI (Phase 1 provides API only).
- PostgreSQL persistence (Phase 1 uses memory + JSONL files).
- User authentication and authorization.
- External HTTP/WS agent adapters (Phase 1 has stubs only).

---

## 3. Phase Breakdown

### Phase 1 MVP Completion Definition

Phase 1 is complete when **all** of the following are true:

1. `pnpm install` succeeds in the project root.
2. `pnpm run build` compiles all packages and apps with zero TypeScript errors.
3. `pnpm run test` runs all unit and integration tests and all pass.
4. The local simulation script (`examples/local-simulation/run-simulation.ts`) runs 5 hands with 4 MockAgents without error.
5. A hand history JSONL file is written to `examples/local-simulation/output/`.
6. The API server starts (`pnpm --filter api dev`) and all Phase 1 API endpoints return correct responses.
7. A replay test verifies that running the same seed twice produces identical hand histories.

---

## 4. Technology Stack (Frozen)

| Concern | Choice | Version |
|---|---|---|
| Language | TypeScript | 5.5+ |
| Runtime | Node.js | 20.x LTS |
| Package manager | pnpm | 9.x |
| Monorepo | pnpm workspaces | built-in |
| Test framework | Vitest | 2.x |
| API framework | Fastify | 4.x |
| Schema validation | Zod | 3.x |
| Phase 1 storage | In-memory + JSONL files | — |
| Phase 2+ storage | PostgreSQL | 16.x |
| Frontend (Phase 2) | React 18 + Vite 5 | — |
| PRNG (seeded) | Custom mulberry32 | (vendored ~20 lines) |
| Hand evaluation | Custom (no external lib) | — |

**Why no external hand evaluator library**: External poker libs vary in licensing, TypeScript support, and API stability. A custom evaluator is ~300 lines, fully tested, and avoids a dependency that could conflict with future targets. The implementation plan includes the algorithm.

**Why mulberry32**: Simple, fast, 32-bit seeded PRNG. Output is sufficient for shuffling a 52-card deck. Deterministic across platforms given the same seed.

---

## 5. Project Directory Structure

```
agent-poker-platform/           # Project root
├── apps/
│   ├── api/                    # Fastify REST API server
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── tables.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── hands.ts
│   │   │   │   └── simulate.ts
│   │   │   ├── plugins/
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── request-id.ts
│   │   │   ├── server.ts
│   │   │   └── index.ts
│   │   ├── src/__tests__/
│   │   │   └── api.integration.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                    # React + Vite (Phase 2 only — empty scaffold)
│       ├── src/
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── poker-engine/           # Pure Texas Hold'em logic — zero external deps
│   │   ├── src/
│   │   │   ├── card.ts         # Card type, rank/suit constants, formatting
│   │   │   ├── deck.ts         # Deck creation, seeded shuffle, deal
│   │   │   ├── hand-evaluator.ts # 5-card and 7-card hand evaluation + comparison
│   │   │   ├── legal-actions.ts  # Compute legal actions for current actor
│   │   │   ├── pot-calculator.ts # Pot and side pot calculation
│   │   │   ├── betting-round.ts  # Betting round state machine
│   │   │   ├── showdown.ts       # Showdown comparison, winner determination
│   │   │   └── index.ts
│   │   ├── src/__tests__/
│   │   │   ├── card.test.ts
│   │   │   ├── deck.test.ts
│   │   │   ├── hand-evaluator.test.ts
│   │   │   ├── legal-actions.test.ts
│   │   │   ├── pot-calculator.test.ts
│   │   │   ├── betting-round.test.ts
│   │   │   └── showdown.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── table-orchestrator/     # Hand lifecycle management
│   │   ├── src/
│   │   │   ├── table.ts        # Table state, seat management
│   │   │   ├── hand-runner.ts  # Runs one complete hand
│   │   │   ├── orchestrator.ts # Manages tables and dispatches hands
│   │   │   └── index.ts
│   │   ├── src/__tests__/
│   │   │   ├── hand-runner.test.ts
│   │   │   └── orchestrator.integration.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agent-runtime/          # Agent execution, timeout, adapters
│   │   ├── src/
│   │   │   ├── agent-interface.ts     # IAgent TypeScript interface
│   │   │   ├── mock-agent.ts          # Local in-process MockAgent base class
│   │   │   ├── timeout-handler.ts     # Wraps agent call with timeout + fallback
│   │   │   ├── http-agent-adapter.ts  # STUB Phase 1 — HTTP POST adapter
│   │   │   ├── ws-agent-adapter.ts    # STUB Phase 1 — WebSocket adapter
│   │   │   └── index.ts
│   │   ├── src/__tests__/
│   │   │   ├── mock-agent.test.ts
│   │   │   └── timeout-handler.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agent-protocol/         # Shared Zod schemas + TypeScript types
│   │   ├── src/
│   │   │   ├── schemas.ts      # All Zod schemas
│   │   │   ├── types.ts        # Types inferred from schemas
│   │   │   ├── errors.ts       # Protocol error codes and types
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── persistence/            # Storage abstraction
│   │   ├── src/
│   │   │   ├── store-interface.ts  # IStore, IHandStore, ITableStore interfaces
│   │   │   ├── memory-store.ts     # In-memory implementation
│   │   │   ├── file-store.ts       # JSONL append-only file implementation
│   │   │   └── index.ts
│   │   ├── src/__tests__/
│   │   │   ├── memory-store.test.ts
│   │   │   └── file-store.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/                 # Shared types, constants, utilities
│       ├── src/
│       │   ├── types.ts        # All domain types (Card, GameState, etc.)
│       │   ├── constants.ts    # RANKS, SUITS, HAND_CATEGORIES, etc.
│       │   ├── errors.ts       # AppError base class, error codes
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── examples/
│   ├── mock-agents/
│   │   ├── random-agent.ts         # Picks a random legal action
│   │   ├── always-call-agent.ts    # Always calls (or checks)
│   │   ├── always-fold-agent.ts    # Always folds (or checks)
│   │   └── aggressive-agent.ts     # Always raises if possible
│   └── local-simulation/
│       ├── run-simulation.ts       # CLI: runs N hands with configured agents
│       ├── simulation-config.ts    # Default config for demo
│       └── output/                 # JSONL files written here (gitignored)
│           └── .gitkeep
├── docs/                       # All documentation lives here
├── scripts/
│   ├── setup.sh                # Initial setup (pnpm install + build)
│   └── run-demo.sh             # Runs local simulation and prints summary
├── package.json                # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
└── CLAUDE.md
```

---

## 6. Target Architecture

### 6.1 Poker Engine (`packages/poker-engine`)

**Responsibilities**: Card representation, seeded deck shuffling and dealing, hand evaluation (5-card + best-of-7), legal action computation, pot/side-pot calculation, betting round state transitions, showdown comparison, winner determination.

**Constraints**:
- Zero runtime dependencies (no npm packages at runtime).
- No I/O: no file reads, no network, no logging.
- All functions are pure: given input → output, no side effects.
- Must be testable without any other package.

**Key exports**:
- `createDeck(seed: string): Deck`
- `deal(deck: Deck, n: number): [Card[], Deck]`
- `evaluateHand(cards: Card[]): HandEvaluation` (5 cards)
- `bestHandFrom7(cards: Card[]): HandEvaluation`
- `compareHands(a: HandEvaluation, b: HandEvaluation): -1 | 0 | 1`
- `computeLegalActions(state: BettingRoundState): LegalAction[]`
- `computePots(players: PlayerContribution[]): Pot[]`
- `applyAction(state: BettingRoundState, action: PlayerAction): BettingRoundState`
- `isBettingRoundComplete(state: BettingRoundState): boolean`
- `determineWinners(pots: Pot[], playerHands: Map<string, HandEvaluation>): PotAward[]`

### 6.2 Table Orchestrator (`packages/table-orchestrator`)

**Responsibilities**: Create and manage tables, manage agent seats, run the hand lifecycle loop, call Agent Runtime to get decisions, validate actions, emit replay events, save hand history.

**Dependencies**: `poker-engine`, `agent-runtime`, `agent-protocol`, `persistence`, `shared`.

**Hand Lifecycle** (in `hand-runner.ts`):
1. Validate at least 2 active players.
2. Assign hand ID and seed (`${tableSeed}-${handNumber}`).
3. Create and shuffle deck.
4. Post antes (if configured).
5. Post blinds (small blind then big blind), advance button.
6. Deal 2 hole cards to each active player.
7. Emit `hole_cards.dealt` (private per-player) and `betting_round.started` (preflop).
8. Run preflop betting round via `BettingRound` state machine.
9. Deal 3 flop cards. Emit `community_cards.dealt`.
10. Run flop betting round.
11. Deal 1 turn card. Run turn betting round.
12. Deal 1 river card. Run river betting round.
13. If more than 1 active player: run showdown.
14. Compute pots, distribute winnings, emit `pot.awarded` for each.
15. Save `HandSummary` and all `ReplayEvent`s.
16. Emit `hand.completed`.

**Action validation**: After receiving agent response, validate:
- Action is in the legal action set.
- Amount (if any) is within bounds.
- On invalid: log, emit `agent.invalid_action`, use fallback (fold if possible, else check).

**Timeout handling**: Wrap every agent call with `TimeoutHandler`. On timeout:
- Log, emit `agent.timeout`.
- Apply fallback action (check if legal, else fold).

### 6.3 Agent Runtime (`packages/agent-runtime`)

**Responsibilities**: Define the `IAgent` interface, provide `MockAgent` base class, wrap agent calls with timeout, provide HTTP/WS adapter stubs.

**`IAgent` interface**:
```typescript
interface IAgent {
  agentId: string;
  name: string;
  requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse>;
}
```

**`MockAgent`**: In-process agent. Receives `AgentDecisionRequest`, returns `AgentDecisionResponse` synchronously (wrapped in Promise). Base class for all local agents.

**`TimeoutHandler`**: Takes `IAgent`, `timeoutMs`, `fallbackAction`. Wraps `requestDecision` call with `Promise.race` against a timeout. On timeout, returns a `fallbackAction` response and emits `agent.timeout`.

**HTTP Agent Adapter (Phase 1 stub)**: Class implementing `IAgent` that would POST to `agent.endpoint`. Phase 1: throw `NotImplementedError`. Phase 2: full implementation.

**WS Agent Adapter (Phase 1 stub)**: Similar stub for WebSocket agents.

### 6.4 Agent Protocol (`packages/agent-protocol`)

**Responsibilities**: Zod schemas for all wire types, TypeScript types inferred from schemas, error codes. This package is the single source of truth for all inter-component type contracts.

**Key schemas**: `AgentDecisionRequestSchema`, `AgentDecisionResponseSchema`, `PublicGameStateSchema`, `PrivatePlayerStateSchema`, `LegalActionSchema`, `GameActionSchema`, `HandSummarySchema`, `ReplayEventSchema`.

### 6.5 Persistence (`packages/persistence`)

**Responsibilities**: Storage abstraction that Phase 1 implements with memory + files, Phase 2 upgrades to PostgreSQL without changing consumers.

**`ITableStore`**:
- `saveTable(table: TableState): Promise<void>`
- `getTable(tableId: string): Promise<TableState | null>`
- `listTables(): Promise<TableState[]>`

**`IHandStore`**:
- `saveHandSummary(hand: HandSummary): Promise<void>`
- `getHandSummary(handId: string): Promise<HandSummary | null>`
- `listHandSummaries(tableId: string): Promise<HandSummary[]>`
- `appendReplayEvent(event: ReplayEvent): Promise<void>`
- `getReplayEvents(handId: string): Promise<ReplayEvent[]>`

**Phase 1 implementation**:
- `MemoryStore`: Maps in memory, cleared on restart.
- `FileStore`: Appends `ReplayEvent`s as JSONL to `output/{tableId}/{handId}.jsonl`, writes `HandSummary` as JSON to `output/{tableId}/{handId}.summary.json`.

### 6.6 API Layer (`apps/api`)

**Responsibilities**: Fastify HTTP server exposing Phase 1 REST API. Uses `TableOrchestrator` and `IHandStore` as its two dependencies. Validates all inputs with Zod.

Phase 1 routes: see Section 10 (API Design).

### 6.7 Realtime Layer (Phase 2)

Phase 1: Not implemented. Events are emitted as an internal `EventEmitter` within `HandRunner` and consumed only by `FileStore`.  
Phase 2: WebSocket server (fastify-websocket) or SSE. Clients subscribe to `tables/:tableId` and receive all `ReplayEvent`s as they happen.

### 6.8 Frontend (Phase 2)

Phase 1: Empty React + Vite scaffold in `apps/web/`. Not built, not started.  
Phase 2: Table viewer, hand history browser, action submission form.

### 6.9 Security Boundary

- `AgentDecisionRequest.privateState` contains only the requesting agent's hole cards.
- `AgentDecisionRequest.publicState` uses `PublicPlayer[]` — no hole cards for opponents.
- All agent inputs/outputs are validated against Zod schemas before use.
- External agents (Phase 2+) run in isolated process or container; platform does not trust agent return values.
- No financial features: any code path that computes real-money values must be blocked at CI.

---

## 7. Core Domain Models

### 7.1 Rank and Suit

```typescript
// packages/shared/src/types.ts

export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'T' | 'J' | 'Q' | 'K' | 'A';

export type Suit = 'c' | 'd' | 'h' | 's'; // clubs, diamonds, hearts, spades
```

Rank ordering (ascending): `2 < 3 < ... < T < J < Q < K < A`.  
Rank numeric value for comparison: 2→2, 3→3, ..., T→10, J→11, Q→12, K→13, A→14.

### 7.2 Card

```typescript
export interface Card {
  rank: Rank;
  suit: Suit;
}
```

JSON example:
```json
{ "rank": "A", "suit": "s" }
```

String representation: `"As"` (rank+suit). Used in logging and hand history display.  
Phase 1 required: yes.

### 7.3 Deck

```typescript
export interface Deck {
  cards: Card[];      // ordered from top; cards[0] is next to deal
  seed: string;       // original seed used to shuffle
  dealtCount: number; // number of cards dealt so far
}
```

JSON example:
```json
{
  "seed": "hand-001",
  "dealtCount": 9,
  "cards": ["<52 card objects, pre-shuffled>"]
}
```

Deck is immutable from engine perspective: `deal(deck, n)` returns `[cards, newDeck]`.  
Phase 1 required: yes.

### 7.4 PlayerInHand

```typescript
export interface PlayerInHand {
  playerId: string;
  seatIndex: number;          // 0-based
  agentId: string;
  stackBefore: number;        // chips at hand start (integer, in chips unit)
  stack: number;              // current chips (decreases as bets are made)
  status: PlayerStatus;       // 'active' | 'folded' | 'all-in' | 'sitting-out'
  totalBetInHand: number;     // total chips committed this entire hand
  currentRoundBet: number;    // chips bet in current betting round
  holeCards: [Card, Card] | null; // null for other players in PublicGameState
}
```

Phase 1 required: yes.

### 7.5 PublicPlayer (what agents see for opponents)

```typescript
export interface PublicPlayer {
  playerId: string;
  seatIndex: number;
  stack: number;
  status: PlayerStatus;
  totalBetInHand: number;
  currentRoundBet: number;
  // holeCards is ABSENT — never serialized to other agents
}
```

Phase 1 required: yes.

### 7.6 Pot and SidePot

```typescript
export interface Pot {
  amount: number;
  eligiblePlayerIds: string[]; // players who can win this pot
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
  capPerPlayer: number; // max each player contributed to reach this pot
}
```

Example (Player A all-in for 100, B for 200, C for 300):
```json
[
  { "amount": 300, "eligiblePlayerIds": ["A","B","C"], "capPerPlayer": 100 },
  { "amount": 200, "eligiblePlayerIds": ["B","C"],     "capPerPlayer": 200 },
  { "amount": 100, "eligiblePlayerIds": ["C"],         "capPerPlayer": 300 }
]
```

Note: The last side pot goes directly back to C since they're the only eligible player.  
Phase 1 required: yes.

### 7.7 ActionType and GameAction

```typescript
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export interface GameAction {
  actionId: string;     // uuid
  handId: string;
  playerId: string;
  phase: HandPhase;     // 'preflop' | 'flop' | 'turn' | 'river'
  actionType: ActionType;
  amount: number;       // chips: 0 for fold/check, callAmount for call, total bet for bet/raise
  stackAfter: number;   // player's stack after this action
  sequence: number;     // 0-based action index within the hand
  timestamp: number;    // Unix ms
}
```

Phase 1 required: yes.

### 7.8 LegalAction

```typescript
export interface LegalAction {
  type: ActionType;
  callAmount?: number;  // present for 'call': how much to add to match current bet
  minAmount?: number;   // present for 'bet'/'raise': minimum total bet
  maxAmount?: number;   // present for 'bet'/'raise'/'all-in': player's entire stack
}
```

Example:
```json
[
  { "type": "fold" },
  { "type": "call", "callAmount": 50 },
  { "type": "raise", "minAmount": 100, "maxAmount": 800 },
  { "type": "all-in", "maxAmount": 800 }
]
```

Phase 1 required: yes.

### 7.9 BettingRoundState

```typescript
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export interface BettingRoundState {
  handId: string;
  phase: HandPhase;
  players: PlayerInHand[];       // ordered by seat, all players (including folded)
  currentActorIndex: number;     // index into players array
  currentRoundMinBet: number;    // amount needed to call (0 if no bet yet in round)
  minRaiseAmount: number;        // minimum raise increment (= last raise size, or BB)
  lastAggressorIndex: number | null; // who last bet/raised — used to detect round end
  roundActions: GameAction[];    // actions in this betting round only
}
```

Phase 1 required: yes.

### 7.10 GameState (full, internal)

```typescript
export interface GameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  deck: Deck;
  players: PlayerInHand[];
  communityCards: Card[];        // 0-5 cards
  pots: Pot[];                   // main pot + side pots
  button: number;                // seat index of dealer button
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentBettingRound: BettingRoundState | null;
  allActions: GameAction[];      // all actions for entire hand
  handNumber: number;
  seed: string;
}
```

Phase 1 required: yes.

### 7.11 PublicGameState (what goes in AgentDecisionRequest)

```typescript
export interface PublicGameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  players: PublicPlayer[];       // NO hole cards for any player
  communityCards: Card[];
  pots: Pot[];
  button: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentActorIndex: number;
  currentRoundMinBet: number;
  minRaiseAmount: number;
  allActions: GameAction[];      // full public action history
}
```

Phase 1 required: yes.

### 7.12 PrivatePlayerState

```typescript
export interface PrivatePlayerState {
  playerId: string;
  holeCards: [Card, Card];
}
```

This is included in `AgentDecisionRequest` and contains **only** the requesting agent's hole cards. Never included for other players.

Phase 1 required: yes.

### 7.13 AgentDecisionRequest

```typescript
export interface AgentDecisionRequest {
  requestId: string;           // uuid, for correlating response
  handId: string;
  tableId: string;
  agentId: string;             // the agent being asked
  publicState: PublicGameState;
  privateState: PrivatePlayerState; // ONLY this agent's hole cards
  legalActions: LegalAction[];
  timeoutMs: number;
}
```

JSON example:
```json
{
  "requestId": "req-abc123",
  "handId": "hand-001",
  "tableId": "table-xyz",
  "agentId": "agent-random-1",
  "publicState": {
    "handId": "hand-001",
    "tableId": "table-xyz",
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
    "currentActorIndex": 0,
    "currentRoundMinBet": 0,
    "minRaiseAmount": 50,
    "allActions": []
  },
  "privateState": {
    "playerId": "p1",
    "holeCards": [{ "rank": "A", "suit": "c" }, { "rank": "A", "suit": "d" }]
  },
  "legalActions": [
    { "type": "check" },
    { "type": "bet", "minAmount": 50, "maxAmount": 950 },
    { "type": "all-in", "maxAmount": 950 }
  ],
  "timeoutMs": 5000
}
```

Phase 1 required: yes.

### 7.14 AgentDecisionResponse

```typescript
export interface AgentDecisionResponse {
  requestId: string;       // must match AgentDecisionRequest.requestId
  agentId: string;
  actionType: ActionType;
  amount?: number;         // required for 'bet'/'raise', optional for 'all-in', absent for others
}
```

JSON example:
```json
{
  "requestId": "req-abc123",
  "agentId": "agent-random-1",
  "actionType": "bet",
  "amount": 100
}
```

Phase 1 required: yes.

### 7.15 HandEvaluation

```typescript
export type HandRankCategory =
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush';
  // Royal flush = straight_flush with high card A

export interface HandEvaluation {
  category: HandRankCategory;
  categoryRank: number;     // 0=high_card, 8=straight_flush
  tiebreakers: number[];    // descending rank values for tie-breaking
  bestCards: [Card, Card, Card, Card, Card]; // best 5 cards used
  description: string;      // e.g. "Full House, Aces over Kings"
}
```

Phase 1 required: yes.

### 7.16 HandSummary (hand history)

```typescript
export interface HandSummary {
  handId: string;
  tableId: string;
  handNumber: number;
  seed: string;
  startedAt: number;       // Unix ms
  completedAt: number;
  players: HandPlayerSummary[];
  blindConfig: BlindConfig;
  communityCards: Card[];
  allActions: GameAction[];
  results: HandResult[];
  finalPots: Pot[];
}

export interface HandPlayerSummary {
  playerId: string;
  agentId: string;
  seatIndex: number;
  stackBefore: number;
  stackAfter: number;
  holeCards: [Card, Card]; // revealed at end of hand (all players)
  handEvaluation?: HandEvaluation; // only if reached showdown
}

export interface HandResult {
  playerId: string;
  seatIndex: number;
  potIndex: number;        // 0 = main pot, 1+ = side pots
  winAmount: number;
  netChange: number;       // winAmount - totalBetInHand
}
```

Phase 1 required: yes.

### 7.17 ReplayEvent

```typescript
export interface ReplayEvent {
  eventId: string;         // uuid
  handId: string;
  tableId: string;
  sequence: number;        // monotonically increasing within a hand
  eventType: string;       // see Section 11 (Realtime Events)
  timestamp: number;       // Unix ms
  data: Record<string, unknown>; // event-specific payload
}
```

Phase 1 required: yes.

### 7.18 TableConfig

```typescript
export interface BlindConfig {
  smallBlind: number;  // e.g. 25
  bigBlind: number;    // e.g. 50
  ante: number;        // 0 if no ante
}

export interface TableConfig {
  tableId: string;
  name: string;
  maxSeats: number;          // 2-9 inclusive
  blindConfig: BlindConfig;
  defaultTimeoutMs: number;  // per-agent decision timeout; default 5000
  seed?: string;             // base seed; each hand uses `${seed}-${handNumber}`
}
```

Phase 1 required: yes.

### 7.19 TableState

```typescript
export interface SeatInfo {
  seatIndex: number;
  agentId: string;
  playerId: string;
  stack: number;
  status: PlayerStatus;
}

export interface TableState {
  tableId: string;
  config: TableConfig;
  status: 'waiting' | 'playing' | 'paused';
  seats: (SeatInfo | null)[];  // length = config.maxSeats; null = empty
  currentHandId: string | null;
  handNumber: number;          // increments after each completed hand
  button: number;              // current button seat index
  createdAt: number;
}
```

Phase 1 required: yes.

### 7.20 AgentInfo

```typescript
export type AgentAdapterType = 'mock' | 'http' | 'websocket' | 'openclaw';

export interface AgentInfo {
  agentId: string;
  name: string;
  adapterType: AgentAdapterType;
  endpoint?: string;   // for 'http' and 'websocket'
  metadata?: Record<string, string>; // arbitrary agent metadata
  registeredAt: number;
}
```

Phase 1 required: yes (mock only).

---

## 8. Texas Hold'em Rules

### 8.1 Supported Rules (Phase 1)

- **Variant**: No-Limit Texas Hold'em (NLHE).
- **Players**: 2 to 9 per table.
- **Blinds**: Small blind and big blind. Ante optional (default 0).
- **Button rotation**: Button advances clockwise each hand. Heads-up rule: button = small blind.
- **Betting rounds**: Preflop, Flop, Turn, River.
- **Actions**: fold, check, call, bet, raise, all-in.
- **Min-raise rule**: Minimum raise = size of the last bet or raise in this round (or big blind if first bet). Example: BB=50, player bets 100, min-raise is to 150 (raise by 100).
- **All-in**: Player whose action is all-in puts their entire remaining stack in. All-in does not re-open action to players who have already acted unless all-in amount exceeds current bet level by at least the minimum raise amount.
- **Side pots**: Computed whenever a player is all-in for less than the full bet. Multiple side pots are supported.
- **Showdown**: If 2+ players remain after river betting, all must show. Best hand wins pot. Ties split pot evenly (remainder chips go to first player left of button).
- **Bust-out**: Player whose stack reaches 0 is removed from the table after the hand completes.
- **Agent timeout**: Default 5000ms. On timeout: check if legal, else fold.
- **Agent invalid action**: On invalid response: check if legal, else fold. Log the invalid action.
- **Hand ends early**: If all players fold to one player, that player wins all pots immediately (no showdown).

### 8.2 Not Supported (Phase 1)

- Rake.
- Rebuy / add-on.
- Tournament blind escalation.
- Pot-Limit or Fixed-Limit betting.
- Straddle.
- Run-it-twice.
- Real money.

### 8.3 Phase Breakdown for Incremental Implementation

- **MVP-1**: Basic dealing, blinds, single betting round, showdown (no all-in/side-pot).
- **MVP-2**: Full raise/min-raise rules, all-in, side pots, complete betting round state machine.
- **MVP-3**: Multi-hand simulation, hand history, replay events, API, external agents.

---

## 9. Agent Protocol

See `docs/agent-poker-platform-api-and-protocol.md` Section 2 for full protocol definition.

### Summary

1. **Registration**: Agent is registered with `AgentInfo` (in Phase 1, only mock type).
2. **Seat assignment**: Agent is assigned to a seat via `POST /api/v1/tables/:tableId/agents`.
3. **Decision request**: `HandRunner` calls `agent.requestDecision(AgentDecisionRequest)`. Decision request contains only public state and this agent's private hole cards.
4. **Decision response**: Agent returns `AgentDecisionResponse` within `timeoutMs`.
5. **Validation**: Platform validates response against legal actions. Invalid → fallback action.
6. **Timeout**: `TimeoutHandler` uses `Promise.race`. On expiry → fallback action.
7. **Information isolation**: `PublicGameState` never contains opponent hole cards. Only `PrivatePlayerState` contains hole cards, and it belongs to the requesting agent only.

---

## 10. API Design

See `docs/agent-poker-platform-api-and-protocol.md` Section 1 for complete API reference with request/response schemas and error codes.

### Phase 1 Endpoints Summary

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/tables | Create a new table |
| GET | /api/v1/tables | List all tables |
| GET | /api/v1/tables/:tableId | Get table state |
| DELETE | /api/v1/tables/:tableId | Delete table |
| POST | /api/v1/tables/:tableId/agents | Add agent to table |
| DELETE | /api/v1/tables/:tableId/agents/:agentId | Remove agent from table |
| POST | /api/v1/tables/:tableId/hands/start | Start next hand |
| GET | /api/v1/tables/:tableId/state | Get current game state (public) |
| GET | /api/v1/tables/:tableId/hands | List hand summaries |
| GET | /api/v1/tables/:tableId/hands/:handId | Get hand summary |
| GET | /api/v1/tables/:tableId/hands/:handId/replay | Get replay events |
| POST | /api/v1/simulate | Run N hands with given config |

---

## 11. Realtime Events

All events follow this envelope:
```typescript
{
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: { ... }; // event-specific
}
```

### Event Catalog

| eventType | When emitted | data fields |
|---|---|---|
| `table.created` | Table created | `tableId`, `config` |
| `agent.seated` | Agent assigned to seat | `agentId`, `seatIndex`, `stack` |
| `hand.started` | Hand begins | `handId`, `handNumber`, `seed`, `playerIds`, `button` |
| `antes.posted` | Antes collected | `antes: [{playerId, amount}]` |
| `blinds.posted` | Blinds collected | `smallBlind: {playerId, amount}`, `bigBlind: {playerId, amount}` |
| `hole_cards.dealt` | Hole cards dealt (private per-agent) | `playerId`, `holeCards: [Card, Card]` |
| `betting_round.started` | New betting round begins | `phase`, `communityCards` |
| `community_cards.dealt` | Flop/turn/river cards revealed | `phase`, `cards: Card[]` |
| `action.requested` | Platform requests agent decision | `agentId`, `playerId`, `legalActions` |
| `action.received` | Agent response received | `agentId`, `actionType`, `amount` |
| `action.applied` | Action validated and applied | `playerId`, `actionType`, `amount`, `stackAfter`, `potTotal` |
| `betting_round.complete` | Betting round ends | `phase`, `pots` |
| `showdown.started` | Showdown begins | `playerIds`, `holeCards` (all revealed) |
| `showdown.result` | Individual hand evaluation | `playerId`, `holeCards`, `handEvaluation` |
| `pot.awarded` | Pot distributed | `potIndex`, `amount`, `winnerIds`, `splitAmount` |
| `hand.completed` | Hand fully resolved | `handId`, `results`, `finalStacks` |
| `agent.timeout` | Agent timed out | `agentId`, `requestId`, `fallbackAction` |
| `agent.invalid_action` | Agent returned invalid action | `agentId`, `received`, `fallbackAction` |

Phase 1: Events emitted to internal EventEmitter and consumed by FileStore (JSONL append).  
Phase 2: Events also broadcast over WebSocket to subscribed clients.

---

## 12. Data Storage

### 12.1 Phase 1

**In-memory**:
- `MemoryStore` holds `TableState[]` and `HandSummary[]` in Maps.
- Cleared on process restart.
- Sufficient for Phase 1 simulation and API testing.

**File system**:
- `FileStore` writes to `examples/local-simulation/output/{tableId}/`.
- `{handId}.summary.json` — full `HandSummary` as JSON.
- `{handId}.replay.jsonl` — one `ReplayEvent` per line.
- Directory created automatically on first write.

**Seed reproducibility**:
- Table seed is set in `TableConfig.seed`.
- Each hand uses seed `${tableConfig.seed}-${handNumber}`.
- Same table seed → same deck order → same hand outcome (given same agent decisions).
- Replay test: run hand with seed "test-seed-1", compare `HandSummary` from two runs.

### 12.2 Event Sourcing Note

Phase 1 does not implement full event sourcing. `ReplayEvent`s are an audit log, not the primary state. The primary state is `GameState` held in memory during a hand.

A replay validator (used in tests) can reconstruct key state transitions from `ReplayEvent`s to verify correctness.

### 12.3 PostgreSQL Upgrade Path (Phase 2)

All storage is behind `ITableStore` and `IHandStore` interfaces. PostgreSQL implementation replaces `MemoryStore` and `FileStore` without touching table-orchestrator or API code. Schema:

```sql
-- tables
CREATE TABLE tables (
  table_id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  status TEXT NOT NULL,
  seats JSONB NOT NULL,
  hand_number INTEGER NOT NULL DEFAULT 0,
  button INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

-- hands
CREATE TABLE hands (
  hand_id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES tables(table_id),
  hand_number INTEGER NOT NULL,
  seed TEXT NOT NULL,
  summary JSONB NOT NULL,
  started_at BIGINT NOT NULL,
  completed_at BIGINT NOT NULL
);

-- replay_events
CREATE TABLE replay_events (
  event_id TEXT PRIMARY KEY,
  hand_id TEXT NOT NULL REFERENCES hands(hand_id),
  table_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  data JSONB NOT NULL
);

-- agents
CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  endpoint TEXT,
  metadata JSONB,
  registered_at BIGINT NOT NULL
);
```

---

## 13. Security Boundaries

1. **Private information isolation**: `AgentDecisionRequest` is constructed per-agent. `privateState` contains only that agent's hole cards. `publicState.players` is `PublicPlayer[]` with no hole cards.

2. **Input validation**: All API request bodies and agent responses are validated with Zod schemas before processing. Invalid inputs return structured error responses.

3. **Timeout enforcement**: `TimeoutHandler` uses `Promise.race` with a fixed deadline. Agent cannot stall a hand indefinitely.

4. **Invalid action handling**: If agent returns an action not in `legalActions`, platform applies fallback (check or fold). Platform never allows illegal game state.

5. **No financial features**: The codebase must never implement: real-money wagers, currency exchange rates, payment processing, odds for real betting, or any feature that constitutes gambling. CI must block PRs that add such features.

6. **External agent isolation (Phase 2)**: HTTP agents are called with a timeout. Malformed responses are rejected by Zod validation. Agent exceptions are caught and logged; they never propagate to game state.

---

## 14. Acceptance Criteria (Phase 1)

All of the following must be true for Phase 1 to be complete:

- [ ] `pnpm install && pnpm run build` succeeds with zero TypeScript errors.
- [ ] `pnpm run test` all tests pass.
- [ ] Seeded deck shuffle is deterministic: two calls with the same seed produce identical card order.
- [ ] Hand evaluator correctly identifies all 9 hand categories with known test inputs.
- [ ] All-in and side-pot calculation correct for 3-player all-in scenario.
- [ ] A 6-player simulation with RandomAgents completes 5 hands without throwing.
- [ ] Hand history JSONL file written to `examples/local-simulation/output/`.
- [ ] Replay events for one hand can be read back and verified against `HandSummary`.
- [ ] Same seed → same `HandSummary` in two independent runs.
- [ ] API endpoint `POST /api/v1/tables` creates a table and returns `tableId`.
- [ ] API endpoint `POST /api/v1/simulate` runs a simulation and returns results.
- [ ] Agent timeout handling: MockAgent that delays >timeoutMs is auto-folded.
- [ ] Agent invalid action: MockAgent returning illegal action is folded (or checked).
- [ ] `AgentDecisionRequest` for player A never contains player B's hole cards.
