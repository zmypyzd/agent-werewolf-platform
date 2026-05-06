# Werewolf Orchestrator Implementation Plan (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@agent-poker/werewolf-orchestrator`, a new package that drives a complete 9-AI werewolf match end-to-end by stitching together Plan 1's engine (`@agent-poker/werewolf-engine`) and Plan 2's agent boundary (`@agent-poker/agent-runtime`). The package exposes a `WerewolfMatchRunner` (single-match game loop) and a `WerewolfOrchestrator` (lightweight match registry + lifecycle), both of which honour the information-isolation invariant by routing every agent call through `getPublicState`/`getPrivateState`.

**Architecture:** The runner does NOT know agent identities directly — it holds a `Map<WerewolfPlayerId, IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>>`. On each tick it picks the next actor in seat order whose `getValidActions(state, playerId)` is non-empty, builds a request via `buildWerewolfDecisionRequest`, calls the agent through `TimeoutHandler` with a domain-specific `werewolfFallback` (returns the first valid action), validates the response against `validActions` by shape (so free-text `speak` content is preserved), and applies the action. All transitions emit `WerewolfReplayEvent`s through an `EventEmitter`. The orchestrator is a thin registry that creates matches via `createGame`, accepts agent registrations per playerId, runs a match through the runner, and persists the resulting `WerewolfMatchSummary` in memory. Decision-trace persistence and public-event filtering are out of scope (Plan 4).

**Tech Stack:** TypeScript 5.5 strict (NodeNext, `.js` import suffix), Vitest 2, pnpm workspaces. Runtime deps: `@agent-poker/shared`, `@agent-poker/werewolf-engine`, `@agent-poker/agent-runtime`. No new third-party deps. Node built-ins: `crypto.randomUUID`, `events.EventEmitter`.

**Reference inputs:**
- Plan 1 spec/plan: `docs/superpowers/plans/2026-05-04-werewolf-engine.md`
- Plan 2 spec/plan: `docs/superpowers/plans/2026-05-05-werewolf-agent-protocol.md`
- Existing analogue: `packages/table-orchestrator/src/{orchestrator,hand-runner}.ts` (poker version — patterns to mirror, but the engine API is different)
- Engine surface: `packages/werewolf-engine/src/index.ts` exports `createGame`, `applyAction`, `startFirstNight`, `getValidActions`, `getPublicState`, `getPrivateState`.
- Agent surface: `packages/agent-runtime/src/index.ts` exports `IAgent`, `TimeoutHandler`, `buildWerewolfDecisionRequest`, `WerewolfMockAgent`, `WerewolfRandomMockAgent`.
- CLAUDE.md "Information-isolation invariant" — `publicState` MUST not leak roles or night actions; per-agent `privateState` is gated by role (verified by Plan 2 integration test, re-verified here at the orchestrator boundary).

---

## File Map

**Created:**
- `packages/werewolf-orchestrator/package.json`
- `packages/werewolf-orchestrator/tsconfig.json`
- `packages/werewolf-orchestrator/vitest.config.ts`
- `packages/werewolf-orchestrator/src/index.ts`
- `packages/werewolf-orchestrator/src/action-validator.ts` — `actionsMatchByShape`, `validateWerewolfAction`
- `packages/werewolf-orchestrator/src/werewolf-fallback.ts` — `werewolfFallback` builder for `TimeoutHandler`
- `packages/werewolf-orchestrator/src/replay-event.ts` — `WerewolfReplayEvent` type
- `packages/werewolf-orchestrator/src/match-summary.ts` — `WerewolfMatchSummary` type + `buildWerewolfMatchSummary`
- `packages/werewolf-orchestrator/src/match-runner.ts` — `WerewolfMatchRunner` (single-game loop)
- `packages/werewolf-orchestrator/src/orchestrator.ts` — `WerewolfOrchestrator` (match registry)
- `packages/werewolf-orchestrator/src/__tests__/action-validator.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/werewolf-fallback.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/match-summary.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/orchestrator.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/integration.test.ts`

**NOT modified (intentional):**
- `packages/werewolf-engine/*` — engine surface is frozen.
- `packages/agent-runtime/*` — boundary types are frozen.
- `packages/shared/*` — types from Plan 2 (`WerewolfDecisionRequest`, `WerewolfDecisionResponse`, etc.) are reused as-is.
- `apps/api`, `apps/web` — Plan 4/5.
- `pnpm-workspace.yaml`, `vitest.workspace.ts` — both auto-discover via glob (`packages/*`, `packages/*/vitest.config.ts`), so no edit needed.

---

## Data Model (locked here for cross-task consistency)

### Replay event

```typescript
// packages/werewolf-orchestrator/src/replay-event.ts
export interface WerewolfReplayEvent {
  readonly eventId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly eventType: WerewolfReplayEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export type WerewolfReplayEventType =
  | 'match.started'
  | 'agent.action_requested'
  | 'agent.action_received'
  | 'agent.timeout'
  | 'agent.invalid_action'
  | 'engine.action_applied'
  | 'phase.changed'
  | 'match.completed';
```

### Match summary

```typescript
// packages/werewolf-orchestrator/src/match-summary.ts
import type {
  WerewolfHistoryEntry,
  WerewolfPlayerId,
  WerewolfRole,
  WerewolfSide,
} from '@agent-poker/shared';

export interface WerewolfFinalPlayer {
  readonly id: WerewolfPlayerId;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WerewolfMatchSummary {
  readonly gameId: string;
  readonly seed: string;
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly finalPlayers: ReadonlyArray<WerewolfFinalPlayer>;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly replayEventCount: number;
  readonly stepCount: number;
}
```

The summary is emitted at game-over; all roles are revealed at that point so including the full engine `history` (with `role-assigned`, `night-action`, etc.) is fine. Plan 4 will derive a redacted public artifact when wiring up the API.

### Action shape-match (locks how the validator treats free-text fields)

```typescript
// packages/werewolf-orchestrator/src/action-validator.ts
// Two actions match by shape iff:
//   - their `type` is identical, AND
//   - all *identity* fields match (voterId, targetId, playerId)
// `speak.inner`, `speak.performance`, `speak.speech` are FREE TEXT — they are
// not compared. The engine accepts whatever string the agent supplies; it is
// the agent's job to fill them in.
```

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/werewolf-orchestrator/package.json`
- Create: `packages/werewolf-orchestrator/tsconfig.json`
- Create: `packages/werewolf-orchestrator/vitest.config.ts`
- Create: `packages/werewolf-orchestrator/src/index.ts`

- [ ] **Step 1: Create `package.json`**

Create `packages/werewolf-orchestrator/package.json` with EXACTLY:

```json
{
  "name": "@agent-poker/werewolf-orchestrator",
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
    "@agent-poker/werewolf-engine": "workspace:*",
    "@agent-poker/agent-runtime": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Create `packages/werewolf-orchestrator/tsconfig.json` with EXACTLY:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "paths": {
      "@agent-poker/shared": ["../shared/src/index.ts"],
      "@agent-poker/werewolf-engine": ["../werewolf-engine/src/index.ts"],
      "@agent-poker/agent-runtime": ["../agent-runtime/src/index.ts"]
    }
  },
  "references": [
    { "path": "../shared" },
    { "path": "../werewolf-engine" },
    { "path": "../agent-runtime" }
  ],
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create `packages/werewolf-orchestrator/vitest.config.ts` with EXACTLY:

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true } });
```

- [ ] **Step 4: Create empty `src/index.ts`**

Create `packages/werewolf-orchestrator/src/index.ts` with EXACTLY:

```typescript
export {};
```

(The real exports are appended in Task 8 once the modules exist.)

- [ ] **Step 5: Install + build to verify scaffolding**

From repo root:
```bash
pnpm install
pnpm --filter @agent-poker/werewolf-orchestrator run build
```
Expected: SUCCESS. The `dist/` folder appears in `packages/werewolf-orchestrator/`.

- [ ] **Step 6: Commit**

```bash
git add packages/werewolf-orchestrator/package.json packages/werewolf-orchestrator/tsconfig.json packages/werewolf-orchestrator/vitest.config.ts packages/werewolf-orchestrator/src/index.ts pnpm-lock.yaml
git commit -m "feat(werewolf-orchestrator): scaffold package"
```

---

## Task 2: `actionsMatchByShape` + `validateWerewolfAction`

**Files:**
- Create: `packages/werewolf-orchestrator/src/action-validator.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/action-validator.test.ts`

The orchestrator must verify that the action returned by an agent is one of the actions in `req.validActions`. It compares by *shape* (type + identity fields), not deep-equality, because `speak` carries free-text fields (`inner`, `performance`, `speech`) that the agent fills in itself.

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/action-validator.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type { WerewolfAction } from '@agent-poker/shared';
import { actionsMatchByShape, validateWerewolfAction } from '../action-validator.js';

describe('actionsMatchByShape', () => {
  it('returns false for different types', () => {
    const a: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const b: WerewolfAction = { type: 'witch-skip-save' };
    expect(actionsMatchByShape(a, b)).toBe(false);
  });

  it('werewolf-vote matches when voterId + targetId equal', () => {
    expect(
      actionsMatchByShape(
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
      ),
    ).toBe(true);
  });

  it('werewolf-vote rejects mismatched targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
      ),
    ).toBe(false);
  });

  it('speak matches by playerId only (free text ignored)', () => {
    expect(
      actionsMatchByShape(
        { type: 'speak', playerId: 'p3', inner: 'I am the seer', performance: '冷静', speech: '我查验了 p7 是好人' },
        { type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' },
      ),
    ).toBe(true);
  });

  it('speak rejects mismatched playerId', () => {
    expect(
      actionsMatchByShape(
        { type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' },
        { type: 'speak', playerId: 'p4', inner: '', performance: '', speech: '' },
      ),
    ).toBe(false);
  });

  it('day-vote matches null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: null },
      ),
    ).toBe(true);
  });

  it('day-vote rejects null vs non-null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      ),
    ).toBe(false);
  });

  it('hunter-shoot matches null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'hunter-shoot', targetId: null },
        { type: 'hunter-shoot', targetId: null },
      ),
    ).toBe(true);
  });

  it('witch-save matches by targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'witch-save', targetId: 'p4' },
        { type: 'witch-save', targetId: 'p4' },
      ),
    ).toBe(true);
    expect(
      actionsMatchByShape(
        { type: 'witch-save', targetId: 'p4' },
        { type: 'witch-save', targetId: 'p5' },
      ),
    ).toBe(false);
  });

  it('witch-skip-save matches by type', () => {
    expect(
      actionsMatchByShape({ type: 'witch-skip-save' }, { type: 'witch-skip-save' }),
    ).toBe(true);
  });

  it('seer-divine matches by targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'seer-divine', targetId: 'p7' },
        { type: 'seer-divine', targetId: 'p7' },
      ),
    ).toBe(true);
  });
});

describe('validateWerewolfAction', () => {
  const valid: WerewolfAction[] = [
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
  ];

  it('returns valid=true when action is in validActions', () => {
    const result = validateWerewolfAction(
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
      valid,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' });
    }
  });

  it('returns valid=false when action is not in validActions', () => {
    const result = validateWerewolfAction(
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p9' },
      valid,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/not in validActions/);
    }
  });

  it('returns valid=false when validActions is empty', () => {
    const result = validateWerewolfAction(
      { type: 'witch-skip-save' },
      [],
    );
    expect(result.valid).toBe(false);
  });

  it('preserves free-text fields when speak matches by shape', () => {
    const result = validateWerewolfAction(
      { type: 'speak', playerId: 'p3', inner: 'thinking...', performance: 'calm', speech: 'I divine p7' },
      [{ type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' }],
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.action).toEqual({
        type: 'speak',
        playerId: 'p3',
        inner: 'thinking...',
        performance: 'calm',
        speech: 'I divine p7',
      });
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails (module not found)**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/action-validator.test.ts
```
Expected: FAIL — `../action-validator.js` not found.

- [ ] **Step 3: Implement `action-validator.ts`**

Create `packages/werewolf-orchestrator/src/action-validator.ts` with EXACTLY:

```typescript
import type { WerewolfAction } from '@agent-poker/shared';

export function actionsMatchByShape(a: WerewolfAction, b: WerewolfAction): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'werewolf-vote': {
      const bb = b as Extract<WerewolfAction, { type: 'werewolf-vote' }>;
      return a.voterId === bb.voterId && a.targetId === bb.targetId;
    }
    case 'witch-save':
    case 'witch-poison': {
      const bb = b as Extract<WerewolfAction, { type: 'witch-save' | 'witch-poison' }>;
      return a.targetId === bb.targetId;
    }
    case 'witch-skip-save':
    case 'witch-skip-poison':
      return true;
    case 'seer-divine': {
      const bb = b as Extract<WerewolfAction, { type: 'seer-divine' }>;
      return a.targetId === bb.targetId;
    }
    case 'speak': {
      // Free text (inner / performance / speech) intentionally ignored. The
      // engine accepts whatever the agent produces; we only care that the
      // speaker is allowed to speak right now.
      const bb = b as Extract<WerewolfAction, { type: 'speak' }>;
      return a.playerId === bb.playerId;
    }
    case 'day-vote': {
      const bb = b as Extract<WerewolfAction, { type: 'day-vote' }>;
      return a.voterId === bb.voterId && a.targetId === bb.targetId;
    }
    case 'hunter-shoot': {
      const bb = b as Extract<WerewolfAction, { type: 'hunter-shoot' }>;
      return a.targetId === bb.targetId;
    }
  }
}

export type ActionValidationResult =
  | { readonly valid: true; readonly action: WerewolfAction }
  | { readonly valid: false; readonly reason: string };

export function validateWerewolfAction(
  action: WerewolfAction,
  validActions: ReadonlyArray<WerewolfAction>,
): ActionValidationResult {
  const matched = validActions.some((v) => actionsMatchByShape(action, v));
  if (!matched) {
    return {
      valid: false,
      reason: `Action ${JSON.stringify(action)} not in validActions (${validActions.length} options)`,
    };
  }
  return { valid: true, action };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/action-validator.test.ts
```
Expected: 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/action-validator.ts packages/werewolf-orchestrator/src/__tests__/action-validator.test.ts
git commit -m "feat(werewolf-orchestrator): action shape-match validator"
```

---

## Task 3: `werewolfFallback` for `TimeoutHandler`

**Files:**
- Create: `packages/werewolf-orchestrator/src/werewolf-fallback.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/werewolf-fallback.test.ts`

When an agent times out, throws, or returns an action that's not in `validActions`, the orchestrator falls back deterministically to the **first** action in `req.validActions`. This is the same shape as the integration test in Plan 2, lifted into a reusable helper that satisfies the `FallbackBuilder<TReq, TRes>` contract from `agent-runtime`.

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/werewolf-fallback.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfAction,
  WerewolfPublicState,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { werewolfFallback } from '../werewolf-fallback.js';

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
    requestId: 'req-1',
    gameId: 'g',
    agentId: 'a-1',
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

describe('werewolfFallback', () => {
  it('returns the first valid action wrapped in a response', () => {
    const action: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const res = werewolfFallback(fakeRequest([action, { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' }]));
    expect(res.action).toEqual(action);
    expect(res.requestId).toBe('req-1');
    expect(res.agentId).toBe('a-1');
  });

  it('throws if validActions is empty (caller should never invoke fallback in that case)', () => {
    expect(() => werewolfFallback(fakeRequest([]))).toThrow(/no valid action/);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/werewolf-fallback.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `werewolf-fallback.ts`**

Create `packages/werewolf-orchestrator/src/werewolf-fallback.ts` with EXACTLY:

```typescript
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';

// Domain-specific fallback for TimeoutHandler<WerewolfDecisionRequest, WerewolfDecisionResponse>.
// Picks the FIRST valid action — this guarantees deterministic, valid behaviour
// when an agent times out, throws, or returns an action that is not in
// validActions. Throws when validActions is empty; the caller (the runner)
// must avoid invoking the fallback for a player with no valid action.
export function werewolfFallback(
  req: WerewolfDecisionRequest,
): WerewolfDecisionResponse {
  const first = req.validActions[0];
  if (!first) {
    throw new Error(
      `werewolfFallback: no valid action available for player ${req.playerId} in phase ${req.phase}`,
    );
  }
  return {
    requestId: req.requestId,
    agentId: req.agentId,
    action: first,
  };
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/werewolf-fallback.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/werewolf-fallback.ts packages/werewolf-orchestrator/src/__tests__/werewolf-fallback.test.ts
git commit -m "feat(werewolf-orchestrator): werewolfFallback for TimeoutHandler"
```

---

## Task 4: `WerewolfReplayEvent` + `WerewolfMatchSummary` types and builder

**Files:**
- Create: `packages/werewolf-orchestrator/src/replay-event.ts`
- Create: `packages/werewolf-orchestrator/src/match-summary.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/match-summary.test.ts`

- [ ] **Step 1: Create `replay-event.ts`**

Create `packages/werewolf-orchestrator/src/replay-event.ts` with EXACTLY:

```typescript
export type WerewolfReplayEventType =
  | 'match.started'
  | 'agent.action_requested'
  | 'agent.action_received'
  | 'agent.timeout'
  | 'agent.invalid_action'
  | 'engine.action_applied'
  | 'phase.changed'
  | 'match.completed';

export interface WerewolfReplayEvent {
  readonly eventId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly eventType: WerewolfReplayEventType;
  readonly timestamp: number;
  readonly data: Readonly<Record<string, unknown>>;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/match-summary.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type { WerewolfGameState } from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import { buildWerewolfMatchSummary } from '../match-summary.js';

function gameOverState(seed: string): WerewolfGameState {
  const base = createGame({ gameId: 'g-test', seed });
  return {
    ...base,
    phase: 'game-over',
    winner: 'good',
    nightNumber: 2,
    dayNumber: 2,
    history: [
      ...base.history,
      { type: 'game-over', winner: 'good' },
    ],
  };
}

describe('buildWerewolfMatchSummary', () => {
  it('builds a summary with winner, durations, and final players', () => {
    const initial = createGame({ gameId: 'g-test', seed: 's-summary-1' });
    const final = gameOverState('s-summary-1');
    const summary = buildWerewolfMatchSummary({
      initialState: initial,
      finalState: final,
      startedAt: 1_000,
      completedAt: 1_750,
      replayEventCount: 42,
      stepCount: 18,
    });

    expect(summary.gameId).toBe('g-test');
    expect(summary.seed).toBe('s-summary-1');
    expect(summary.winner).toBe('good');
    expect(summary.startedAt).toBe(1_000);
    expect(summary.completedAt).toBe(1_750);
    expect(summary.durationMs).toBe(750);
    expect(summary.nightCount).toBe(2);
    expect(summary.dayCount).toBe(2);
    expect(summary.finalPlayers).toHaveLength(9);
    for (const p of summary.finalPlayers) {
      expect(['werewolf', 'villager', 'seer', 'witch', 'hunter']).toContain(p.role);
      expect(['werewolf', 'good']).toContain(p.side);
    }
    expect(summary.history).toEqual(final.history);
    expect(summary.replayEventCount).toBe(42);
    expect(summary.stepCount).toBe(18);
  });

  it('throws when finalState.winner is null (not at game-over)', () => {
    const initial = createGame({ gameId: 'g-test', seed: 's-summary-2' });
    expect(() =>
      buildWerewolfMatchSummary({
        initialState: initial,
        finalState: initial, // setup phase, no winner
        startedAt: 0,
        completedAt: 0,
        replayEventCount: 0,
        stepCount: 0,
      }),
    ).toThrow(/winner/);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails (module not found)**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-summary.test.ts
```
Expected: FAIL — `../match-summary.js` not found.

- [ ] **Step 4: Create `match-summary.ts`**

Create `packages/werewolf-orchestrator/src/match-summary.ts` with EXACTLY:

```typescript
import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPlayerId,
  WerewolfRole,
  WerewolfSide,
} from '@agent-poker/shared';

export interface WerewolfFinalPlayer {
  readonly id: WerewolfPlayerId;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WerewolfMatchSummary {
  readonly gameId: string;
  readonly seed: string;
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly finalPlayers: ReadonlyArray<WerewolfFinalPlayer>;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly replayEventCount: number;
  readonly stepCount: number;
}

export interface BuildWerewolfMatchSummaryInput {
  readonly initialState: WerewolfGameState;
  readonly finalState: WerewolfGameState;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly replayEventCount: number;
  readonly stepCount: number;
}

export function buildWerewolfMatchSummary(
  input: BuildWerewolfMatchSummaryInput,
): WerewolfMatchSummary {
  const { finalState } = input;
  if (finalState.winner === null) {
    throw new Error(
      `buildWerewolfMatchSummary: finalState.winner is null (phase=${finalState.phase})`,
    );
  }
  const finalPlayers: WerewolfFinalPlayer[] = finalState.players.map((p) => ({
    id: p.id,
    seatIndex: p.seatIndex,
    name: p.name,
    role: p.role,
    side: p.side,
    alive: p.alive,
  }));
  return {
    gameId: finalState.gameId,
    seed: finalState.seed,
    winner: finalState.winner,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    nightCount: finalState.nightNumber,
    dayCount: finalState.dayNumber,
    finalPlayers,
    history: finalState.history,
    replayEventCount: input.replayEventCount,
    stepCount: input.stepCount,
  };
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-summary.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/werewolf-orchestrator/src/replay-event.ts packages/werewolf-orchestrator/src/match-summary.ts packages/werewolf-orchestrator/src/__tests__/match-summary.test.ts
git commit -m "feat(werewolf-orchestrator): replay-event + match-summary types and builder"
```

---

## Task 5: `WerewolfMatchRunner` (single-game loop)

**Files:**
- Create: `packages/werewolf-orchestrator/src/match-runner.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts`

The runner is the heart of the orchestrator. It owns:
1. The current `WerewolfGameState`.
2. A `Map<WerewolfPlayerId, IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>>`.
3. An `EventEmitter` for broadcasting `WerewolfReplayEvent`s (per-event channel + a catch-all `'replay-event'` channel, mirroring the poker `HandRunner` pattern).

Loop algorithm:
1. If state is in `'setup'`, call `startFirstNight` to kick the game off and emit `match.started`.
2. While `state.phase !== 'game-over'`:
   - Pick the next actor: iterate `state.players` sorted by `seatIndex`; the first player whose `getValidActions(state, p.id).length > 0` becomes the actor.
   - Build the decision request via `buildWerewolfDecisionRequest` using `getPublicState`/`getPrivateState`.
   - Call the agent through `TimeoutHandler` with `werewolfFallback`.
   - Validate the response action via `validateWerewolfAction`. If invalid, fall back to `werewolfFallback(req).action` and emit `agent.invalid_action`.
   - Apply the action via `applyAction`. Emit `engine.action_applied` and `phase.changed` (if phase changed).
   - Bail with an explicit error if no actor was found (deadlock — should be unreachable for a well-formed engine state).
   - Bail if `stepCount > maxSteps` (defaults to 10000).
3. Build and return a `WerewolfMatchSummary`. Emit `match.completed`.

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
} from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

function buildAgents(state: WerewolfGameState): Map<string, WerewolfAgent> {
  const m = new Map<string, WerewolfAgent>();
  for (const p of state.players) {
    m.set(p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
  }
  return m;
}

describe('WerewolfMatchRunner', () => {
  it('runs a complete 9-AI match to game-over and produces a summary', async () => {
    const initial = createGame({ gameId: 'g-runner-1', seed: 'seed-runner-1' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);

    const summary = await runner.run();

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.gameId).toBe('g-runner-1');
    expect(summary.seed).toBe('seed-runner-1');
    expect(summary.finalPlayers).toHaveLength(9);
    expect(summary.replayEventCount).toBeGreaterThan(0);
    expect(summary.stepCount).toBeGreaterThan(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits replay events with monotonically increasing sequence', async () => {
    const initial = createGame({ gameId: 'g-runner-2', seed: 'seed-runner-2' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.sequence).toBe(events[i - 1]!.sequence + 1);
    }
    expect(events[0]!.eventType).toBe('match.started');
    expect(events[events.length - 1]!.eventType).toBe('match.completed');
  });

  it('emits agent.action_requested before agent.action_received for each step', async () => {
    const initial = createGame({ gameId: 'g-runner-3', seed: 'seed-runner-3' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const requested = events.filter((e) => e.eventType === 'agent.action_requested');
    const received = events.filter((e) => e.eventType === 'agent.action_received');
    expect(requested.length).toBe(received.length);
    expect(requested.length).toBe(events.filter((e) => e.eventType === 'engine.action_applied').length);
  });

  it('emits agent.timeout + agent.action_received with usedFallback=true when an agent stalls', async () => {
    const initial = createGame({ gameId: 'g-runner-4', seed: 'seed-runner-4' });
    const agents = buildAgents(initial);
    // Replace one agent with a stalling agent — only on the very first request.
    const stallerId = initial.players[0]!.id;
    let stalledOnce = false;
    const realAgent = agents.get(stallerId)!;
    const stallAgent: WerewolfAgent = {
      agentId: 'staller',
      name: 'Staller',
      requestDecision(req) {
        if (!stalledOnce) {
          stalledOnce = true;
          return new Promise<WerewolfDecisionResponse>(() => {
            // never resolves
          });
        }
        return realAgent.requestDecision(req);
      },
    };
    agents.set(stallerId, stallAgent);

    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    // 50ms timeout so the test runs quickly.
    const runner = new WerewolfMatchRunner(initial, agents, 50, emitter);
    await runner.run();

    const timeouts = events.filter((e) => e.eventType === 'agent.timeout');
    expect(timeouts.length).toBeGreaterThanOrEqual(1);
  });

  it('throws when an agent is missing for a player at start', async () => {
    const initial = createGame({ gameId: 'g-runner-5', seed: 'seed-runner-5' });
    const agents = buildAgents(initial);
    agents.delete(initial.players[3]!.id);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await expect(runner.run()).rejects.toThrow(/missing agent/);
  });

  it('throws when stepCount exceeds maxSteps', async () => {
    const initial = createGame({ gameId: 'g-runner-6', seed: 'seed-runner-6' });
    const agents = buildAgents(initial);
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter, { maxSteps: 1 });
    await expect(runner.run()).rejects.toThrow(/exceeded.*step/i);
  });

  it('publicState passed to agents never contains role-assigned or night-action history entries', async () => {
    const initial = createGame({ gameId: 'g-runner-7', seed: 'seed-runner-7' });
    const seenRequests: WerewolfDecisionRequest[] = [];
    const agents = new Map<string, WerewolfAgent>();
    for (const p of initial.players) {
      const inner = new WerewolfMockAgent(`agent-${p.id}`, p.name);
      agents.set(p.id, {
        agentId: inner.agentId,
        name: inner.name,
        async requestDecision(req) {
          seenRequests.push(req);
          return inner.requestDecision(req);
        },
      });
    }
    const emitter = new EventEmitter();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(seenRequests.length).toBeGreaterThan(0);
    for (const req of seenRequests) {
      const types = req.publicState.history.map((e) => (e as { type: string }).type);
      expect(types).not.toContain('role-assigned');
      expect(types).not.toContain('night-action');
      // privateState.selfId must equal the player whose turn it is.
      expect(req.privateState.selfId).toBe(req.playerId);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner.test.ts
```
Expected: FAIL — `../match-runner.js` not found.

- [ ] **Step 3: Implement `match-runner.ts`**

Create `packages/werewolf-orchestrator/src/match-runner.ts` with EXACTLY:

```typescript
import { randomUUID } from 'crypto';
import type { EventEmitter } from 'events';
import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
  WerewolfPlayer,
  WerewolfPhase,
  WerewolfPlayerId,
} from '@agent-poker/shared';
import {
  applyAction,
  getPrivateState,
  getPublicState,
  getValidActions,
  startFirstNight,
} from '@agent-poker/werewolf-engine';
import {
  TimeoutHandler,
  buildWerewolfDecisionRequest,
} from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { validateWerewolfAction } from './action-validator.js';
import { werewolfFallback } from './werewolf-fallback.js';
import type { WerewolfReplayEvent, WerewolfReplayEventType } from './replay-event.js';
import {
  buildWerewolfMatchSummary,
  type WerewolfMatchSummary,
} from './match-summary.js';

export type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

export interface WerewolfMatchRunnerOptions {
  readonly maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 10_000;

export class WerewolfMatchRunner {
  private state: WerewolfGameState;
  private readonly initialState: WerewolfGameState;
  private readonly maxSteps: number;
  private replayEventCount = 0;
  private sequence = 0;
  private stepCount = 0;

  constructor(
    initialState: WerewolfGameState,
    private readonly agents: Map<WerewolfPlayerId, WerewolfAgent>,
    private readonly timeoutMs: number,
    private readonly emitter: EventEmitter,
    options: WerewolfMatchRunnerOptions = {},
  ) {
    this.initialState = initialState;
    this.state = initialState;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  async run(): Promise<WerewolfMatchSummary> {
    for (const p of this.state.players) {
      if (!this.agents.has(p.id)) {
        throw new Error(
          `WerewolfMatchRunner: missing agent for player ${p.id} (${p.name})`,
        );
      }
    }

    const startedAt = Date.now();

    if (this.state.phase === 'setup') {
      this.state = startFirstNight(this.state);
    }

    this.emit('match.started', {
      gameId: this.state.gameId,
      seed: this.state.seed,
      players: this.state.players.map((p) => ({
        id: p.id,
        seatIndex: p.seatIndex,
        name: p.name,
      })),
    });

    while (this.state.phase !== 'game-over') {
      if (this.stepCount >= this.maxSteps) {
        throw new Error(
          `WerewolfMatchRunner: exceeded ${this.maxSteps} steps without termination (phase=${this.state.phase})`,
        );
      }
      const actor = this.pickNextActor();
      if (!actor) {
        throw new Error(
          `WerewolfMatchRunner: deadlock — phase ${this.state.phase} has no actor with valid actions`,
        );
      }
      await this.runOneAction(actor.player, actor.validActions);
      this.stepCount++;
    }

    const completedAt = Date.now();
    const summary = buildWerewolfMatchSummary({
      initialState: this.initialState,
      finalState: this.state,
      startedAt,
      completedAt,
      replayEventCount: this.replayEventCount + 1, // +1 for match.completed about to fire
      stepCount: this.stepCount,
    });

    this.emit('match.completed', {
      gameId: this.state.gameId,
      winner: this.state.winner,
      durationMs: completedAt - startedAt,
      stepCount: this.stepCount,
    });

    return summary;
  }

  private pickNextActor(): { player: WerewolfPlayer; validActions: WerewolfAction[] } | null {
    const sorted = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);
    for (const p of sorted) {
      const valid = getValidActions(this.state, p.id);
      if (valid.length > 0) return { player: p, validActions: valid };
    }
    return null;
  }

  private async runOneAction(
    player: WerewolfPlayer,
    validActions: WerewolfAction[],
  ): Promise<void> {
    const phaseBefore: WerewolfPhase = this.state.phase;
    const agent = this.agents.get(player.id)!;
    const req = buildWerewolfDecisionRequest({
      requestId: randomUUID(),
      gameId: this.state.gameId,
      agentId: agent.agentId,
      playerId: player.id,
      publicState: getPublicState(this.state),
      privateState: getPrivateState(this.state, player.id),
      validActions,
      deadlineMs: this.timeoutMs,
    });

    this.emit('agent.action_requested', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      phase: req.phase,
      validActionCount: validActions.length,
    });

    const handler = new TimeoutHandler<WerewolfDecisionRequest, WerewolfDecisionResponse>(
      agent,
      this.timeoutMs,
      werewolfFallback,
    );
    const startedAt = Date.now();
    const { response, timedOut } = await handler.requestDecision(req);
    const elapsedMs = Date.now() - startedAt;

    let action: WerewolfAction;
    let usedFallback = false;
    let invalidReason: string | null = null;

    if (timedOut) {
      action = response.action;
      usedFallback = true;
      this.emit('agent.timeout', {
        requestId: req.requestId,
        agentId: agent.agentId,
        playerId: player.id,
        elapsedMs,
        fallbackAction: action,
      });
    } else {
      const validation = validateWerewolfAction(response.action, validActions);
      if (validation.valid) {
        action = validation.action;
      } else {
        invalidReason = validation.reason;
        action = werewolfFallback(req).action;
        usedFallback = true;
        this.emit('agent.invalid_action', {
          requestId: req.requestId,
          agentId: agent.agentId,
          playerId: player.id,
          received: response.action,
          reason: invalidReason,
          fallbackAction: action,
        });
      }
    }

    this.emit('agent.action_received', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      action,
      usedFallback,
      timedOut,
      elapsedMs,
      ...(invalidReason !== null ? { invalidReason } : {}),
    });

    this.state = applyAction(this.state, action);

    this.emit('engine.action_applied', {
      phase: phaseBefore,
      action,
      newPhase: this.state.phase,
    });

    if (this.state.phase !== phaseBefore) {
      this.emit('phase.changed', { from: phaseBefore, to: this.state.phase });
    }
  }

  private emit(eventType: WerewolfReplayEventType, data: Record<string, unknown>): void {
    const event: WerewolfReplayEvent = {
      eventId: randomUUID(),
      gameId: this.state.gameId,
      sequence: this.sequence++,
      eventType,
      timestamp: Date.now(),
      data,
    };
    this.replayEventCount++;
    this.emitter.emit(eventType, event);
    this.emitter.emit('replay-event', event);
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner.test.ts
```
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/match-runner.ts packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts
git commit -m "feat(werewolf-orchestrator): WerewolfMatchRunner game loop"
```

---

## Task 6: `WerewolfOrchestrator` (match registry)

**Files:**
- Create: `packages/werewolf-orchestrator/src/orchestrator.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/orchestrator.test.ts`

A thin lifecycle layer that:
- `createMatch(config)` → constructs initial state via `createGame`, stores it under a `matchId` (the `gameId`), returns `{ matchId, initialState }`.
- `registerAgent(matchId, playerId, agent)` → records an agent for one of the 9 player slots.
- `runMatch(matchId, options?)` → asserts all 9 slots are filled, instantiates `WerewolfMatchRunner`, runs to completion, stashes the summary.
- `getMatchSummary(matchId)` → returns the saved summary or `null`.
- `getMatch(matchId)` → returns the in-memory entry (state + agents map snapshot) for tests/debugging.

The orchestrator owns its own `EventEmitter` (one per match) so callers can subscribe to events for a specific match. Decision-trace persistence and durable storage are deferred to Plan 4.

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/orchestrator.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { WerewolfMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

describe('WerewolfOrchestrator', () => {
  it('createMatch returns matchId and initial state with 9 players in seat order', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-orch-1',
      seed: 'seed-orch-1',
    });
    expect(matchId).toBe('g-orch-1');
    expect(initialState.players).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(initialState.players[i]!.seatIndex).toBe(i);
      expect(initialState.players[i]!.id).toBe(`p${i + 1}`);
    }
  });

  it('runMatch throws when not all 9 agents are registered', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-2', seed: 'seed-orch-2' });
    // Only register 8 agents
    for (let i = 0; i < 8; i++) {
      orch.registerAgent(matchId, initialState.players[i]!.id, new WerewolfMockAgent(`a${i}`, 'X'));
    }
    await expect(orch.runMatch(matchId)).rejects.toThrow(/missing agent/);
  });

  it('runMatch drives 9 mock agents to game-over and stashes the summary', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-3', seed: 'seed-orch-3' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(orch.getMatchSummary(matchId)).toEqual(summary);
  });

  it('runMatch emits events on the per-match emitter', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-4', seed: 'seed-orch-4' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    await orch.runMatch(matchId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.eventType).toBe('match.started');
    expect(events[events.length - 1]!.eventType).toBe('match.completed');
  });

  it('createMatch with duplicate gameId throws', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'dup', seed: 's1' });
    expect(() => orch.createMatch({ gameId: 'dup', seed: 's2' })).toThrow(/already exists/);
  });

  it('registerAgent throws for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() =>
      orch.registerAgent('does-not-exist', 'p1', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown match/);
  });

  it('registerAgent throws for unknown playerId', () => {
    const orch = new WerewolfOrchestrator();
    const { matchId } = orch.createMatch({ gameId: 'g-orch-5', seed: 's5' });
    expect(() =>
      orch.registerAgent(matchId, 'p99', new WerewolfMockAgent('a', 'A')),
    ).toThrow(/unknown player/);
  });

  it('runMatch throws if invoked twice on the same matchId', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-orch-6', seed: 'seed-orch-6' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    await orch.runMatch(matchId);
    await expect(orch.runMatch(matchId)).rejects.toThrow(/already (run|completed)/i);
  });

  it('getMatchSummary returns null for unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(orch.getMatchSummary('does-not-exist')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator.test.ts
```
Expected: FAIL — `../orchestrator.js` not found.

- [ ] **Step 3: Implement `orchestrator.ts`**

Create `packages/werewolf-orchestrator/src/orchestrator.ts` with EXACTLY:

```typescript
import { EventEmitter } from 'events';
import type {
  WerewolfGameState,
  WerewolfPlayerId,
} from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import {
  WerewolfMatchRunner,
  type WerewolfAgent,
  type WerewolfMatchRunnerOptions,
} from './match-runner.js';
import type { WerewolfMatchSummary } from './match-summary.js';
import type { WerewolfReplayEvent } from './replay-event.js';

export interface WerewolfMatchConfig {
  readonly gameId: string;
  readonly seed: string;
  readonly defaultTimeoutMs?: number;
}

interface MatchEntry {
  readonly initialState: WerewolfGameState;
  readonly agents: Map<WerewolfPlayerId, WerewolfAgent>;
  readonly emitter: EventEmitter;
  readonly defaultTimeoutMs: number;
  status: 'preparing' | 'running' | 'completed';
  summary: WerewolfMatchSummary | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class WerewolfOrchestrator {
  private readonly matches = new Map<string, MatchEntry>();

  createMatch(
    config: WerewolfMatchConfig,
  ): { matchId: string; initialState: WerewolfGameState } {
    if (this.matches.has(config.gameId)) {
      throw new Error(`WerewolfOrchestrator: match ${config.gameId} already exists`);
    }
    const initialState = createGame({ gameId: config.gameId, seed: config.seed });
    const entry: MatchEntry = {
      initialState,
      agents: new Map(),
      emitter: new EventEmitter(),
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      status: 'preparing',
      summary: null,
    };
    this.matches.set(config.gameId, entry);
    return { matchId: config.gameId, initialState };
  }

  registerAgent(
    matchId: string,
    playerId: WerewolfPlayerId,
    agent: WerewolfAgent,
  ): void {
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
    if (entry.status !== 'preparing') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is ${entry.status}; cannot register agents`);
    }
    if (!entry.initialState.players.some((p) => p.id === playerId)) {
      throw new Error(`WerewolfOrchestrator: unknown player ${playerId} in match ${matchId}`);
    }
    entry.agents.set(playerId, agent);
  }

  subscribe(
    matchId: string,
    listener: (event: WerewolfReplayEvent) => void,
  ): () => void {
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
    entry.emitter.on('replay-event', listener);
    return () => entry.emitter.off('replay-event', listener);
  }

  async runMatch(
    matchId: string,
    options: WerewolfMatchRunnerOptions = {},
  ): Promise<WerewolfMatchSummary> {
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
    if (entry.status === 'running') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is already running`);
    }
    if (entry.status === 'completed') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} already completed`);
    }
    entry.status = 'running';
    try {
      const runner = new WerewolfMatchRunner(
        entry.initialState,
        entry.agents,
        entry.defaultTimeoutMs,
        entry.emitter,
        options,
      );
      const summary = await runner.run();
      entry.summary = summary;
      entry.status = 'completed';
      return summary;
    } catch (err) {
      entry.status = 'preparing';
      throw err;
    }
  }

  getMatchSummary(matchId: string): WerewolfMatchSummary | null {
    return this.matches.get(matchId)?.summary ?? null;
  }
}
```

- [ ] **Step 4: Run the tests, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator.test.ts
```
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/src/orchestrator.ts packages/werewolf-orchestrator/src/__tests__/orchestrator.test.ts
git commit -m "feat(werewolf-orchestrator): WerewolfOrchestrator match registry"
```

---

## Task 7: Wire public exports through `src/index.ts`

**Files:**
- Modify: `packages/werewolf-orchestrator/src/index.ts`

- [ ] **Step 1: Replace `index.ts` with the full re-export surface**

Open `packages/werewolf-orchestrator/src/index.ts`. Replace its contents with EXACTLY:

```typescript
export * from './action-validator.js';
export * from './werewolf-fallback.js';
export * from './replay-event.js';
export * from './match-summary.js';
export * from './match-runner.js';
export * from './orchestrator.js';
```

- [ ] **Step 2: Build + run all package tests**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator run build
pnpm --filter @agent-poker/werewolf-orchestrator run test
```
Expected: every test in the package PASSES (action-validator: 14, werewolf-fallback: 2, match-summary: 2, match-runner: 7, orchestrator: 9 — total 34).

- [ ] **Step 3: Commit**

```bash
git add packages/werewolf-orchestrator/src/index.ts
git commit -m "feat(werewolf-orchestrator): export public surface"
```

---

## Task 8: End-to-end integration test

**Files:**
- Create: `packages/werewolf-orchestrator/src/__tests__/integration.test.ts`

This test exercises the full public surface (`WerewolfOrchestrator` → `WerewolfMatchRunner` → engine + agents) with deterministic mock agents. It also re-verifies the information-isolation invariant at the public boundary: subscribing to `replay-event` on the orchestrator must not surface `selfRole` / `seerKnowledge` / `witchView` / `knownAllies` from any agent's privateState through the events. (The events the runner emits at the orchestrator level carry the public-safe `agent.action_received` payload — the action object itself, no private state — so this property must hold by construction. The test pins it.)

- [ ] **Step 1: Write the integration test**

Create `packages/werewolf-orchestrator/src/__tests__/integration.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import {
  WerewolfMockAgent,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import type { WerewolfReplayEvent } from '../replay-event.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

describe('werewolf-orchestrator integration', () => {
  it('drives a complete 9-AI match (deterministic mock agents) to game-over', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-1',
      seed: 'int-1',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.finalPlayers).toHaveLength(9);
    expect(summary.history.some((e) => e.type === 'game-over')).toBe(true);
    expect(summary.replayEventCount).toBeGreaterThan(0);
  });

  it('drives a complete 9-AI match (seeded random agents) to game-over', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-2',
      seed: 'int-2',
    });
    for (const p of initialState.players) {
      orch.registerAgent(
        matchId,
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: 'int-2' }),
      );
    }
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
  });

  it('events broadcast on replay-event do not leak private fields from privateState', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-3',
      seed: 'int-3',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    await orch.runMatch(matchId);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const json = JSON.stringify(e.data);
      // No agent's private fields should appear in any broadcast event.
      expect(json).not.toMatch(/"selfRole":/);
      expect(json).not.toMatch(/"seerKnowledge":/);
      expect(json).not.toMatch(/"witchView":/);
      expect(json).not.toMatch(/"knownAllies":/);
      // No raw role-assigned or night-action engine history entries either.
      expect(json).not.toMatch(/"role-assigned"/);
      expect(json).not.toMatch(/"night-action"/);
    }
  });

  it('summary roles are revealed only at game-over (finalPlayers carries roles)', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-int-4',
      seed: 'int-4',
    });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }
    const summary = await orch.runMatch(matchId);
    const wolves = summary.finalPlayers.filter((p) => p.role === 'werewolf');
    expect(wolves.length).toBeGreaterThan(0);
    const seers = summary.finalPlayers.filter((p) => p.role === 'seer');
    expect(seers).toHaveLength(1);
  });

  it('two runs with the same gameId+seed and deterministic agents produce the same winner', async () => {
    async function runOnce(): Promise<string> {
      const orch = new WerewolfOrchestrator();
      const { matchId, initialState } = orch.createMatch({ gameId: 'g-int-5', seed: 'int-5-rep' });
      for (const p of initialState.players) {
        orch.registerAgent(matchId, p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
      }
      const summary = await orch.runMatch(matchId);
      return summary.winner;
    }
    const w1 = await runOnce();
    const w2 = await runOnce();
    expect(w1).toBe(w2);
  });

  it('falls back deterministically when an agent throws', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-int-6', seed: 'int-6' });
    const throwingAgent: WerewolfAgent = {
      agentId: 'thrower',
      name: 'Thrower',
      async requestDecision() {
        throw new Error('boom');
      },
    };
    for (let i = 0; i < initialState.players.length; i++) {
      const p = initialState.players[i]!;
      orch.registerAgent(
        matchId,
        p.id,
        i === 0 ? throwingAgent : new WerewolfMockAgent(`agent-${p.id}`, p.name),
      );
    }
    const events: WerewolfReplayEvent[] = [];
    orch.subscribe(matchId, (e) => events.push(e));
    const summary = await orch.runMatch(matchId);
    expect(['good', 'werewolf']).toContain(summary.winner);
    // The thrower is treated as a timeout (TimeoutHandler maps thrown errors to fallback).
    expect(events.some((e) => e.eventType === 'agent.timeout')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/integration.test.ts
```
Expected: 6 tests PASS. Each match terminates in < 10000 steps.

- [ ] **Step 3: Run the full package test suite**

```bash
pnpm --filter @agent-poker/werewolf-orchestrator run test
```
Expected: every test passes (5 prior files + integration = 40 tests total).

- [ ] **Step 4: Commit**

```bash
git add packages/werewolf-orchestrator/src/__tests__/integration.test.ts
git commit -m "test(werewolf-orchestrator): end-to-end 9-AI integration"
```

---

## Task 9: Workspace verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full workspace build**

From repo root:
```bash
pnpm build
```
Expected: every package builds, including the new `@agent-poker/werewolf-orchestrator`.

- [ ] **Step 2: Full workspace tests**

```bash
pnpm test
```
Expected:
- `@agent-poker/shared`, `@agent-poker/agent-protocol`, `@agent-poker/agent-runtime`, `@agent-poker/werewolf-engine`, `@agent-poker/werewolf-orchestrator` all pass.
- Pre-existing pass/fail status on `auth` / `persistence` / `apps/api` is unchanged (those depend on `better-sqlite3` native bindings; out of Plan 3 scope).

- [ ] **Step 3: Verify dependency direction is correct**

```bash
grep -n "from '@agent-poker/" packages/werewolf-orchestrator/src/*.ts | grep -v __tests__
```
Expected output (paraphrased): only imports from `@agent-poker/shared`, `@agent-poker/werewolf-engine`, `@agent-poker/agent-runtime`. No imports from `@agent-poker/poker-engine`, `@agent-poker/table-orchestrator`, `@agent-poker/persistence`, `@agent-poker/realtime`, `apps/*`.

```bash
grep -rn "from '@agent-poker/werewolf-orchestrator'" packages/werewolf-engine packages/agent-runtime packages/shared packages/agent-protocol 2>/dev/null && echo "FAIL: lower layer imports orchestrator" || echo "ok"
```
Expected: `ok` (no lower layer should import the orchestrator).

- [ ] **Step 4: Verify CLAUDE.md invariants still hold**

Spot-check by reading the integration test output: the "events broadcast on replay-event do not leak private fields" test passes, which is the orchestrator-boundary version of the information-isolation invariant.

If all three checks pass, no commit is needed for this task.

- [ ] **Step 5: Update plan with execution outcome (optional)**

If a record of completion is desired, append a `## Execution log` section to this plan file with the SHAs of each task's commit. Otherwise, no commit.

Plan 4 (likely API integration / match artifacts / decision traces) is the next planning task — invoke `superpowers:writing-plans` again with that scope after reviewing this plan's outcomes.
