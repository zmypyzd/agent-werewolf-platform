# Agent Poker Platform — Implementation Plan

Version: 1.0.0  
Date: 2026-04-24  
Prerequisite: Read `docs/agent-poker-platform-greenfield-spec.md` before starting.

---

## Overview

This document is the step-by-step build guide for `agent-poker-platform`. It is organized as numbered tasks. Each task lists:
- Input (what must exist before starting)
- Files to create/modify
- Acceptance test
- Command to verify completion

**Parallelizable tasks are marked with `[PARALLEL]`.** Tasks with a `[SERIAL after N]` marker must wait for task N to complete first.

**Tech stack is frozen**: TypeScript 5.5, Node.js 20 LTS, pnpm 9, Vitest 2, Fastify 4, Zod 3.

---

## Task 0 — Initialize Monorepo

**Input**: Empty directory `agent-poker-platform/`.

**Files to create**:

### `package.json` (workspace root)
```json
{
  "name": "agent-poker-platform",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run --workspace vitest.workspace.ts",
    "test:watch": "vitest --workspace vitest.workspace.ts",
    "test:coverage": "vitest run --coverage --workspace vitest.workspace.ts",
    "lint": "pnpm -r exec tsc -b --noEmit",
    "dev:api": "pnpm --filter api dev",
    "demo": "pnpm --filter local-simulation start"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "tsx": "^4.0.0"
  }
}
```

### `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'examples/*'
```

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

### `vitest.workspace.ts`
```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
]);
```

### `vitest.config.ts` (root, for global settings)
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

### `CLAUDE.md` (project root)
Copy content from `docs/agent-poker-platform-CLAUDE.md` verbatim.

### `.gitignore`
```
node_modules/
dist/
*.tsbuildinfo
examples/local-simulation/output/*.jsonl
examples/local-simulation/output/*.json
!examples/local-simulation/output/.gitkeep
.env
```

**Verify**:
```bash
pnpm install   # should succeed with no packages yet
```

---

## Task 1 — `packages/shared` [PARALLEL]

**Input**: Task 0 complete.

**Responsibility**: All domain types, constants, and error classes shared across packages. No runtime logic. No dependencies except Node.js builtins.

### `packages/shared/package.json`
```json
{
  "name": "@agent-poker/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

### `packages/shared/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"]
}
```

### `packages/shared/vitest.config.ts`
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true } });
```

### `packages/shared/src/types.ts`

Full domain types (implement all of these):

```typescript
export type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A';
export type Suit = 'c'|'d'|'h'|'s';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface Deck {
  cards: Card[];
  seed: string;
  dealtCount: number;
}

export type ActionType = 'fold'|'check'|'call'|'bet'|'raise'|'all-in';
export type HandPhase = 'preflop'|'flop'|'turn'|'river'|'showdown'|'complete';
export type PlayerStatus = 'waiting'|'active'|'folded'|'all-in'|'sitting-out';
export type TableStatus = 'waiting'|'playing'|'paused';
export type AgentAdapterType = 'mock'|'http'|'websocket'|'openclaw';
export type HandRankCategory =
  | 'high_card'|'one_pair'|'two_pair'|'three_of_a_kind'
  | 'straight'|'flush'|'full_house'|'four_of_a_kind'|'straight_flush';

export interface LegalAction {
  type: ActionType;
  callAmount?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
  capPerPlayer: number;
}

export interface PlayerInHand {
  playerId: string;
  seatIndex: number;
  agentId: string;
  stackBefore: number;
  stack: number;
  status: PlayerStatus;
  totalBetInHand: number;
  currentRoundBet: number;
  holeCards: [Card, Card] | null;
}

export interface PublicPlayer {
  playerId: string;
  seatIndex: number;
  stack: number;
  status: PlayerStatus;
  totalBetInHand: number;
  currentRoundBet: number;
}

export interface GameAction {
  actionId: string;
  handId: string;
  playerId: string;
  phase: HandPhase;
  actionType: ActionType;
  amount: number;
  stackAfter: number;
  sequence: number;
  timestamp: number;
}

export interface BettingRoundState {
  handId: string;
  phase: HandPhase;
  players: PlayerInHand[];
  currentActorIndex: number;
  currentRoundMinBet: number;
  minRaiseAmount: number;
  lastAggressorIndex: number | null;
  roundActions: GameAction[];
}

export interface GameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  deck: Deck;
  players: PlayerInHand[];
  communityCards: Card[];
  pots: Pot[];
  button: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentBettingRound: BettingRoundState | null;
  allActions: GameAction[];
  handNumber: number;
  seed: string;
}

export interface PublicGameState {
  handId: string;
  tableId: string;
  phase: HandPhase;
  players: PublicPlayer[];
  communityCards: Card[];
  pots: Pot[];
  button: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentActorIndex: number;
  currentRoundMinBet: number;
  minRaiseAmount: number;
  allActions: GameAction[];
}

export interface PrivatePlayerState {
  playerId: string;
  holeCards: [Card, Card];
}

export interface AgentDecisionRequest {
  requestId: string;
  handId: string;
  tableId: string;
  agentId: string;
  publicState: PublicGameState;
  privateState: PrivatePlayerState;
  legalActions: LegalAction[];
  timeoutMs: number;
}

export interface AgentDecisionResponse {
  requestId: string;
  agentId: string;
  actionType: ActionType;
  amount?: number;
}

export interface HandEvaluation {
  category: HandRankCategory;
  categoryRank: number;
  tiebreakers: number[];
  bestCards: [Card, Card, Card, Card, Card];
  description: string;
}

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface TableConfig {
  tableId: string;
  name: string;
  maxSeats: number;
  blindConfig: BlindConfig;
  defaultTimeoutMs: number;
  seed?: string;
}

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
  status: TableStatus;
  seats: (SeatInfo | null)[];
  currentHandId: string | null;
  handNumber: number;
  button: number;
  createdAt: number;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  adapterType: AgentAdapterType;
  endpoint?: string;
  metadata?: Record<string, string>;
  registeredAt: number;
}

export interface HandPlayerSummary {
  playerId: string;
  agentId: string;
  seatIndex: number;
  stackBefore: number;
  stackAfter: number;
  holeCards: [Card, Card];
  handEvaluation?: HandEvaluation;
}

export interface HandResult {
  playerId: string;
  seatIndex: number;
  potIndex: number;
  winAmount: number;
  netChange: number;
}

export interface HandSummary {
  handId: string;
  tableId: string;
  handNumber: number;
  seed: string;
  startedAt: number;
  completedAt: number;
  players: HandPlayerSummary[];
  blindConfig: BlindConfig;
  communityCards: Card[];
  allActions: GameAction[];
  results: HandResult[];
  finalPots: Pot[];
}

export interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}
```

### `packages/shared/src/constants.ts`
```typescript
import type { Rank, Suit, HandRankCategory } from './types.js';

export const RANKS: Rank[] = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
export const SUITS: Suit[] = ['c','d','h','s'];
export const RANK_VALUES: Record<Rank, number> = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
  'T':10,'J':11,'Q':12,'K':13,'A':14
};
export const HAND_CATEGORY_RANK: Record<HandRankCategory, number> = {
  'high_card':0,'one_pair':1,'two_pair':2,'three_of_a_kind':3,
  'straight':4,'flush':5,'full_house':6,'four_of_a_kind':7,'straight_flush':8
};
export const DEFAULT_TIMEOUT_MS = 5000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;
export const DECK_SIZE = 52;
export const HOLE_CARDS_PER_PLAYER = 2;
export const COMMUNITY_CARDS_TOTAL = 5;
```

### `packages/shared/src/errors.ts`
```typescript
export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}
export class InvalidActionError extends AppError {
  constructor(reason: string) { super('INVALID_ACTION', reason); }
}
export class AgentTimeoutError extends AppError {
  constructor(agentId: string, requestId: string) {
    super('AGENT_TIMEOUT', `Agent ${agentId} timed out on request ${requestId}`);
  }
}
export class TableFullError extends AppError {
  constructor(tableId: string) { super('TABLE_FULL', `Table ${tableId} is full`); }
}
export class HandInProgressError extends AppError {
  constructor(tableId: string) { super('HAND_IN_PROGRESS', `Table ${tableId} has a hand in progress`); }
}
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) { super('NOT_FOUND', `${resource} ${id} not found`); }
}
export class NotEnoughPlayersError extends AppError {
  constructor(count: number) { super('NOT_ENOUGH_PLAYERS', `Need at least 2 players, have ${count}`); }
}
```

### `packages/shared/src/index.ts`
```typescript
export * from './types.js';
export * from './constants.js';
export * from './errors.js';
```

**Acceptance**: `pnpm --filter @agent-poker/shared run build` zero errors.

---

## Task 2 — `packages/agent-protocol` [PARALLEL with Task 1]

**Input**: Task 0 complete.

**Responsibility**: Zod schemas for all wire types. TypeScript types are inferred from Zod schemas.

### Key schemas in `packages/agent-protocol/src/schemas.ts`

Implement Zod schemas for: `CardSchema`, `RankSchema`, `SuitSchema`, `ActionTypeSchema`, `HandPhaseSchema`, `PlayerStatusSchema`, `LegalActionSchema`, `PotSchema`, `PublicPlayerSchema`, `GameActionSchema`, `PublicGameStateSchema`, `PrivatePlayerStateSchema`, `AgentDecisionRequestSchema`, `AgentDecisionResponseSchema`, `HandSummarySchema`, `ReplayEventSchema`, `TableConfigSchema`, `BlindConfigSchema`.

### `packages/agent-protocol/src/types.ts`
```typescript
import { z } from 'zod';
import * as schemas from './schemas.js';

export type AgentDecisionRequestZod = z.infer<typeof schemas.AgentDecisionRequestSchema>;
export type AgentDecisionResponseZod = z.infer<typeof schemas.AgentDecisionResponseSchema>;
// ... infer all
```

**Acceptance**: `pnpm --filter @agent-poker/agent-protocol run build` zero errors.

---

## Task 3 — `packages/poker-engine`: Card + Deck [SERIAL after Task 1]

**Responsibility**: Card utilities and seeded deck.

### `packages/poker-engine/src/prng.ts`
Implement `mulberry32` PRNG and `createSeededRng(seed: string): () => number`.

Algorithm:
```typescript
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return h;
}

export function createSeededRng(seed: string): () => number {
  return mulberry32(djb2Hash(seed));
}
```

### `packages/poker-engine/src/card.ts`
```typescript
import { Card, Rank, Suit } from '@agent-poker/shared';

export function cardToString(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function cardFromString(s: string): Card {
  if (s.length < 2 || s.length > 3) throw new Error(`Invalid card string: ${s}`);
  const rank = s.slice(0, -1) as Rank;
  const suit = s.slice(-1) as Suit;
  return { rank, suit };
}
```

### `packages/poker-engine/src/deck.ts`
Implement `createShuffledDeck(seed: string): Deck` using Fisher-Yates with `createSeededRng`.  
Implement `deal(deck: Deck, n: number): [Card[], Deck]`.

### `packages/poker-engine/src/__tests__/deck.test.ts`
```typescript
describe('createShuffledDeck', () => {
  it('returns 52 unique cards');
  it('same seed → same card order');
  it('different seeds → different card order (with high probability)');
});
describe('deal', () => {
  it('returns n cards starting from dealtCount');
  it('advances dealtCount by n');
  it('original deck is unchanged (immutable)');
  it('throws if not enough cards remain');
});
```

**Verify**: `pnpm --filter @agent-poker/poker-engine run test -- --testPathPattern=deck` passes.

---

## Task 4 — `packages/poker-engine`: Hand Evaluator [SERIAL after Task 3]

### `packages/poker-engine/src/hand-evaluator.ts`

`evaluateHand(cards: Card[]): HandEvaluation` — exactly 5 cards.

Detection algorithm (in priority order):
1. Build `rankCounts: Map<Rank, number>` and `suitCounts: Map<Suit, number>`.
2. `isFlush`: one suit appears ≥5 times (for exactly 5 cards: all same suit).
3. `isStraight`: sort distinct rank values, check for 5 consecutive. Special case: A-2-3-4-5 (Ace counts as 1).
4. `isStraightFlush`: isFlush AND isStraight.
5. `is4OfAKind`: any rank count === 4.
6. `isFullHouse`: rank count of 3 + rank count of 2.
7. `is3OfAKind`: rank count of 3 (not full house).
8. `is2Pair`: two different ranks each with count 2.
9. `is1Pair`: one rank with count 2.
10. Else: high card.

`tiebreakers` construction:
- `straight_flush` / `straight`: [high card rank value]. Wheel = [5].
- `four_of_a_kind`: [quad rank value, kicker rank value].
- `full_house`: [trip rank value, pair rank value].
- `flush`: [rank values sorted descending, 5 values].
- `three_of_a_kind`: [trip rank value, kicker1, kicker2].
- `two_pair`: [high pair rank, low pair rank, kicker].
- `one_pair`: [pair rank, kicker1, kicker2, kicker3].
- `high_card`: [rank values sorted descending, 5 values].

`bestHandFrom7(cards: Card[]): HandEvaluation`:
- Generate all C(7,5) = 21 five-card combinations.
- Evaluate each.
- Return the best one (highest by `compareHands`).

`compareHands(a: HandEvaluation, b: HandEvaluation): -1 | 0 | 1`:
- Compare `categoryRank` first.
- For tie: compare `tiebreakers` element by element.
- If all equal: return 0 (tie).

### `packages/poker-engine/src/__tests__/hand-evaluator.test.ts`

Required test cases (use `cardFromString` to create cards):

```typescript
// straight_flush: '9h','8h','7h','6h','5h'
// four_of_a_kind: 'As','Ah','Ad','Ac','Kh' → tiebreakers [14, 13]
// full_house: 'As','Ah','Ad','Ks','Kh' → tiebreakers [14, 13]
// flush: 'Ah','Qh','9h','7h','3h' → tiebreakers [14,12,9,7,3]
// straight: '9c','8h','7d','6s','5c' → tiebreakers [9]
// straight (wheel): 'Ah','2c','3d','4s','5h' → tiebreakers [5]
// three_of_a_kind: 'Ah','As','Ad','Kh','Qc'
// two_pair: 'Ah','As','Kh','Ks','Qc'
// one_pair: 'Ah','As','Kh','Qc','Jd'
// high_card: 'Ah','Kc','Qd','Jh','9s'
//
// 7-card: ['Ah','Ad','As','Ac','Kh','Qd','2c'] → four_of_a_kind aces
// compare: full_house beats flush
// compare: higher pair wins
// tie: same hand evaluates to 0
```

**Verify**: `pnpm --filter @agent-poker/poker-engine run test` hand-evaluator tests pass.

---

## Task 5 — `packages/poker-engine`: Legal Actions + Pot Calculator [SERIAL after Task 3]

### `packages/poker-engine/src/legal-actions.ts`

```typescript
export function computeLegalActions(
  player: PlayerInHand,
  roundState: { currentRoundMinBet: number; minRaiseAmount: number },
  bigBlind: number,
): LegalAction[]
```

Rules (implement exactly as described in spec Section 8.1).

### `packages/poker-engine/src/pot-calculator.ts`

```typescript
interface PlayerContribution {
  playerId: string;
  totalBetInHand: number;
  status: PlayerStatus;
}

export function computePots(players: PlayerContribution[]): Pot[]
```

Algorithm:
1. Collect all unique all-in bet amounts (from all-in players' `totalBetInHand`), sort ascending.
2. For each level, compute how much each non-folded player contributed up to that cap.
3. Eligible = all non-folded players whose `totalBetInHand >= cap`.
4. Remaining after all caps = main eligible pot.

### Tests

`legal-actions.test.ts`:
```typescript
// check available when no bet
// fold+call available when facing bet
// raise available with correct min/max
// all-in always available with stack as maxAmount
// only all-in (as call) + fold when stack < call amount
// no actions if player is folded or all-in
```

`pot-calculator.test.ts`:
```typescript
// 2 players equal bets → 1 pot, both eligible, correct amount
// Player A all-in 100, B bets 200, C bets 300 → 3 pots: [300,AB+C], [200,BC], [100,C]
  // Note: pot[2] = 100*1 C only — goes back to C
// Folded player contributes chips but is NOT eligible
// Two players all-in at same amount → merged into single pot
// 4 players, complex all-in tree
```

**Verify**: All new tests pass.

---

## Task 6 — `packages/poker-engine`: Betting Round + Showdown [SERIAL after Tasks 4, 5]

### `packages/poker-engine/src/betting-round.ts`

```typescript
export function applyAction(
  state: BettingRoundState,
  action: { playerId: string; actionType: ActionType; amount: number },
): BettingRoundState

export function isBettingRoundComplete(state: BettingRoundState): boolean

export function getNextActiveActorIndex(state: BettingRoundState): number | null
```

`isBettingRoundComplete` logic:
- Count players who are `active` (not folded, not all-in).
- If 0 or 1 active players: round complete.
- Else: round complete when every active player has acted in this round AND all active players have `currentRoundBet === state.currentRoundMinBet`.
- Implementation: after advancing actor, if `currentActorIndex === lastAggressorIndex` (or if no aggressor and everyone acted once), round is complete.

### `packages/poker-engine/src/showdown.ts`

```typescript
export interface PotAward {
  potIndex: number;
  amount: number;
  winnerIds: string[];
  splitAmount: number;
}

export function determineWinners(
  pots: Pot[],
  playerHands: Map<string, HandEvaluation>,
  buttonSeatOrder: string[], // tie-break: first player left of button gets remainder chip
): PotAward[]
```

For tie/split: `Math.floor(amount / winners.length)` per winner, remainder to first in `buttonSeatOrder` who is a winner.

### Tests

`betting-round.test.ts`:
```typescript
// check action advances actor correctly
// bet action sets currentRoundMinBet and updates lastAggressor
// raise updates minRaiseAmount
// round complete after all players checked (no bet)
// round complete after re-raise and everyone called
// round complete when everyone folds to one player
// all-in player skipped in subsequent actor rotation
```

`showdown.test.ts`:
```typescript
// single winner wins full pot
// two-way tie splits evenly
// three-way tie with odd chip — first left of button gets remainder
// side pot winner is different from main pot winner
// player who folded wins nothing even if they had best hand
```

**Verify**: `pnpm --filter @agent-poker/poker-engine run test` — all tests pass.

---

## Task 7 — `packages/persistence` [PARALLEL with Tasks 3–6, SERIAL after Tasks 1, 2]

### `packages/persistence/src/store-interface.ts`
Define `ITableStore` and `IHandStore` interfaces as described in spec Section 6.5.

### `packages/persistence/src/memory-store.ts`
Implement both interfaces using `Map<string, ...>`. Replay events stored as `Map<string, ReplayEvent[]>`.

### `packages/persistence/src/file-store.ts`
- Implements only `IHandStore` (tables stay in memory in Phase 1).
- `appendReplayEvent`: appends JSON line to `{baseDir}/{tableId}/{handId}.replay.jsonl`.
- `saveHandSummary`: writes JSON to `{baseDir}/{tableId}/{handId}.summary.json`.
- `getReplayEvents`: reads and parses JSONL file. Returns `[]` if file doesn't exist.
- Directory creation: `fs.mkdirSync(dir, { recursive: true })`.

### `packages/persistence/src/__tests__/memory-store.test.ts`
Test: save/get/list/delete table, save/get/list hand, appendReplayEvent, getReplayEvents.

### `packages/persistence/src/__tests__/file-store.test.ts`
Use `os.tmpdir() + '/' + randomUUID()` as base dir. Test append + read round-trip. Clean up with `afterEach`.

**Verify**: `pnpm --filter @agent-poker/persistence run test` all pass.

---

## Task 8 — `packages/agent-runtime` [PARALLEL with Tasks 3–7, SERIAL after Tasks 1, 2]

### `packages/agent-runtime/src/agent-interface.ts`
```typescript
import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';
export interface IAgent {
  readonly agentId: string;
  readonly name: string;
  requestDecision(req: AgentDecisionRequest): Promise<AgentDecisionResponse>;
}
```

### `packages/agent-runtime/src/mock-agent.ts`
Abstract base class implementing `IAgent`. Subclasses only implement `requestDecision`.

### `packages/agent-runtime/src/random-mock-agent.ts`
Picks uniformly random action from `legalActions`. For `bet`/`raise`: picks random amount in `[minAmount, maxAmount]`. Falls back to check if legal, else fold if something goes wrong.

### `packages/agent-runtime/src/timeout-handler.ts`
`Promise.race` between agent's decision and a `setTimeout` rejection. On timeout: return fallback (check if legal, else fold). See spec Section 6.3 for details.

### `packages/agent-runtime/src/http-agent-adapter.ts`
STUB: throws `Error('HttpAgentAdapter not implemented in Phase 1')`.

### `packages/agent-runtime/src/ws-agent-adapter.ts`
STUB: throws `Error('WsAgentAdapter not implemented in Phase 1')`.

### Tests

`mock-agent.test.ts`:
```typescript
// RandomMockAgent always returns actionType in legalActions
// RandomMockAgent with only fold available → returns fold
// RandomMockAgent with bet available → returns amount in [min, max]
```

`timeout-handler.test.ts`:
```typescript
// Agent that resolves within timeoutMs → not timed out
// Agent that delays > timeoutMs → timedOut: true, fallback action returned
// Fallback is 'check' when check is legal, 'fold' otherwise
// vi.useFakeTimers() for deterministic timeout testing
```

**Verify**: `pnpm --filter @agent-poker/agent-runtime run test` all pass.

---

## Task 9 — `packages/table-orchestrator` [SERIAL after Tasks 6, 7, 8]

**This is the most complex package. Implement in sub-order: 9a → 9b → 9c.**

### 9a. `table.ts`

```typescript
export class Table {
  private state: TableState;
  constructor(config: TableConfig, private store: ITableStore) {
    this.state = initTableState(config);
  }
  async save(): Promise<void>
  async addAgent(agentId: string, info: AgentInfo, buyIn: number): Promise<SeatInfo>
  async removeAgent(agentId: string): Promise<void>
  getState(): TableState
  getActivePlayers(): SeatInfo[]
  nextButtonPosition(): number
}
```

`addAgent`: find first null seat, assign agent, deduct buy-in. Throw `TableFullError` if no empty seat.

### 9b. `hand-runner.ts`

```typescript
export class HandRunner {
  constructor(
    private gameState: GameState,
    private agents: Map<string, IAgent>,
    private handStore: IHandStore,
    private emitter: EventEmitter,
    private timeoutMs: number,
  ) {}

  async run(): Promise<HandSummary>
}
```

Full implementation of hand lifecycle:
1. `initHand()` — set hand ID, shuffle deck with hand seed.
2. `postAntes()` — if `ante > 0`, collect from each player.
3. `postBlinds()` — SB then BB. Emit `blinds.posted`.
4. `dealHoleCards()` — 2 cards per active player. Emit `hole_cards.dealt` per player.
5. Loop through betting rounds (`preflop`, `flop`, `turn`, `river`):
   - If only 1 active (non-folded) player: skip to pot distribution.
   - Deal community cards for flop/turn/river. Emit `community_cards.dealt`.
   - `runBettingRound(phase)`.
6. `runShowdown()` if 2+ active players.
7. `distributePots()` using `determineWinners`.
8. Emit all `pot.awarded` events.
9. Build and save `HandSummary` and all `ReplayEvent`s.
10. Emit `hand.completed`.

`runBettingRound(phase)`:
```typescript
private async runBettingRound(phase: HandPhase): Promise<void> {
  let roundState = this.initRoundState(phase);
  this.emit('betting_round.started', { phase, communityCards: this.gameState.communityCards });

  while (!isBettingRoundComplete(roundState)) {
    const actorIdx = roundState.currentActorIndex;
    const actor = roundState.players[actorIdx]!;
    const legalActions = computeLegalActions(actor, roundState, this.gameState.config.blindConfig.bigBlind);
    const req = this.buildDecisionRequest(actor, legalActions);

    this.emit('action.requested', { agentId: actor.agentId, playerId: actor.playerId, legalActions });

    const handler = new TimeoutHandler(this.agents.get(actor.agentId)!, this.timeoutMs);
    const { response, timedOut } = await handler.requestDecision(req);

    if (timedOut) {
      this.emit('agent.timeout', { agentId: actor.agentId, requestId: req.requestId, fallback: response.actionType });
    }

    const validated = this.validateResponse(response, legalActions, actor);
    if (!validated.valid) {
      this.emit('agent.invalid_action', { agentId: actor.agentId, received: response, fallback: validated.action.actionType });
    }

    roundState = applyAction(roundState, validated.action);
    this.updateGameState(roundState);
    this.emit('action.applied', { playerId: actor.playerId, actionType: validated.action.actionType, amount: validated.action.amount });
  }

  this.updatePotsAfterRound(roundState);
  this.emit('betting_round.complete', { phase, pots: this.gameState.pots });
}
```

`buildDecisionRequest(actor, legalActions)`: constructs `AgentDecisionRequest` with `publicState` (no hole cards for others) and `privateState` (only actor's hole cards).

### 9c. `orchestrator.ts`

```typescript
export class TableOrchestrator {
  private tables: Map<string, { table: Table; agents: Map<string, IAgent> }> = new Map();
  constructor(private tableStore: ITableStore, private handStore: IHandStore) {}

  async createTable(config: Omit<TableConfig, 'tableId'>): Promise<TableState>
  async getTable(tableId: string): Promise<TableState>
  async listTables(): Promise<TableState[]>
  async addAgent(tableId: string, agentInfo: AgentInfo, agent: IAgent, buyIn: number): Promise<SeatInfo>
  async removeAgent(tableId: string, agentId: string): Promise<void>
  async startHand(tableId: string): Promise<HandSummary>
  async getCurrentState(tableId: string): Promise<PublicGameState | null>
  async runSimulation(tableId: string, numHands: number): Promise<HandSummary[]>
}
```

`startHand`: validates ≥2 active players, creates `HandRunner`, calls `run()`, saves result to store, updates table state (handNumber++, button advances).

`runSimulation`: loops `startHand` N times. Removes players with 0 chips after each hand.

### Integration tests `src/__tests__/hand-runner.test.ts`

```typescript
describe('HandRunner integration', () => {
  it('2 MockAgents (always-call + always-call) complete a hand');
  it('6 RandomMockAgents complete a hand');
  it('3 players, one all-in → side pot computed correctly');
  it('all players fold to one → hand ends early, winner collects blinds');
  it('agent timeout → fallback action applied, hand continues');
  it('agent invalid response → fallback action, hand continues');
  it('same seed → identical hand summary (both run with AlwaysCallAgents)');
  it('AgentDecisionRequest.publicState.players has no holeCards for opponents');
  it('split pot: two players with equal best hand, equal split');
  it('HandSummary.results contains correct netChange for each player');
});
```

**Verify**: `pnpm --filter @agent-poker/table-orchestrator run test` all pass.

---

## Task 10 — `apps/api` [SERIAL after Task 9]

### `apps/api/package.json`
```json
{
  "name": "api",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -b",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@agent-poker/shared": "workspace:*",
    "@agent-poker/agent-protocol": "workspace:*",
    "@agent-poker/table-orchestrator": "workspace:*",
    "@agent-poker/agent-runtime": "workspace:*",
    "@agent-poker/persistence": "workspace:*",
    "fastify": "^4.0.0",
    "zod": "^3.23.0"
  }
}
```

### `apps/api/src/server.ts`
Bootstrap Fastify with logger, error handler, and route prefix `/api/v1`.

### Route implementation

All routes follow this pattern:
```typescript
// Parse and validate body with Zod schema
// Call TableOrchestrator method
// Return { data: result } on success
// On AppError: return { error: { code, message, statusCode } }
```

**Tables routes** (`src/routes/tables.ts`):

| Method | Path | Body/Params | Response |
|---|---|---|---|
| POST | /tables | `{ name, maxSeats, blindConfig, seed?, defaultTimeoutMs? }` | `TableState` |
| GET | /tables | — | `TableState[]` |
| GET | /tables/:tableId | — | `TableState` |
| DELETE | /tables/:tableId | — | `{ deleted: true }` |
| POST | /tables/:tableId/agents | `{ name, adapterType, buyIn, endpoint? }` | `SeatInfo` |
| DELETE | /tables/:tableId/agents/:agentId | — | `{ removed: true }` |
| POST | /tables/:tableId/hands/start | — | `HandSummary` |
| GET | /tables/:tableId/state | — | `PublicGameState \| null` |
| GET | /tables/:tableId/hands | — | `HandSummary[]` |
| GET | /tables/:tableId/hands/:handId | — | `HandSummary` |
| GET | /tables/:tableId/hands/:handId/replay | — | `ReplayEvent[]` |

**Simulate route** (`src/routes/simulate.ts`):

```
POST /simulate
Body: {
  name: string,
  maxSeats: number,
  blindConfig: BlindConfig,
  seed?: string,
  agents: Array<{ name: string, adapterType: 'mock', strategy: 'random'|'always-call'|'always-fold' }>,
  buyIn: number,
  numHands: number,
}
Response: { tableId, hands: HandSummary[], finalStacks: Record<string, number> }
```

### API integration tests (`src/__tests__/api.integration.test.ts`)

```typescript
// Use fastify.inject() — no network required
describe('API', () => {
  it('POST /tables → 201 + tableId');
  it('GET /tables/:tableId → 200 + table state');
  it('GET /tables/nonexistent → 404');
  it('POST /tables/:tableId/agents → 200 + seatInfo');
  it('POST /tables/:tableId/agents when full → 409');
  it('POST /tables/:tableId/hands/start with 0 agents → 400');
  it('POST /tables/:tableId/hands/start with 2 agents → 200 + HandSummary');
  it('GET /tables/:tableId/hands/:handId → 200 + HandSummary');
  it('GET /tables/:tableId/hands/:handId/replay → 200 + ReplayEvent[]');
  it('POST /simulate with 4 agents, 3 hands → 200 + 3 HandSummary');
  it('invalid body → 400 with validation errors');
});
```

**Verify**: `pnpm --filter api run test` all pass. `pnpm --filter api dev` starts without error.

---

## Task 11 — Examples [SERIAL after Task 10]

### `examples/mock-agents/`

Each file exports a class extending `MockAgent`:

- `random-agent.ts` — `RandomAgent`: random legal action, random amount in [min, max].
- `always-call-agent.ts` — `AlwaysCallAgent`: call if possible, else check, else fold.
- `always-fold-agent.ts` — `AlwaysFoldAgent`: fold if legal, else check.
- `aggressive-agent.ts` — `AggressiveAgent`: all-in if possible, else raise to max, else call, else check, else fold.

### `examples/local-simulation/run-simulation.ts`

```typescript
// CLI entrypoint: pnpm tsx run-simulation.ts [numHands] [seed]
// Defaults: numHands=5, seed='demo-seed-001'
//
// 1. Create TableOrchestrator with MemoryStore + FileStore(./output)
// 2. Create table: 9 seats, SB=25, BB=50, seed
// 3. Add 4 RandomAgents with 1000 chips each
// 4. Run numHands via orchestrator.runSimulation()
// 5. Print per-hand summary to stdout
// 6. Print final chip counts
// 7. Print output file path
```

Output format:
```
Hand #1 [seed: demo-seed-001-1]
  Winner: agent-1 (+250 chips)
  Community: Ah Kd 7c 2h Js
  Actions: 12
  Duration: 45ms

...

Final stacks:
  agent-1: 1250
  agent-2: 800
  agent-3: 950
  agent-4: 1000

Replay events written to: ./output/{tableId}/
```

**Verify**:
```bash
cd examples/local-simulation
pnpm tsx run-simulation.ts
# Prints 5 hands, creates output/*.jsonl
```

---

## Task 12 — Full Integration Pass [SERIAL after all]

```bash
# Full build
pnpm run build

# Full test suite
pnpm run test

# Type check
pnpm run lint

# Demo
pnpm demo

# Reproducibility check (run twice, compare outputs)
pnpm demo -- 1 test-repro-seed
pnpm demo -- 1 test-repro-seed
# Both runs must produce identical hand-*.summary.json files
diff <(cat examples/local-simulation/output/*/*.summary.json | head -1) \
     <(cat examples/local-simulation/output/*/*.summary.json | tail -1)
```

All must pass with zero errors.

---

## Dependency Graph

```
Task 0 (init)
├── Task 1: shared           [PARALLEL]
└── Task 2: agent-protocol   [PARALLEL with 1]
    Task 3: engine/card+deck       [after 1]
    ├── Task 4: engine/evaluator   [after 3]
    ├── Task 5: engine/legal+pot   [after 3]
    │   Task 6: engine/round+showdown [after 4+5]
    Task 7: persistence            [after 1+2, PARALLEL with 3-6]
    Task 8: agent-runtime          [after 1+2, PARALLEL with 3-6]
    Task 9: table-orchestrator     [after 6+7+8]
    Task 10: apps/api              [after 9]
    Task 11: examples              [after 10]
    Task 12: full pass             [after all]
```

---

## Phase 1 Definition of Done

- [ ] `pnpm install` succeeds.
- [ ] `pnpm run build` zero TypeScript errors.
- [ ] `pnpm run test` all tests pass.
- [ ] `pnpm demo` completes 5 hands, writes JSONL output files.
- [ ] Same seed → same hand summary (deterministic).
- [ ] All security boundary checks pass (`AgentDecisionRequest` never leaks hole cards).
- [ ] All Phase 1 API endpoints return correct responses.
- [ ] No `any` types or `// @ts-ignore` in source.
