# Werewolf Agent Protocol & Runtime Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the agent boundary for werewolf — Zod schemas in `packages/agent-protocol`, decision request/response types in `packages/shared`, generify `IAgent` and `TimeoutHandler` in `packages/agent-runtime`, and ship two mock werewolf agents (deterministic pickFirst + seeded random) that can drive a full 9-AI game end-to-end through the engine from Plan 1.

**Architecture:** `IAgent<TReq, TRes>` becomes generic with poker defaults (`IAgent<AgentDecisionRequest, AgentDecisionResponse>`) so existing poker adapters keep compiling unchanged; new werewolf adapters declare the werewolf type parameters explicitly. `agent-runtime` does NOT depend on `werewolf-engine` at runtime — werewolf agents operate purely on payloads (`validActions` is in the request). Plan 3's orchestrator will be the layer that calls `getPublicState`/`getPrivateState`/`getValidActions` and assembles the request.

**Tech Stack:** TypeScript 5.5 strict (NodeNext, `.js` import suffix), Zod 3, Vitest 2, pnpm workspaces. New runtime deps: none (Zod already in `agent-protocol`).

**Reference inputs:**
- Plan 1 spec/plan in `docs/superpowers/specs/2026-05-04-werewolf-fit-evaluation-design.md` and `docs/superpowers/plans/2026-05-04-werewolf-engine.md`
- Existing poker boundary: `packages/agent-protocol/src/{schemas,types,index}.ts` and `packages/agent-runtime/src/{agent-interface,timeout-handler,mock-agent,random-mock-agent,http-agent-adapter}.ts`
- CLAUDE.md "Information-isolation invariant" — `WerewolfDecisionRequest.publicState` must NOT contain hole-card-equivalent (role identity, private night info); only the requesting agent's privateState carries their private fields.

---

## File Map

**Created:**
- `packages/shared/src/werewolf-decision-types.ts` — runtime types `WerewolfDecisionRequest`, `WerewolfDecisionResponse`
- `packages/agent-protocol/src/werewolf-schemas.ts` — Zod schemas (`WerewolfDecisionRequestSchema`, `WerewolfDecisionResponseSchema`, plus supporting schemas)
- `packages/agent-protocol/src/werewolf-protocol-types.ts` — `z.infer<typeof X>` aliases for the new schemas
- `packages/agent-runtime/src/werewolf-prng.ts` — copy of `createSeededRng` (~25 lines, mulberry32+djb2Hash) so agent-runtime stays independent of werewolf-engine
- `packages/agent-runtime/src/werewolf-decision-request.ts` — `buildWerewolfDecisionRequest(...)` helper that assembles a request payload from already-redacted engine views
- `packages/agent-runtime/src/werewolf-mock-agent.ts` — `WerewolfMockAgent` (returns first action from `validActions`)
- `packages/agent-runtime/src/werewolf-random-mock-agent.ts` — `WerewolfRandomMockAgent` (seeded random pick)
- `packages/agent-runtime/src/__tests__/werewolf-mock-agent.test.ts`
- `packages/agent-runtime/src/__tests__/werewolf-random-mock-agent.test.ts`
- `packages/agent-runtime/src/__tests__/werewolf-decision-request.test.ts`
- `packages/agent-runtime/src/__tests__/werewolf-protocol-roundtrip.test.ts`
- `packages/agent-runtime/src/__tests__/werewolf-integration.test.ts`

**Modified:**
- `packages/shared/src/index.ts` — append re-export of `werewolf-decision-types.js`
- `packages/agent-protocol/src/index.ts` — append re-exports of `werewolf-schemas.js` and `werewolf-protocol-types.js`
- `packages/agent-runtime/src/agent-interface.ts` — generify `IAgent<TReq, TRes>` with poker defaults
- `packages/agent-runtime/src/timeout-handler.ts` — generify; the fallback action is poker-specific so factor it out
- `packages/agent-runtime/src/{mock-agent,random-mock-agent,http-agent-adapter,ws-agent-adapter,human-agent}.ts` — declare explicit poker type parameters (no behavior change)
- `packages/agent-runtime/src/npc-agent.ts` — declare poker type parameters (no behavior change)
- `packages/agent-runtime/src/index.ts` — append re-exports for new werewolf modules
- `packages/agent-runtime/package.json` — no change (deps unchanged; `@agent-poker/shared` and `@agent-poker/agent-protocol` already declared)

**NOT modified (intentional):**
- `packages/werewolf-engine/*` — Plan 1 surface stays frozen for Plan 2.
- `packages/poker-engine/*` — same.
- `apps/api`, `apps/web` — Plan 4/5.

---

## Data Model (locked here for cross-task consistency)

### `WerewolfDecisionRequest` (runtime type, in `packages/shared/src/werewolf-decision-types.ts`)

```typescript
import type {
  WerewolfAction,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfPublicState,
  WerewolfPrivateState,
} from './werewolf-types.js';

export interface WerewolfDecisionRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly deadlineMs: number;
}

export interface WerewolfDecisionResponse {
  readonly requestId: string;
  readonly agentId: string;
  readonly action: WerewolfAction;
  // Bounded reasoning summary; `inner` for `speak` actions remains in the action
  // itself, NOT in this top-level reasoningSummary (which goes into public traces).
  readonly reasoningSummary?: WerewolfReasoningSummary;
}

export interface WerewolfReasoningSummary {
  readonly intent: string;        // 1-line intent, ≤ 200 chars
  readonly confidence: number;    // 0..1
  readonly keyObservations: ReadonlyArray<string>; // ≤ 10 items, each ≤ 200 chars
}
```

**Information-isolation rule (verified by Task 4 Zod schema validators and Task 9 integration tests):**
- `publicState.history` is already redacted by `getPublicState` (no `role-assigned`, no `night-action`, no `speech.inner`).
- `privateState` only contains the fields for the requesting role (werewolves see allies, seer sees divinations, witch sees potions+nightKillTarget, hunter sees `hunterCanShoot`).
- The decision response's `reasoningSummary` is what the orchestrator may persist publicly; for `speak` actions, `action.inner` stays in the FULL state but `getPublicState` strips it. The agent author can put domain reasoning in `inner` (private) and a public-safe summary in `reasoningSummary`.

### Generic `IAgent`

```typescript
// packages/agent-runtime/src/agent-interface.ts
import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';

export interface IAgent<
  TReq = AgentDecisionRequest,
  TRes = AgentDecisionResponse,
> {
  readonly agentId: string;
  readonly name: string;
  requestDecision(req: TReq): Promise<TRes>;
}
```

The defaults preserve every existing call site that says `IAgent` (no type args) — they continue to mean the poker variant.

---

## Task 1: Generify `IAgent`

**Files:**
- Modify: `packages/agent-runtime/src/agent-interface.ts`

- [ ] **Step 1: Edit the interface**

Replace the entire content of `packages/agent-runtime/src/agent-interface.ts` with:
```typescript
import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';

export interface IAgent<
  TReq = AgentDecisionRequest,
  TRes = AgentDecisionResponse,
> {
  readonly agentId: string;
  readonly name: string;
  requestDecision(req: TReq): Promise<TRes>;
}
```

- [ ] **Step 2: Build the package and verify no type errors**

Run from repo root:
```bash
pnpm --filter @agent-poker/agent-runtime run build
```
Expected: SUCCESS (the defaults preserve every call site that uses bare `IAgent`).

- [ ] **Step 3: Run the agent-runtime test suite**

```bash
pnpm --filter @agent-poker/agent-runtime run test
```
Expected: every existing test still passes.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/agent-interface.ts
git commit -m "refactor(agent-runtime): generify IAgent<TReq, TRes> with poker defaults"
```

---

## Task 2: Generify `TimeoutHandler`

**Files:**
- Modify: `packages/agent-runtime/src/timeout-handler.ts`
- Test: `packages/agent-runtime/src/__tests__/timeout-handler.test.ts` (existing — verify nothing broke)

The current `TimeoutHandler` has poker-specific fallback logic baked in (`getFallbackAction(legalActions, ...)` returns a check-or-fold poker action). Plan 2 generifies the handler by injecting the fallback through a constructor argument, so werewolf can supply its own fallback later (Plan 3). The poker call sites build the same fallback they already use.

- [ ] **Step 1: Replace `timeout-handler.ts`**

Write the file `packages/agent-runtime/src/timeout-handler.ts` with EXACTLY:

```typescript
import type { AgentDecisionRequest, AgentDecisionResponse, LegalAction } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export interface TimeoutResult<TRes> {
  response: TRes;
  timedOut: boolean;
}

export type FallbackBuilder<TReq, TRes> = (req: TReq) => TRes;

export class TimeoutHandler<
  TReq = AgentDecisionRequest,
  TRes = AgentDecisionResponse,
> {
  constructor(
    private readonly agent: IAgent<TReq, TRes>,
    private readonly timeoutMs: number,
    private readonly fallback: FallbackBuilder<TReq, TRes>,
  ) {}

  async requestDecision(req: TReq): Promise<TimeoutResult<TRes>> {
    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ response: this.fallback(req), timedOut: true });
        }
      }, this.timeoutMs);

      this.agent
        .requestDecision(req)
        .then((response) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ response, timedOut: false });
          }
        })
        .catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ response: this.fallback(req), timedOut: true });
          }
        });
    });
  }
}

// Poker-specific fallback preserved for poker call sites that previously relied on
// TimeoutHandler picking 'check' when available else 'fold'. Pass this explicitly
// when constructing a poker TimeoutHandler.
export function pokerFallback(
  req: AgentDecisionRequest,
): AgentDecisionResponse {
  const hasCheck = req.legalActions.some((a: LegalAction) => a.type === 'check');
  return {
    requestId: req.requestId,
    agentId: req.agentId,
    actionType: hasCheck ? 'check' : 'fold',
  };
}
```

- [ ] **Step 2: Find and update poker call sites of `TimeoutHandler`**

Run:
```bash
grep -rn "new TimeoutHandler(" packages/ apps/ examples/ 2>/dev/null
```

For each call site, change `new TimeoutHandler(agent, timeoutMs)` to `new TimeoutHandler(agent, timeoutMs, pokerFallback)`. Add `pokerFallback` to the import line from `'@agent-poker/agent-runtime'`.

If `grep` returns no hits, the existing `TimeoutHandler` is only constructed in tests; in that case, update those test files to pass `pokerFallback` as the third argument and add the import.

- [ ] **Step 3: Build agent-runtime + every package that imports it**

```bash
pnpm build
```
Expected: full workspace compiles.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @agent-poker/agent-runtime run test
```
Expected: every prior test passes (the poker fallback behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/timeout-handler.ts $(grep -rl "new TimeoutHandler(" packages/ apps/ examples/ 2>/dev/null)
git commit -m "refactor(agent-runtime): generify TimeoutHandler, extract pokerFallback"
```

---

## Task 3: Type-parameterize existing poker adapters (no behavior change)

**Files:**
- Modify: `packages/agent-runtime/src/mock-agent.ts`
- Modify: `packages/agent-runtime/src/random-mock-agent.ts`
- Modify: `packages/agent-runtime/src/npc-agent.ts`
- Modify: `packages/agent-runtime/src/http-agent-adapter.ts`
- Modify: `packages/agent-runtime/src/ws-agent-adapter.ts`
- Modify: `packages/agent-runtime/src/human-agent.ts`

After Task 1 the bare `IAgent` (no type args) defaults to the poker pair, so each existing adapter's `implements IAgent` line technically still compiles. This task makes the poker binding explicit so a future reader knows "these are poker-only" without consulting the defaults. Behavior is unchanged.

- [ ] **Step 1: Update `mock-agent.ts`**

Open the file. Find:
```typescript
export abstract class MockAgent implements IAgent {
```
Change to:
```typescript
export abstract class MockAgent implements IAgent<AgentDecisionRequest, AgentDecisionResponse> {
```

The imports at the top already include `AgentDecisionRequest` and `AgentDecisionResponse`, so no import change is needed.

- [ ] **Step 2: Update `http-agent-adapter.ts`**

Find:
```typescript
export class HttpAgentAdapter implements IAgent {
```
Change to:
```typescript
export class HttpAgentAdapter implements IAgent<AgentDecisionRequest, AgentDecisionResponse> {
```

- [ ] **Step 3: Update `ws-agent-adapter.ts`**

Find:
```typescript
export class WsAgentAdapter implements IAgent {
```
Change to:
```typescript
export class WsAgentAdapter implements IAgent<AgentDecisionRequest, AgentDecisionResponse> {
```

- [ ] **Step 4: Update `human-agent.ts`**

Open the file. Find the class declaration `export class HumanAgent ... implements IAgent` (the prefix may vary — find the line that has `implements IAgent` in this file). Replace the `implements IAgent` clause with `implements IAgent<AgentDecisionRequest, AgentDecisionResponse>`. If `AgentDecisionRequest` / `AgentDecisionResponse` aren't already imported, add them to the existing `from '@agent-poker/shared'` import line.

- [ ] **Step 5: Update `npc-agent.ts`**

Open the file. The class is exported as something with `implements IAgent`. Replace `implements IAgent` with `implements IAgent<AgentDecisionRequest, AgentDecisionResponse>`. Add the type imports if missing.

- [ ] **Step 6: `random-mock-agent.ts` requires no edit**

`RandomMockAgent extends MockAgent`. Once `MockAgent` is parameterized in Step 1, `RandomMockAgent` inherits the parameterization automatically. No edit needed. Verify by build.

- [ ] **Step 7: Build + test**

```bash
pnpm --filter @agent-poker/agent-runtime run build
pnpm --filter @agent-poker/agent-runtime run test
```
Expected: full pass.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime/src/mock-agent.ts packages/agent-runtime/src/http-agent-adapter.ts packages/agent-runtime/src/ws-agent-adapter.ts packages/agent-runtime/src/human-agent.ts packages/agent-runtime/src/npc-agent.ts
git commit -m "refactor(agent-runtime): type-parameterize poker adapters explicitly"
```

---

## Task 4: Add werewolf decision types to `@agent-poker/shared`

**Files:**
- Create: `packages/shared/src/werewolf-decision-types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `werewolf-decision-types.ts`**

Create `packages/shared/src/werewolf-decision-types.ts` with EXACTLY:

```typescript
import type {
  WerewolfAction,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfPublicState,
  WerewolfPrivateState,
} from './werewolf-types.js';

export interface WerewolfReasoningSummary {
  // 1-line intent, ≤ 200 chars (enforced by the Zod schema in agent-protocol).
  readonly intent: string;
  // Probability the agent thinks this action is correct, in [0, 1].
  readonly confidence: number;
  // Up to 10 short observations (each ≤ 200 chars).
  readonly keyObservations: ReadonlyArray<string>;
}

export interface WerewolfDecisionRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly deadlineMs: number;
}

export interface WerewolfDecisionResponse {
  readonly requestId: string;
  readonly agentId: string;
  readonly action: WerewolfAction;
  // Optional public-safe summary. The reducer's `speak` action carries `inner`
  // separately; that field is private and is stripped from public history by
  // getPublicState (Plan 1). Do NOT include private reasoning here.
  readonly reasoningSummary?: WerewolfReasoningSummary;
}
```

- [ ] **Step 2: Append the new export to `index.ts`**

Open `packages/shared/src/index.ts`. Append:
```typescript
export * from './werewolf-decision-types.js';
```

- [ ] **Step 3: Build shared**

```bash
pnpm --filter @agent-poker/shared run build
```
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/werewolf-decision-types.ts packages/shared/src/index.ts
git commit -m "feat(shared): WerewolfDecisionRequest/Response types"
```

---

## Task 5: Add werewolf Zod schemas to `agent-protocol`

**Files:**
- Create: `packages/agent-protocol/src/werewolf-schemas.ts`
- Create: `packages/agent-protocol/src/werewolf-protocol-types.ts`
- Modify: `packages/agent-protocol/src/index.ts`
- Test: `packages/agent-runtime/src/__tests__/werewolf-protocol-roundtrip.test.ts` (created in Task 9 — for now we only schema-validate via the inline tests in Step 5)

- [ ] **Step 1: Write the failing schema test**

Create `packages/agent-protocol/src/__tests__/werewolf-schemas.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import {
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
} from '../werewolf-schemas.js';

const baseRequest = {
  requestId: 'req-1',
  gameId: 'g-1',
  agentId: 'a-1',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [
      { id: 'p1', seatIndex: 0, name: '天狼', alive: true, revealedRole: null },
    ],
    history: [],
    winner: null,
  },
  privateState: {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  },
  validActions: [
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  ],
  deadlineMs: 5000,
};

describe('WerewolfDecisionRequestSchema', () => {
  it('accepts a valid minimal request', () => {
    const r = WerewolfDecisionRequestSchema.safeParse(baseRequest);
    expect(r.success).toBe(true);
  });

  it('rejects unknown role in privateState.selfRole', () => {
    const bad = { ...baseRequest, privateState: { ...baseRequest.privateState, selfRole: 'duke' } };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown phase', () => {
    const bad = { ...baseRequest, phase: 'fortify-castle' };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative nightNumber', () => {
    const bad = { ...baseRequest, nightNumber: -1 };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects deadlineMs <= 0', () => {
    const bad = { ...baseRequest, deadlineMs: 0 };
    expect(WerewolfDecisionRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('WerewolfDecisionResponseSchema', () => {
  const baseResponse = {
    requestId: 'req-1',
    agentId: 'a-1',
    action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  };

  it('accepts a minimal valid response', () => {
    expect(WerewolfDecisionResponseSchema.safeParse(baseResponse).success).toBe(true);
  });

  it('accepts a response with bounded reasoning summary', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: 'Eliminate seer suspect',
        confidence: 0.7,
        keyObservations: ['p4 abstained suspiciously'],
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects reasoningSummary.intent over 200 chars', () => {
    const longIntent = 'x'.repeat(201);
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: longIntent,
        confidence: 0.5,
        keyObservations: [],
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects reasoningSummary with more than 10 keyObservations', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: {
        intent: 'spam',
        confidence: 0.5,
        keyObservations: Array.from({ length: 11 }, (_, i) => `obs ${i}`),
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    const high = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: { intent: 'x', confidence: 1.1, keyObservations: [] },
    });
    expect(high.success).toBe(false);
    const low = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      reasoningSummary: { intent: 'x', confidence: -0.1, keyObservations: [] },
    });
    expect(low.success).toBe(false);
  });

  it('rejects unknown action.type', () => {
    const r = WerewolfDecisionResponseSchema.safeParse({
      ...baseResponse,
      action: { type: 'cast-fireball', targetId: 'p2' },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (module not found)**

```bash
pnpm --filter @agent-poker/agent-protocol exec vitest run src/__tests__/werewolf-schemas.test.ts
```
Expected: FAIL — `../werewolf-schemas.js` not found.

- [ ] **Step 3: Create `werewolf-schemas.ts`**

Create `packages/agent-protocol/src/werewolf-schemas.ts` with EXACTLY:

```typescript
import { z } from 'zod';

const WerewolfPlayerIdSchema = z.string().min(1);
const WerewolfRoleSchema = z.enum(['werewolf', 'villager', 'seer', 'witch', 'hunter']);
const WerewolfSideSchema = z.enum(['werewolf', 'good']);
const WerewolfPhaseSchema = z.enum([
  'setup',
  'night-werewolf-vote',
  'night-witch',
  'night-seer',
  'night-resolve',
  'day-announce',
  'day-speeches',
  'day-vote',
  'day-resolve',
  'hunter-shoot',
  'game-over',
]);

const WerewolfPlayerPublicSchema = z.object({
  id: WerewolfPlayerIdSchema,
  seatIndex: z.number().int().min(0).max(8),
  name: z.string(),
  alive: z.boolean(),
  revealedRole: WerewolfRoleSchema.nullable(),
});

const SpeechRecordPublicSchema = z.object({
  playerId: WerewolfPlayerIdSchema,
  performance: z.string(),
  speech: z.string(),
});

const NightActionRecordSchema = z.object({
  werewolfTarget: WerewolfPlayerIdSchema.nullable(),
  witchSaved: WerewolfPlayerIdSchema.nullable(),
  witchPoisoned: WerewolfPlayerIdSchema.nullable(),
  seerTarget: WerewolfPlayerIdSchema.nullable(),
  seerResult: WerewolfSideSchema.nullable(),
});

const DayVoteRecordSchema = z.object({
  votes: z.array(
    z.object({
      voterId: WerewolfPlayerIdSchema,
      targetId: WerewolfPlayerIdSchema.nullable(),
    }),
  ),
  tally: z.record(WerewolfPlayerIdSchema, z.number().int().min(0)),
  banished: WerewolfPlayerIdSchema.nullable(),
  pkRound: z.number().int().min(0).max(3),
  tied: z.boolean(),
});

const WerewolfPublicHistoryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('death'),
    day: z.number().int().min(0),
    playerId: WerewolfPlayerIdSchema,
    cause: z.enum(['wolf-kill', 'witch-poison', 'banishment', 'hunter-shoot']),
  }),
  z.object({
    type: z.literal('speech'),
    day: z.number().int().min(0),
    record: SpeechRecordPublicSchema,
  }),
  z.object({
    type: z.literal('vote'),
    day: z.number().int().min(0),
    record: DayVoteRecordSchema,
  }),
  z.object({
    type: z.literal('hunter-shoot'),
    shooterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('game-over'),
    winner: WerewolfSideSchema,
  }),
]);

const WerewolfPublicStateSchema = z.object({
  gameId: z.string().min(1),
  phase: WerewolfPhaseSchema,
  nightNumber: z.number().int().min(0),
  dayNumber: z.number().int().min(0),
  players: z.array(WerewolfPlayerPublicSchema),
  history: z.array(WerewolfPublicHistoryEntrySchema),
  winner: WerewolfSideSchema.nullable(),
});

const WitchPotionStateSchema = z.object({
  hasSave: z.boolean(),
  hasPoison: z.boolean(),
});

const WerewolfPrivateStateSchema = z.object({
  selfId: WerewolfPlayerIdSchema,
  selfRole: WerewolfRoleSchema,
  selfSide: WerewolfSideSchema,
  knownAllies: z.array(WerewolfPlayerIdSchema),
  seerKnowledge: z.array(
    z.object({
      targetId: WerewolfPlayerIdSchema,
      side: WerewolfSideSchema,
    }),
  ),
  witchView: z
    .object({
      potions: WitchPotionStateSchema,
      currentNightKillTarget: WerewolfPlayerIdSchema.nullable(),
    })
    .nullable(),
  hunterCanShoot: z.boolean(),
});

const WerewolfActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('werewolf-vote'),
    voterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({
    type: z.literal('witch-save'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({ type: z.literal('witch-skip-save') }),
  z.object({
    type: z.literal('witch-poison'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({ type: z.literal('witch-skip-poison') }),
  z.object({
    type: z.literal('seer-divine'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({
    type: z.literal('speak'),
    playerId: WerewolfPlayerIdSchema,
    inner: z.string(),
    performance: z.string(),
    speech: z.string(),
  }),
  z.object({
    type: z.literal('day-vote'),
    voterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('hunter-shoot'),
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
]);

export const WerewolfDecisionRequestSchema = z.object({
  requestId: z.string().min(1),
  gameId: z.string().min(1),
  agentId: z.string().min(1),
  playerId: WerewolfPlayerIdSchema,
  phase: WerewolfPhaseSchema,
  nightNumber: z.number().int().min(0),
  dayNumber: z.number().int().min(0),
  publicState: WerewolfPublicStateSchema,
  privateState: WerewolfPrivateStateSchema,
  validActions: z.array(WerewolfActionSchema),
  deadlineMs: z.number().int().positive(),
});

export const WerewolfReasoningSummarySchema = z.object({
  intent: z.string().max(200),
  confidence: z.number().min(0).max(1),
  keyObservations: z.array(z.string().max(200)).max(10),
});

export const WerewolfDecisionResponseSchema = z.object({
  requestId: z.string().min(1),
  agentId: z.string().min(1),
  action: WerewolfActionSchema,
  reasoningSummary: WerewolfReasoningSummarySchema.optional(),
});

export {
  WerewolfActionSchema,
  WerewolfPhaseSchema,
  WerewolfPlayerIdSchema,
  WerewolfPrivateStateSchema,
  WerewolfPublicStateSchema,
  WerewolfRoleSchema,
  WerewolfSideSchema,
};
```

- [ ] **Step 4: Create `werewolf-protocol-types.ts`**

Create `packages/agent-protocol/src/werewolf-protocol-types.ts` with EXACTLY:

```typescript
import { z } from 'zod';
import type {
  WerewolfActionSchema,
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
  WerewolfReasoningSummarySchema,
} from './werewolf-schemas.js';

export type WerewolfActionZod = z.infer<typeof WerewolfActionSchema>;
export type WerewolfDecisionRequestZod = z.infer<typeof WerewolfDecisionRequestSchema>;
export type WerewolfDecisionResponseZod = z.infer<typeof WerewolfDecisionResponseSchema>;
export type WerewolfReasoningSummaryZod = z.infer<typeof WerewolfReasoningSummarySchema>;
```

- [ ] **Step 5: Append to `agent-protocol/src/index.ts`**

Open `packages/agent-protocol/src/index.ts` (currently 2 lines). Append:
```typescript
export * from './werewolf-schemas.js';
export * from './werewolf-protocol-types.js';
```

- [ ] **Step 6: Run schema tests**

```bash
pnpm --filter @agent-poker/agent-protocol run build
pnpm --filter @agent-poker/agent-protocol exec vitest run src/__tests__/werewolf-schemas.test.ts
```
Expected: 11 tests PASS.

- [ ] **Step 7: Run full agent-protocol suite**

```bash
pnpm --filter @agent-poker/agent-protocol run test
```
Expected: every prior test still passes.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-protocol/src/werewolf-schemas.ts packages/agent-protocol/src/werewolf-protocol-types.ts packages/agent-protocol/src/index.ts packages/agent-protocol/src/__tests__/werewolf-schemas.test.ts
git commit -m "feat(agent-protocol): werewolf Zod schemas with bounded reasoning"
```

---

## Task 6: Add seeded PRNG to agent-runtime

**Files:**
- Create: `packages/agent-runtime/src/werewolf-prng.ts`

The agent-runtime needs a seeded RNG for `WerewolfRandomMockAgent` (Task 8). Copying the 25-line helper avoids a new package dependency on werewolf-engine.

- [ ] **Step 1: Create the file**

Create `packages/agent-runtime/src/werewolf-prng.ts` with EXACTLY:

```typescript
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ (s.charCodeAt(i) | 0);
    h = h >>> 0;
  }
  return h;
}

export function createSeededRng(seed: string): () => number {
  return mulberry32(djb2Hash(seed));
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @agent-poker/agent-runtime run build
```
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/werewolf-prng.ts
git commit -m "feat(agent-runtime): seeded PRNG copy for werewolf mock agents"
```

---

## Task 7: `buildWerewolfDecisionRequest` helper

**Files:**
- Create: `packages/agent-runtime/src/werewolf-decision-request.ts`
- Create: `packages/agent-runtime/src/__tests__/werewolf-decision-request.test.ts`

This helper assembles a `WerewolfDecisionRequest` from inputs the orchestrator (Plan 3) will compute: `publicState`, `privateState`, `validActions`. It does NOT compute redaction itself — that's the orchestrator's job — but it does enforce the type contract end-to-end via the Zod schema.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/__tests__/werewolf-decision-request.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfPublicState,
  WerewolfPrivateState,
  WerewolfAction,
} from '@agent-poker/shared';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

const publicState: WerewolfPublicState = {
  gameId: 'g-1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  players: [
    { id: 'p1', seatIndex: 0, name: '天狼', alive: true, revealedRole: null },
    { id: 'p2', seatIndex: 1, name: '星辰', alive: true, revealedRole: null },
    { id: 'p3', seatIndex: 2, name: '明月', alive: true, revealedRole: null },
    { id: 'p4', seatIndex: 3, name: '清风', alive: true, revealedRole: null },
  ],
  history: [],
  winner: null,
};

const privateState: WerewolfPrivateState = {
  selfId: 'p1',
  selfRole: 'werewolf',
  selfSide: 'werewolf',
  knownAllies: ['p2', 'p3'],
  seerKnowledge: [],
  witchView: null,
  hunterCanShoot: false,
};

const validActions: WerewolfAction[] = [
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
];

describe('buildWerewolfDecisionRequest', () => {
  it('builds a request payload that conforms to the Zod schema', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
    });
    expect(WerewolfDecisionRequestSchema.safeParse(req).success).toBe(true);
  });

  it('echoes phase / night / day from publicState', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'req-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState,
      privateState,
      validActions,
      deadlineMs: 5000,
    });
    expect(req.phase).toBe('night-werewolf-vote');
    expect(req.nightNumber).toBe(1);
    expect(req.dayNumber).toBe(0);
  });

  it('throws if privateState.selfId !== playerId', () => {
    expect(() =>
      buildWerewolfDecisionRequest({
        requestId: 'req-1',
        gameId: 'g-1',
        agentId: 'a-1',
        playerId: 'p1',
        publicState,
        privateState: { ...privateState, selfId: 'p9' },
        validActions,
        deadlineMs: 5000,
      }),
    ).toThrow(/playerId mismatch/);
  });

  it('throws if publicState.gameId !== gameId', () => {
    expect(() =>
      buildWerewolfDecisionRequest({
        requestId: 'req-1',
        gameId: 'g-2',
        agentId: 'a-1',
        playerId: 'p1',
        publicState,
        privateState,
        validActions,
        deadlineMs: 5000,
      }),
    ).toThrow(/gameId mismatch/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-decision-request.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/agent-runtime/src/werewolf-decision-request.ts` with EXACTLY:

```typescript
import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfPlayerId,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';

export interface BuildWerewolfDecisionRequestInput {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly deadlineMs: number;
}

export function buildWerewolfDecisionRequest(
  input: BuildWerewolfDecisionRequestInput,
): WerewolfDecisionRequest {
  if (input.publicState.gameId !== input.gameId) {
    throw new Error(
      `gameId mismatch: input.gameId=${input.gameId} vs publicState.gameId=${input.publicState.gameId}`,
    );
  }
  if (input.privateState.selfId !== input.playerId) {
    throw new Error(
      `playerId mismatch: input.playerId=${input.playerId} vs privateState.selfId=${input.privateState.selfId}`,
    );
  }
  return {
    requestId: input.requestId,
    gameId: input.gameId,
    agentId: input.agentId,
    playerId: input.playerId,
    phase: input.publicState.phase,
    nightNumber: input.publicState.nightNumber,
    dayNumber: input.publicState.dayNumber,
    publicState: input.publicState,
    privateState: input.privateState,
    validActions: input.validActions,
    deadlineMs: input.deadlineMs,
  };
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-decision-request.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/werewolf-decision-request.ts packages/agent-runtime/src/__tests__/werewolf-decision-request.test.ts
git commit -m "feat(agent-runtime): buildWerewolfDecisionRequest helper"
```

---

## Task 8: `WerewolfMockAgent` (deterministic pickFirst)

**Files:**
- Create: `packages/agent-runtime/src/werewolf-mock-agent.ts`
- Create: `packages/agent-runtime/src/__tests__/werewolf-mock-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/__tests__/werewolf-mock-agent.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfMockAgent } from '../werewolf-mock-agent.js';

function fakeRequest(validActions: WerewolfAction[]): WerewolfDecisionRequest {
  const publicState: WerewolfPublicState = {
    gameId: 'g',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
    history: [],
    winner: null,
  };
  const privateState: WerewolfPrivateState = {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  };
  return {
    requestId: 'req',
    gameId: 'g',
    agentId: 'a',
    playerId: 'p1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    publicState,
    privateState,
    validActions,
    deadlineMs: 5000,
  };
}

describe('WerewolfMockAgent', () => {
  it('returns the first valid action', async () => {
    const agent = new WerewolfMockAgent('a1', 'Mock');
    const action: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const res = await agent.requestDecision(fakeRequest([action, { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' }]));
    expect(res.action).toEqual(action);
    expect(res.requestId).toBe('req');
    expect(res.agentId).toBe('a1');
  });

  it('throws if validActions is empty', async () => {
    const agent = new WerewolfMockAgent('a1', 'Mock');
    await expect(agent.requestDecision(fakeRequest([]))).rejects.toThrow(/no valid action/);
  });

  it('exposes id and name', () => {
    const agent = new WerewolfMockAgent('a-7', 'Cassandra');
    expect(agent.agentId).toBe('a-7');
    expect(agent.name).toBe('Cassandra');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-mock-agent.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/werewolf-mock-agent.ts` with EXACTLY:

```typescript
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export class WerewolfMockAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  constructor(
    public readonly agentId: string,
    public readonly name: string,
  ) {}

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const first = req.validActions[0];
    if (!first) {
      throw new Error(
        `WerewolfMockAgent ${this.agentId}: no valid action in phase ${req.phase} for player ${req.playerId}`,
      );
    }
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      action: first,
    };
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-mock-agent.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/werewolf-mock-agent.ts packages/agent-runtime/src/__tests__/werewolf-mock-agent.test.ts
git commit -m "feat(agent-runtime): WerewolfMockAgent (deterministic pickFirst)"
```

---

## Task 9: `WerewolfRandomMockAgent` (seeded random)

**Files:**
- Create: `packages/agent-runtime/src/werewolf-random-mock-agent.ts`
- Create: `packages/agent-runtime/src/__tests__/werewolf-random-mock-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/__tests__/werewolf-random-mock-agent.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '../werewolf-random-mock-agent.js';

function fakeRequest(validActions: WerewolfAction[]): WerewolfDecisionRequest {
  const publicState: WerewolfPublicState = {
    gameId: 'g',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
    history: [],
    winner: null,
  };
  const privateState: WerewolfPrivateState = {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  };
  return {
    requestId: 'req',
    gameId: 'g',
    agentId: 'a',
    playerId: 'p1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    publicState,
    privateState,
    validActions,
    deadlineMs: 5000,
  };
}

const actions: WerewolfAction[] = [
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
  { type: 'werewolf-vote', voterId: 'p1', targetId: 'p6' },
];

describe('WerewolfRandomMockAgent', () => {
  it('returns one of the valid actions', async () => {
    const agent = new WerewolfRandomMockAgent('a1', 'Random');
    const res = await agent.requestDecision(fakeRequest(actions));
    expect(actions).toContainEqual(res.action);
  });

  it('seeded constructor: same seed produces same sequence of picks', async () => {
    const a1 = new WerewolfRandomMockAgent('a1', 'A', { seed: 'test-seed' });
    const a2 = new WerewolfRandomMockAgent('a1', 'A', { seed: 'test-seed' });
    const r1 = await a1.requestDecision(fakeRequest(actions));
    const r2 = await a2.requestDecision(fakeRequest(actions));
    expect(r1.action).toEqual(r2.action);
  });

  it('seeded constructor: different seeds typically pick differently', async () => {
    // Use 8 distinct seeds and assert at least 2 distinct picks. With 3 valid
    // actions and a uniform RNG, the probability of all 8 picking the same
    // is < (1/3)^7 ≈ 0.05%, so this is robust.
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const picks = new Set<string>();
    for (const s of seeds) {
      const a = new WerewolfRandomMockAgent('a1', 'A', { seed: s });
      const r = await a.requestDecision(fakeRequest(actions));
      picks.add(JSON.stringify(r.action));
    }
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it('throws if validActions is empty', async () => {
    const agent = new WerewolfRandomMockAgent('a1', 'A');
    await expect(agent.requestDecision(fakeRequest([]))).rejects.toThrow(/no valid action/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-random-mock-agent.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agent-runtime/src/werewolf-random-mock-agent.ts` with EXACTLY:

```typescript
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';
import { createSeededRng } from './werewolf-prng.js';

export interface WerewolfRandomMockAgentOptions {
  // When provided, picks become deterministic across runs with the same seed.
  // Each call to requestDecision advances the RNG by one number.
  readonly seed?: string;
}

export class WerewolfRandomMockAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  private readonly rng: () => number;

  constructor(
    public readonly agentId: string,
    public readonly name: string,
    options?: WerewolfRandomMockAgentOptions,
  ) {
    this.rng = options?.seed
      ? createSeededRng(`${options.seed}-${agentId}`)
      : Math.random;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    if (req.validActions.length === 0) {
      throw new Error(
        `WerewolfRandomMockAgent ${this.agentId}: no valid action in phase ${req.phase}`,
      );
    }
    const idx = Math.floor(this.rng() * req.validActions.length);
    const chosen = req.validActions[idx]!;
    return {
      requestId: req.requestId,
      agentId: this.agentId,
      action: chosen,
    };
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-random-mock-agent.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/werewolf-random-mock-agent.ts packages/agent-runtime/src/__tests__/werewolf-random-mock-agent.test.ts
git commit -m "feat(agent-runtime): WerewolfRandomMockAgent (seeded option)"
```

---

## Task 10: Wire werewolf exports through `agent-runtime/src/index.ts`

**Files:**
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Append exports**

Open `packages/agent-runtime/src/index.ts`. Append these lines after the existing 9 re-exports:

```typescript
export * from './werewolf-decision-request.js';
export * from './werewolf-mock-agent.js';
export * from './werewolf-random-mock-agent.js';
export * from './werewolf-prng.js';
```

- [ ] **Step 2: Build + test**

```bash
pnpm --filter @agent-poker/agent-runtime run build
pnpm --filter @agent-poker/agent-runtime run test
```
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): export werewolf agent surface"
```

---

## Task 11: End-to-end integration test (engine + agents)

**Files:**
- Create: `packages/agent-runtime/src/__tests__/werewolf-integration.test.ts`

This test wires Plan 1's engine to Plan 2's agents and runs a complete game. It does NOT depend on a future orchestrator — the test loop itself plays the role of the orchestrator. This proves the boundary works end-to-end before Plan 3.

**Note on cross-package test imports:** The test imports `createGame`, `applyAction`, `startFirstNight`, `getValidActions`, `getPublicState`, `getPrivateState` from `@agent-poker/werewolf-engine`. This makes `agent-runtime` test-time dependent on `werewolf-engine`. We add `@agent-poker/werewolf-engine` to `devDependencies` in `agent-runtime/package.json` (NOT `dependencies`, because the runtime code itself does not import from the engine — only the integration test does).

- [ ] **Step 1: Add `werewolf-engine` to agent-runtime devDependencies**

Open `packages/agent-runtime/package.json`. Add to the `devDependencies` block:
```json
    "@agent-poker/werewolf-engine": "workspace:*",
```

So the file becomes:
```json
{
  "name": "@agent-poker/agent-runtime",
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
  "dependencies": {
    "@agent-poker/shared": "workspace:*",
    "@agent-poker/agent-protocol": "workspace:*"
  },
  "devDependencies": {
    "@agent-poker/werewolf-engine": "workspace:*",
    "fastify": "^4.28.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Then run from repo root:
```bash
pnpm install
```

- [ ] **Step 2: Write the integration test**

Create `packages/agent-runtime/src/__tests__/werewolf-integration.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  startFirstNight,
  getValidActions,
  getPublicState,
  getPrivateState,
} from '@agent-poker/werewolf-engine';
import type { WerewolfGameState } from '@agent-poker/shared';
import { WerewolfMockAgent } from '../werewolf-mock-agent.js';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

describe('werewolf engine + agent-runtime integration', () => {
  it('drives a complete 9-AI game to game-over via WerewolfMockAgent + buildWerewolfDecisionRequest', async () => {
    const agents = new Map<string, WerewolfMockAgent>();
    let s: WerewolfGameState = createGame({ gameId: 'g-int-1', seed: 'seed-int-1' });
    s = startFirstNight(s);
    for (const p of s.players) {
      agents.set(p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }

    let steps = 0;
    while (s.phase !== 'game-over' && steps < 1000) {
      let progressed = false;
      for (const player of s.players) {
        const valid = getValidActions(s, player.id);
        if (valid.length === 0) continue;
        const agent = agents.get(player.id)!;
        const req = buildWerewolfDecisionRequest({
          requestId: `${player.id}-${steps}`,
          gameId: s.gameId,
          agentId: agent.agentId,
          playerId: player.id,
          publicState: getPublicState(s),
          privateState: getPrivateState(s, player.id),
          validActions: valid,
          deadlineMs: 5000,
        });
        const res = await agent.requestDecision(req);
        s = applyAction(s, res.action);
        progressed = true;
        steps++;
        if (s.phase === 'game-over') break;
      }
      if (!progressed) break;
    }

    expect(s.phase).toBe('game-over');
    expect(['good', 'werewolf']).toContain(s.winner);
  });

  it('publicState passed to agents never leaks role-assigned, night-action, or speech.inner', async () => {
    let s: WerewolfGameState = createGame({ gameId: 'g-int-2', seed: 'seed-leak-1' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const target = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const t = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: t.id });

    const villager = s.players.find((p) => p.role === 'villager' && p.alive)!;
    const req = buildWerewolfDecisionRequest({
      requestId: 'r',
      gameId: s.gameId,
      agentId: 'a',
      playerId: villager.id,
      publicState: getPublicState(s),
      privateState: getPrivateState(s, villager.id),
      validActions: getValidActions(s, villager.id),
      deadlineMs: 5000,
    });

    // History redaction
    const hasRoleAssigned = req.publicState.history.some((e) => (e as { type: string }).type === 'role-assigned');
    const hasNightAction = req.publicState.history.some((e) => (e as { type: string }).type === 'night-action');
    expect(hasRoleAssigned).toBe(false);
    expect(hasNightAction).toBe(false);

    // privateState gating: villager is NOT a werewolf, so knownAllies is empty.
    expect(req.privateState.knownAllies).toEqual([]);
    expect(req.privateState.seerKnowledge).toEqual([]);
    expect(req.privateState.witchView).toBeNull();
  });

  it('werewolf agent sees their teammates in privateState.knownAllies', async () => {
    const s = createGame({ gameId: 'g', seed: 'seed-leak-2' });
    const wolf = s.players.find((p) => p.role === 'werewolf')!;
    const allWolves = s.players.filter((p) => p.role === 'werewolf').map((p) => p.id);

    const req = buildWerewolfDecisionRequest({
      requestId: 'r',
      gameId: s.gameId,
      agentId: 'a',
      playerId: wolf.id,
      publicState: getPublicState(s),
      privateState: getPrivateState(s, wolf.id),
      validActions: [],
      deadlineMs: 5000,
    });

    expect(new Set(req.privateState.knownAllies)).toEqual(new Set(allWolves.filter((id) => id !== wolf.id)));
    expect(req.privateState.selfRole).toBe('werewolf');
  });
});
```

- [ ] **Step 3: Build + run the integration test**

```bash
pnpm --filter @agent-poker/agent-runtime run build
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-integration.test.ts
```
Expected: 3 tests PASS. Game terminates within 1000 steps with a winner.

- [ ] **Step 4: Run full agent-runtime suite**

```bash
pnpm --filter @agent-poker/agent-runtime run test
```
Expected: every prior test still passes plus the 3 new integration tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/package.json packages/agent-runtime/src/__tests__/werewolf-integration.test.ts pnpm-lock.yaml
git commit -m "test(agent-runtime): werewolf engine + agent end-to-end integration"
```

---

## Task 12: Workspace verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full workspace build + test**

From repo root:
```bash
pnpm build
pnpm test
```

Expected:
- Every package builds.
- `@agent-poker/shared`, `@agent-poker/agent-protocol`, `@agent-poker/agent-runtime`, `@agent-poker/werewolf-engine` all pass.
- Pre-existing test failures in `auth` / `persistence` / `apps/api` due to better-sqlite3 / Node version mismatch are unchanged (out of Plan 2 scope).

- [ ] **Step 2: Verify no agent-runtime runtime dependency on werewolf-engine**

```bash
grep -rn "from '@agent-poker/werewolf-engine'" packages/agent-runtime/src --include='*.ts' | grep -v __tests__ && echo "FAIL: runtime code imports werewolf-engine" || echo "ok: only tests import werewolf-engine"
```
Expected: `ok: only tests import werewolf-engine`.

- [ ] **Step 3: Verify CLAUDE.md invariants still hold**

Spot-check by reading the test output:
- Information-isolation test in `werewolf-integration.test.ts` passes (no role-assigned/night-action/speech.inner leakage).
- `WerewolfRandomMockAgent` with the same seed produces the same pick (reproducibility).
- The Zod schemas reject unknown phase / role / action.type values.

If all three checks pass, no commit is needed for this task.

- [ ] **Step 4: Update plan with execution outcome (optional)**

If the user wants a record of completion, append a `## Execution log` section to this plan file with the SHAs of each task's commit. Otherwise, no commit.

Plan 3 (`packages/werewolf-orchestrator`) is the next planning task — invoke `superpowers:writing-plans` again with that scope after reviewing this plan's outcomes.
