# Agent Poker Platform — Claude Code Build Prompt

This file contains a self-contained prompt you can copy into a new Claude Code session to execute the full Phase 1 implementation from scratch.

---

## How to Use

1. Create a new empty directory: `mkdir agent-poker-platform && cd agent-poker-platform`
2. Copy the prompt below into a new Claude Code session in that directory.
3. Claude Code will initialize the project, implement all packages, write tests, run tests, and report.

---

## Prompt (Copy Everything Below This Line)

---

You are building `agent-poker-platform` from scratch. This is a new project — no files exist yet. Follow the instructions exactly as written.

**Read the following documentation files first (all in `docs/` in the current directory, copy them here before starting):**
- `docs/agent-poker-platform-greenfield-spec.md` — master specification (domain models, architecture, rules)
- `docs/agent-poker-platform-implementation-plan.md` — step-by-step build guide (tasks 0–12)
- `docs/agent-poker-platform-api-and-protocol.md` — API endpoints, agent protocol, event catalog
- `docs/agent-poker-platform-test-plan.md` — all test cases with IDs

If these files are not in the current directory, stop and ask the user to copy them here before continuing.

---

## Your Task

Implement Phase 1 MVP of the agent-poker-platform. Follow the implementation plan tasks 0–12 in order. For each task:
1. Create all listed files with complete, working TypeScript code.
2. Run the verification command listed in the task.
3. Fix any failures before moving to the next task.
4. Mark the task complete and move on.

---

## Technology Stack (Fixed — Do Not Change)

- TypeScript 5.5, strict mode
- Node.js 20 LTS
- pnpm 9
- pnpm workspaces monorepo
- Vitest 2
- Fastify 4
- Zod 3
- No external poker libraries (implement from scratch)
- PRNG: mulberry32 (implement inline, ~20 lines)
- Phase 1 storage: in-memory + JSONL files

---

## Project Structure (Create Exactly This)

```
agent-poker-platform/
├── apps/
│   ├── api/              # Fastify REST API
│   └── web/              # React+Vite scaffold only, no content
├── packages/
│   ├── poker-engine/     # Pure game logic
│   ├── table-orchestrator/
│   ├── agent-runtime/
│   ├── agent-protocol/
│   ├── persistence/
│   └── shared/
├── examples/
│   ├── mock-agents/
│   └── local-simulation/
├── docs/                 # Documentation (already exists — do not modify)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
└── CLAUDE.md
```

---

## Implementation Order (Serial/Parallel)

Follow this exact sequence. Parallel groups can be implemented in any sub-order, but all must complete before moving to the next serial step.

**Step 0**: Initialize monorepo (package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts, CLAUDE.md, .gitignore).

**Step 1** [PARALLEL group]:
- `packages/shared` — all domain types, constants, error classes
- `packages/agent-protocol` — Zod schemas for all protocol types

**Step 2** [SERIAL, needs Step 1]:
- `packages/poker-engine/src/prng.ts` — mulberry32 PRNG with djb2 seed hashing
- `packages/poker-engine/src/card.ts` — card utilities
- `packages/poker-engine/src/deck.ts` — seeded deck creation and dealing
- Write `src/__tests__/deck.test.ts`, verify all pass

**Step 3** [PARALLEL group, needs Step 2]:
- `packages/poker-engine/src/hand-evaluator.ts` — 5-card eval + 7-card best + comparison
- `packages/poker-engine/src/legal-actions.ts` — legal action computation
- `packages/poker-engine/src/pot-calculator.ts` — pot and side pot calculation
- Write all corresponding tests, verify pass

**Step 4** [SERIAL, needs Step 3]:
- `packages/poker-engine/src/betting-round.ts` — betting round state machine
- `packages/poker-engine/src/showdown.ts` — winner determination
- Write tests, verify pass

**Step 5** [PARALLEL group, needs Step 1]:
- `packages/persistence/` — IStore interfaces, MemoryStore, FileStore
- `packages/agent-runtime/` — IAgent, MockAgent, RandomMockAgent, TimeoutHandler, stubs
- Write tests for both, verify pass

**Step 6** [SERIAL, needs Steps 4 and 5]:
- `packages/table-orchestrator/` — Table, HandRunner, Orchestrator
- Write integration tests (all int-001 through int-017)
- Write privacy tests (priv-001 through priv-008)
- Write replay tests (rep-001 through rep-010)
- Verify all pass

**Step 7** [SERIAL, needs Step 6]:
- `apps/api/` — Fastify server, all Phase 1 routes, API integration tests
- Verify all api tests pass

**Step 8** [SERIAL, needs Step 7]:
- `examples/mock-agents/` — RandomAgent, AlwaysCallAgent, AlwaysFoldAgent, AggressiveAgent
- `examples/local-simulation/run-simulation.ts` — CLI demo script
- Run demo, verify output

---

## Key Implementation Details

### mulberry32 PRNG (implement exactly this)
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
    h = h >>> 0;
  }
  return h;
}
export function createSeededRng(seed: string): () => number {
  return mulberry32(djb2Hash(seed));
}
```

### Hand seed per hand
Each hand uses seed `${tableConfig.seed}-${handNumber}`.  
Example: table seed `"demo-seed"`, hand 3 → deck seed `"demo-seed-3"`.

### Side pot algorithm
```
1. Sort all-in amounts ascending
2. prevCap = 0
3. For each all-in amount cap:
   amount = Σ min(player.totalBetInHand, cap) - min(player.totalBetInHand, prevCap) for all non-folded
   eligible = players where !folded && totalBetInHand >= cap
   pots.push({ amount, eligiblePlayerIds })
   prevCap = cap
4. Final pot = Σ remaining (totalBetInHand - prevCap) for non-folded players with totalBetInHand > prevCap
   eligible = all non-folded players with totalBetInHand > prevCap
```

### Betting round completion
A betting round is complete when:
- Zero or one active (non-folded, non-all-in) players remain, OR
- Every active player has acted at least once this round AND all active players have `currentRoundBet === currentRoundMinBet` AND action has returned to or past `lastAggressorIndex`.

If `lastAggressorIndex` is null (no bet/raise), round completes after everyone has acted once.

### AgentDecisionRequest construction
```typescript
function buildDecisionRequest(actor: PlayerInHand, gameState: GameState, legalActions: LegalAction[]): AgentDecisionRequest {
  return {
    requestId: crypto.randomUUID(),
    handId: gameState.handId,
    tableId: gameState.tableId,
    agentId: actor.agentId,
    publicState: {
      // Map gameState.players to PublicPlayer (OMIT holeCards for everyone)
      players: gameState.players.map(p => ({
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        stack: p.stack,
        status: p.status,
        totalBetInHand: p.totalBetInHand,
        currentRoundBet: p.currentRoundBet,
        // DO NOT include holeCards
      })),
      // ... rest of public state
    },
    privateState: {
      playerId: actor.playerId,
      holeCards: actor.holeCards!, // Only this player's hole cards
    },
    legalActions,
    timeoutMs: gameState.config.defaultTimeoutMs,
  };
}
```

### Action validation and fallback
```typescript
function validateResponse(
  response: AgentDecisionResponse,
  legalActions: LegalAction[],
): { valid: boolean; action: ValidatedAction } {
  const legal = legalActions.find(a => a.type === response.actionType);
  if (!legal) return { valid: false, action: fallback(legalActions) };
  if ((response.actionType === 'bet' || response.actionType === 'raise') && response.amount === undefined) {
    return { valid: false, action: fallback(legalActions) };
  }
  if (legal.minAmount !== undefined && response.amount !== undefined && response.amount < legal.minAmount) {
    return { valid: false, action: fallback(legalActions) };
  }
  if (legal.maxAmount !== undefined && response.amount !== undefined && response.amount > legal.maxAmount) {
    return { valid: false, action: fallback(legalActions) };
  }
  return { valid: true, action: { actionType: response.actionType, amount: response.amount ?? 0 } };
}

function fallback(legalActions: LegalAction[]): ValidatedAction {
  const canCheck = legalActions.some(a => a.type === 'check');
  return { actionType: canCheck ? 'check' : 'fold', amount: 0 };
}
```

---

## Test Commands (Run After Each Step)

```bash
# After Step 1
pnpm --filter @agent-poker/shared run build
pnpm --filter @agent-poker/agent-protocol run build

# After Step 2
pnpm --filter @agent-poker/poker-engine run test -- --testPathPattern=deck

# After Step 3
pnpm --filter @agent-poker/poker-engine run test

# After Step 4
pnpm --filter @agent-poker/poker-engine run test   # all engine tests

# After Step 5
pnpm --filter @agent-poker/persistence run test
pnpm --filter @agent-poker/agent-runtime run test

# After Step 6
pnpm --filter @agent-poker/table-orchestrator run test

# After Step 7
pnpm --filter api run test

# Final verification
pnpm run build
pnpm run test
pnpm demo
```

---

## Absolute Rules

1. **TypeScript strict mode**: `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`. Zero `any` types. Zero `// @ts-ignore`.

2. **No external poker libraries**: Implement all card/hand logic from scratch.

3. **Pure poker engine**: `packages/poker-engine` must have zero I/O. No imports from other workspace packages except `@agent-poker/shared`.

4. **Information isolation**: `AgentDecisionRequest.publicState` must NEVER include hole cards. Write a test that asserts this.

5. **Seeded randomness**: All shuffles use `createSeededRng(seed)`. The function signature `createShuffledDeck(seed: string): Deck` must be deterministic.

6. **No financial features**: No code paths that compute real-money values, currency exchange, odds for real betting, or any gambling features. This project is for entertainment and AI experimentation only.

7. **Module system**: Use `"type": "module"` in all package.json files. All TypeScript imports must use `.js` extension (NodeNext resolution).

8. **Error handling**: All AppErrors must have a `code` string property. API must return `{ error: { code, message, statusCode } }` for all error responses.

9. **Immutability in poker engine**: All state transformation functions (`applyAction`, `deal`, etc.) return new objects — they do not mutate inputs.

10. **Testing**: Every acceptance criterion in `docs/agent-poker-platform-test-plan.md` must have a corresponding test that passes.

---

## Definition of Done

You are finished when ALL of these pass with zero errors:

```bash
pnpm run build     # zero TS errors
pnpm run lint      # zero type errors  
pnpm run test      # all ~100 tests pass
pnpm demo          # 5 hands complete, JSONL files written
```

And these are verified manually:
- `examples/local-simulation/output/` contains `.replay.jsonl` and `.summary.json` files.
- Running demo twice with `pnpm demo -- 1 same-seed` produces identical `.summary.json` files.
- `AgentDecisionRequest` for any player contains zero hole cards for other players (asserted by test priv-001).

---

## Final Report Format

When done, report in this format:

```
## Phase 1 Implementation Complete

### Test Results
- packages/poker-engine: X/X tests passing
- packages/persistence: X/X tests passing
- packages/agent-runtime: X/X tests passing
- packages/table-orchestrator: X/X tests passing
- apps/api: X/X tests passing
- Total: X/X tests passing

### Build
- TypeScript: 0 errors

### Demo
- 5 hands completed
- Output files: examples/local-simulation/output/{tableId}/
  - hand-001.replay.jsonl (N events)
  - hand-001.summary.json
  - ...

### Reproducibility
- Same seed → identical summary: ✓

### Known Issues
- [List any known issues or deferred items]

### Next Steps (Phase 2)
- Frontend: React + Vite table viewer
- PostgreSQL persistence upgrade
- WebSocket real-time events
- HTTP/WS Agent Adapters
```

---

*End of build prompt.*
