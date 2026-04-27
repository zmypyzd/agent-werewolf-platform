# Agent Poker Platform — Test Plan

Version: 1.0.0  
Date: 2026-04-24

---

## Overview

All tests use **Vitest 2.x**. Tests live alongside source in `src/__tests__/` directories. No separate test runner binary needed.

Commands:
```bash
pnpm run test                    # all tests, single run
pnpm run test:watch              # all tests, watch mode
pnpm run test:coverage           # all tests with V8 coverage
pnpm --filter @agent-poker/poker-engine run test    # single package
pnpm --filter api run test                          # API tests only
```

---

## 1. Unit Tests: `packages/poker-engine`

### 1.1 `src/__tests__/deck.test.ts`

**File**: `packages/poker-engine/src/__tests__/deck.test.ts`

| Test ID | Description | Assertion |
|---|---|---|
| `deck-001` | `createShuffledDeck` returns 52 cards | `deck.cards.length === 52` |
| `deck-002` | All 52 cards are unique | No duplicate `rank+suit` combos |
| `deck-003` | Same seed → identical card order | Two decks with `"seed-A"` are deep-equal |
| `deck-004` | Different seeds → different order | Two decks with different seeds are NOT equal (probabilistic) |
| `deck-005` | `deal(deck, n)` returns exactly n cards | Returned array length === n |
| `deck-006` | `deal` is sequential | Second `deal` continues from where first left off |
| `deck-007` | `deal` does not mutate original deck | Original deck unchanged after deal |
| `deck-008` | `deal` throws when requesting more cards than remain | Throws `Error` |
| `deck-009` | `dealtCount` advances correctly | `deck.dealtCount === prevCount + n` after deal |
| `deck-010` | Dealing all 52 cards produces all unique cards | No duplicates in all 52 dealt cards |

**Verify**: `pnpm --filter @agent-poker/poker-engine run test -- --testPathPattern=deck` — 10 passing.

---

### 1.2 `src/__tests__/hand-evaluator.test.ts`

**File**: `packages/poker-engine/src/__tests__/hand-evaluator.test.ts`

Helper: `cards(...strings: string[]): Card[]` — parse `"As"` → `{ rank: 'A', suit: 's' }`.

#### 5-Card Hand Evaluation

| Test ID | Input | Expected Category | Expected Tiebreakers |
|---|---|---|---|
| `eval-001` | `Ah Kh Qh Jh Th` | `straight_flush` | `[14]` (high A) |
| `eval-002` | `9h 8h 7h 6h 5h` | `straight_flush` | `[9]` |
| `eval-003` | `5h 4h 3h 2h Ah` | `straight_flush` | `[5]` (wheel) |
| `eval-004` | `As Ah Ad Ac Kh` | `four_of_a_kind` | `[14, 13]` |
| `eval-005` | `2s 2h 2d 2c Ah` | `four_of_a_kind` | `[2, 14]` |
| `eval-006` | `As Ah Ad Ks Kh` | `full_house` | `[14, 13]` |
| `eval-007` | `2s 2h 2d Ks Kh` | `full_house` | `[2, 13]` |
| `eval-008` | `Ah Qh 9h 7h 3h` | `flush` | `[14, 12, 9, 7, 3]` |
| `eval-009` | `9c 8h 7d 6s 5c` | `straight` | `[9]` |
| `eval-010` | `Ah 2c 3d 4s 5h` | `straight` | `[5]` (wheel) |
| `eval-011` | `Ah As Ad Kh Qc` | `three_of_a_kind` | `[14, 13, 12]` |
| `eval-012` | `Ah As Kh Ks Qc` | `two_pair` | `[14, 13, 12]` |
| `eval-013` | `Ah As Kh Qc Jd` | `one_pair` | `[14, 13, 12, 11]` |
| `eval-014` | `Ah Kc Qd Jh 9s` | `high_card` | `[14, 13, 12, 11, 9]` |

#### 7-Card Best Hand

| Test ID | Input | Expected Category |
|---|---|---|
| `eval-015` | `Ah Ad As Ac Kh Qd 2c` | `four_of_a_kind` (aces) |
| `eval-016` | `Ah Kh Qh Jh Th 9d 8c` | `straight_flush` (royal) |
| `eval-017` | `2h 3h 4h 5h 6h 7d 8c` | `straight_flush` (6-high) |
| `eval-018` | `Ah As Ad Kh Kd Qc Jd` | `full_house` (aces over kings) |

#### Hand Comparison

| Test ID | Hand A | Hand B | Expected Result |
|---|---|---|---|
| `cmp-001` | full_house [14,13] | flush [14,12,9,7,3] | A wins (-1) |
| `cmp-002` | one_pair [14,...] | one_pair [13,...] | A wins (-1) |
| `cmp-003` | one_pair [14, 13, 12, 11] | one_pair [14, 13, 12, 10] | A wins (-1) |
| `cmp-004` | `Ah Kh Qh Jh Th` | `As Ks Qs Js Ts` | Tie (0) |
| `cmp-005` | high_card [14,...] | straight_flush [9] | B wins (1) |

**Verify**: `pnpm --filter @agent-poker/poker-engine run test -- --testPathPattern=hand-evaluator` — all passing.

---

### 1.3 `src/__tests__/legal-actions.test.ts`

**File**: `packages/poker-engine/src/__tests__/legal-actions.test.ts`

Setup helper:
```typescript
function makePlayer(override: Partial<PlayerInHand>): PlayerInHand { ... }
function makeRoundState(override: Partial<...>): { currentRoundMinBet: number; minRaiseAmount: number } { ... }
```

| Test ID | Scenario | Expected Actions |
|---|---|---|
| `legal-001` | No bet yet, player has stack | `check`, `bet(min=50,max=stack)`, `all-in` |
| `legal-002` | Facing bet of 100, player has 500 | `fold`, `call(100)`, `raise(min=200,max=500)`, `all-in` |
| `legal-003` | Facing bet, player has only 50 (< call amount) | `fold`, `all-in(50)` |
| `legal-004` | Player exactly matches bet | `check`, `raise(...)`, `all-in` |
| `legal-005` | Player is `folded` status | `[]` (empty) |
| `legal-006` | Player is `all-in` status | `[]` (empty) |
| `legal-007` | Min raise: last bet was 100, min-raise = 100 | Raise `minAmount = currentBet + 100` |
| `legal-008` | Big blind situation: first to act preflop | Raise available with min = BB |
| `legal-009` | Player stack = call amount exactly | `fold`, `call` (becomes all-in call), no raise |
| `legal-010` | Last to act, everyone checked | `check`, `bet`, `all-in` |

---

### 1.4 `src/__tests__/pot-calculator.test.ts`

**File**: `packages/poker-engine/src/__tests__/pot-calculator.test.ts`

| Test ID | Scenario | Expected Pots |
|---|---|---|
| `pot-001` | 2 players, A=100, B=100 | 1 pot: amount=200, eligible=[A,B] |
| `pot-002` | 2 players, A=100, B=200 | 1 pot: amount=300, eligible=[A,B] |
| `pot-003` | A all-in 100, B=200, C=200 | pot[0]: 300 [A,B,C], pot[1]: 200 [B,C] |
| `pot-004` | A all-in 100, B all-in 200, C=300 | pot[0]: 300 [A,B,C], pot[1]: 200 [B,C], pot[2]: 100 [C] |
| `pot-005` | A folded after 50, B=200, C=200 | pot[0]: 450 [B,C] (A contributed but not eligible) |
| `pot-006` | A all-in 100, B all-in 100, C=300 | pot[0]: 300 [A,B,C], pot[1]: 200 [C] (C gets it back) |
| `pot-007` | All 4 players same all-in amount 100 | 1 pot: 400, all eligible |
| `pot-008` | A all-in 50, B all-in 100, C all-in 150, D=200 | 4 pots with correct amounts and eligibility |

---

### 1.5 `src/__tests__/betting-round.test.ts`

**File**: `packages/poker-engine/src/__tests__/betting-round.test.ts`

| Test ID | Scenario | Expected Behavior |
|---|---|---|
| `round-001` | Player checks (no bet) | `currentRoundMinBet` stays 0, actor advances |
| `round-002` | Player bets 100 | `currentRoundMinBet` = 100, `lastAggressorIndex` set |
| `round-003` | Player raises to 200 | `minRaiseAmount` = 100 (raise increment), `lastAggressor` updated |
| `round-004` | Player calls | Stack decreases by `callAmount`, `currentRoundBet` = `currentRoundMinBet` |
| `round-005` | Player folds | `status` = `folded`, actor advances |
| `round-006` | Player all-in | `status` = `all-in`, stack = 0 |
| `round-007` | Round complete: all checked | `isBettingRoundComplete` returns `true` |
| `round-008` | Round complete: bet + all called | `isBettingRoundComplete` returns `true` |
| `round-009` | Round NOT complete: someone raised, haven't gone around | Returns `false` |
| `round-010` | All-in player skipped | Next actor skips all-in player |
| `round-011` | Only 1 active player left | Round immediately complete |
| `round-012` | Re-raise reopens action | Player who previously called now acts again |

---

### 1.6 `src/__tests__/showdown.test.ts`

**File**: `packages/poker-engine/src/__tests__/showdown.test.ts`

| Test ID | Scenario | Expected Award |
|---|---|---|
| `show-001` | 2 players, A has better hand | A wins full pot |
| `show-002` | 2 players, exact same best hand | 50/50 split |
| `show-003` | Odd chip split: 201 chips, 2 players | Each gets 100, 1 chip to button-left |
| `show-004` | Main pot + side pot, A wins main, B wins side | Correct split across pots |
| `show-005` | Player who folded has best hole cards | Folded player wins nothing |
| `show-006` | 3-way tie: 300 chips total | Each player gets 100 |
| `show-007` | 3-way tie: 301 chips, button order p1>p2>p3 | p1 gets 101, p2+p3 get 100 |
| `show-008` | All-in player wins main pot | All-in player gets main pot only |

---

## 2. Unit Tests: `packages/persistence`

### 2.1 `src/__tests__/memory-store.test.ts`

| Test | Assertion |
|---|---|
| `saveTable` + `getTable` round-trip | Retrieved === saved |
| `listTables` returns all saved tables | Length === save count |
| `deleteTable` removes from list | Not found after delete |
| `saveHandSummary` + `getHandSummary` | Round-trip |
| `listHandSummaries` filters by tableId | Only matching table's hands returned |
| `appendReplayEvent` + `getReplayEvents` | Events in sequence order |
| Multiple append → `getReplayEvents` returns all | Correct count and order |

### 2.2 `src/__tests__/file-store.test.ts`

| Test | Assertion |
|---|---|
| `appendReplayEvent` creates JSONL file | File exists with 1 line |
| Multiple appends → file grows | N events → N lines |
| `getReplayEvents` parses JSONL correctly | Objects match originals |
| `saveHandSummary` creates JSON file | File exists, parseable |
| Non-existent file → `getReplayEvents` returns `[]` | No throw |
| Nested directory created automatically | `mkdirSync` called |

---

## 3. Unit Tests: `packages/agent-runtime`

### 3.1 `src/__tests__/mock-agent.test.ts`

| Test | Assertion |
|---|---|
| `RandomAgent.requestDecision` returns `actionType` in `legalActions` | Repeated 100 times, always valid |
| `RandomAgent` with only `fold` → returns `fold` | `actionType === 'fold'` |
| `RandomAgent` with `bet` → `amount` in `[minAmount, maxAmount]` | Inclusive bounds |
| `AlwaysCallAgent` → returns `call` when available | `actionType === 'call'` |
| `AlwaysCallAgent` → returns `check` when no bet | `actionType === 'check'` |
| `AlwaysFoldAgent` → returns `fold` when available | `actionType === 'fold'` |
| `AlwaysFoldAgent` → returns `check` when fold not available | `actionType === 'check'` |
| `AggressiveAgent` → all-in when available | `actionType === 'all-in'` |
| Response always has correct `requestId` and `agentId` | Matches request |

### 3.2 `src/__tests__/timeout-handler.test.ts`

Uses `vi.useFakeTimers()`.

| Test | Assertion |
|---|---|
| Agent resolves in 100ms, timeout=5000ms → `timedOut: false` | Response returned |
| Agent delays 6000ms, timeout=5000ms → `timedOut: true` | Fallback returned |
| Fallback is `check` when `check` is in legalActions | `fallback.actionType === 'check'` |
| Fallback is `fold` when `check` not in legalActions | `fallback.actionType === 'fold'` |
| Timed-out response has correct `requestId` | Matches request |
| Agent resolves exactly at timeout → implementation-defined | Document behavior |

---

## 4. Integration Tests: `packages/table-orchestrator`

### 4.1 `src/__tests__/hand-runner.test.ts`

All tests use `MemoryStore` and `AlwaysCallAgent`/`RandomAgent`.

| Test ID | Scenario | Assertion |
|---|---|---|
| `int-001` | 2 `AlwaysCallAgent` play one hand | `HandSummary` returned, no throw |
| `int-002` | 6 `RandomAgent` play one hand | Completes, valid `HandSummary` |
| `int-003` | All fold to one player early | `hand.completed` event, winner gets pot |
| `int-004` | Agent A all-in for 100, B=500, C=500 | Side pots computed: pot[0]=300, pot[1]=800 |
| `int-005` | Agent timeout (DelayAgent > 5000ms) | `agent.timeout` event, hand continues, fallback applied |
| `int-006` | Agent invalid response | `agent.invalid_action` event, fallback applied |
| `int-007` | Same seed, `AlwaysCallAgents` → same `HandSummary` | `handSummary1` deep-equal `handSummary2` |
| `int-008` | `AgentDecisionRequest` has no opponent hole cards | `publicState.players` have no `holeCards` property |
| `int-009` | `AgentDecisionRequest.privateState.holeCards` has 2 cards | Correct cards for requesting player |
| `int-010` | 2 players with equal best hand → split pot | Each wins `totalPot / 2` |
| `int-011` | Player busts (stack=0) after hand | Removed from table in next hand |
| `int-012` | `HandSummary.allActions` records every action | `allActions.length` matches actual action count |
| `int-013` | `ReplayEvent`s saved to store | `getReplayEvents(handId)` returns all events in order |
| `int-014` | `HandSummary` `results[].netChange` correct | `netChange = winAmount - totalBetInHand` |
| `int-015` | Button advances each hand | `button` index increments after each hand |
| `int-016` | Preflop: BB has option to raise | BB can raise even after everyone called |
| `int-017` | Side pot: all-in player can only win main pot | Side pot goes to other eligible player |

---

## 5. API Integration Tests: `apps/api`

### 5.1 `src/__tests__/api.integration.test.ts`

Uses `fastify.inject()` — no network required.

| Test ID | HTTP | Path | Expected Status | Assertion |
|---|---|---|---|---|
| `api-001` | POST | /tables | 201 | Returns `tableId` |
| `api-002` | POST | /tables | 400 | Missing `blindConfig` → validation error |
| `api-003` | GET | /tables | 200 | Returns array |
| `api-004` | GET | /tables/:tableId | 200 | Returns full `TableState` |
| `api-005` | GET | /tables/nonexistent | 404 | `TABLE_NOT_FOUND` |
| `api-006` | POST | /tables/:id/agents | 200 | Returns `SeatInfo` |
| `api-007` | POST | /tables/:id/agents (2nd adds to different seat) | 200 | `seatIndex` differs |
| `api-008` | POST | /tables/:id/agents (table full) | 409 | `TABLE_FULL` |
| `api-009` | DELETE | /tables/:id/agents/:agentId | 200 | `{ removed: true }` |
| `api-010` | POST | /tables/:id/hands/start (0 agents) | 400 | `NOT_ENOUGH_PLAYERS` |
| `api-011` | POST | /tables/:id/hands/start (2 agents) | 200 | Returns `HandSummary` |
| `api-012` | GET | /tables/:id/hands | 200 | Array of summaries |
| `api-013` | GET | /tables/:id/hands/:handId | 200 | Full `HandSummary` |
| `api-014` | GET | /tables/:id/hands/:handId/replay | 200 | Array of `ReplayEvent[]` in sequence order |
| `api-015` | GET | /tables/:id/hands/nonexistent | 404 | `HAND_NOT_FOUND` |
| `api-016` | POST | /simulate (4 agents, 3 hands) | 200 | Array of 3 `HandSummary` |
| `api-017` | POST | /simulate (invalid body) | 400 | `SCHEMA_VALIDATION_FAILED` |
| `api-018` | GET | /tables/:id/state (no hand) | 200 | `{ data: null }` |
| `api-019` | DELETE | /tables/:id | 200 | `{ deleted: true }` |
| `api-020` | Error format | any 404 | 404 | `{ error: { code, message, statusCode } }` |

---

## 6. Protocol Tests: Security and Privacy

### 6.1 `packages/table-orchestrator/src/__tests__/privacy.test.ts`

These tests verify the security boundary: no agent sees another's cards.

| Test ID | Description | Assertion |
|---|---|---|
| `priv-001` | `AgentDecisionRequest` for player A has no `holeCards` in `publicState.players[*]` | `JSON.stringify(req.publicState).includes('"holeCards"')` is `false` |
| `priv-002` | `privateState.playerId` matches requesting agent's playerId | `req.privateState.playerId === req.agentId`-mapped playerId |
| `priv-003` | `privateState.holeCards` contains exactly 2 cards | `req.privateState.holeCards.length === 2` |
| `priv-004` | Hole cards in `privateState` match what was dealt to that player | Cross-reference with `GameState.players` |
| `priv-005` | Different agents receive different `privateState.holeCards` | Cards for p1 ≠ cards for p2 |
| `priv-006` | `AgentDecisionResponseSchema.parse(response)` validates successfully | No throw for valid response |
| `priv-007` | `AgentDecisionResponseSchema.parse({...invalid})` throws | Zod validation error on invalid response |
| `priv-008` | Replay events in store include all players' hole cards (for audit) | `hole_cards.dealt` events in JSONL contain cards |

---

## 7. Replay and Reproducibility Tests

### 7.1 `packages/table-orchestrator/src/__tests__/replay.test.ts`

| Test ID | Description | Assertion |
|---|---|---|
| `rep-001` | Same seed + `AlwaysCallAgent` → identical `HandSummary` | `JSON.stringify(s1) === JSON.stringify(s2)` |
| `rep-002` | Same seed + `AlwaysCallAgent` → identical `allActions` array | Deep equal |
| `rep-003` | Same seed + `AlwaysCallAgent` → identical `communityCards` | Deep equal |
| `rep-004` | Same seed + `AlwaysCallAgent` → identical `results` | Deep equal |
| `rep-005` | Different seeds → different deck order (with high probability) | Not deep equal |
| `rep-006` | Hand seed = `${tableSeed}-${handNumber}` | Verify seed construction |
| `rep-007` | Replay events for a hand cover all phases | Events include `hand.started`, all betting phases, `hand.completed` |
| `rep-008` | Replay events `sequence` is strictly 0,1,2,... | No gaps or duplicates |
| `rep-009` | Final stacks from `hand.completed` event match `HandSummary.players[*].stackAfter` | Consistent |
| `rep-010` | `HandSummary.allActions` matches `action.applied` events in order | Deep equal sequences |

---

## 8. Minimum Required Test Set (Must All Pass for Phase 1)

The following tests are mandatory. Phase 1 is NOT complete if any of these fail.

```bash
# Run minimum required tests only
pnpm run test --reporter=verbose 2>&1 | grep -E "✓|✗|FAIL|PASS"
```

| # | Test File | Test IDs |
|---|---|---|
| 1 | `poker-engine/deck.test.ts` | deck-001 through deck-010 |
| 2 | `poker-engine/hand-evaluator.test.ts` | eval-001 through eval-018, cmp-001 through cmp-005 |
| 3 | `poker-engine/legal-actions.test.ts` | legal-001 through legal-010 |
| 4 | `poker-engine/pot-calculator.test.ts` | pot-001 through pot-008 |
| 5 | `poker-engine/betting-round.test.ts` | round-001 through round-012 |
| 6 | `poker-engine/showdown.test.ts` | show-001 through show-008 |
| 7 | `persistence/memory-store.test.ts` | All |
| 8 | `persistence/file-store.test.ts` | All |
| 9 | `agent-runtime/mock-agent.test.ts` | All |
| 10 | `agent-runtime/timeout-handler.test.ts` | All |
| 11 | `table-orchestrator/hand-runner.test.ts` | int-001 through int-017 |
| 12 | `table-orchestrator/privacy.test.ts` | priv-001 through priv-008 |
| 13 | `table-orchestrator/replay.test.ts` | rep-001 through rep-010 |
| 14 | `api/api.integration.test.ts` | api-001 through api-020 |

**Total**: ~100 test cases. All must pass.

---

## 9. Local Simulation Acceptance Test

After all unit/integration tests pass, verify the demo:

```bash
# Run demo with deterministic seed
pnpm demo -- 5 demo-seed-001

# Verify output files exist
ls examples/local-simulation/output/

# Verify reproducibility
pnpm demo -- 1 repro-test-seed
cp examples/local-simulation/output/**/*.summary.json /tmp/run1.json
pnpm demo -- 1 repro-test-seed  
cp examples/local-simulation/output/**/*.summary.json /tmp/run2.json
diff /tmp/run1.json /tmp/run2.json
# Must output nothing (files identical)
```

---

## 10. Test Coverage Requirements

Run: `pnpm run test:coverage`

| Package | Minimum Coverage |
|---|---|
| `poker-engine` | 90% line coverage |
| `persistence` | 85% line coverage |
| `agent-runtime` | 85% line coverage |
| `table-orchestrator` | 80% line coverage |
| `api` | 75% line coverage |

Coverage is a floor, not a target. Don't write tests just to hit the number — the specific scenarios above matter more.

---

## 11. TypeScript Strict Mode Check

Run: `pnpm run lint`

Zero TypeScript errors required. This catches:
- Type mismatches between packages.
- Missing `exactOptionalPropertyTypes` violations.
- Unchecked indexed access on arrays.

---

## 12. Acceptance Criteria Summary

Phase 1 is complete when ALL of the following pass:

```bash
# 1. Build
pnpm run build
# Expected: 0 errors, 0 warnings

# 2. Type check
pnpm run lint  
# Expected: 0 errors

# 3. Tests
pnpm run test
# Expected: All ~100 tests pass, 0 failing

# 4. Demo
pnpm demo
# Expected: 5 hand summaries printed, output/*.jsonl files created

# 5. Reproducibility
pnpm demo -- 1 test-seed-verify
pnpm demo -- 1 test-seed-verify
# Expected: both .summary.json files are byte-identical
```
