# Werewolf Plan 4a — Persistence & Public Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add match-artifact persistence, decision-trace persistence, public-event projection, and a `deleteMatch` lifecycle hook to the werewolf orchestrator — all as library-level changes with no API/WS surface yet. Establishes the persistence + redaction foundation that Plans 4b (HTTP API + realtime hub) and 4c (E2E demo + adapters) build on.

**Architecture:**
- Mirror poker's persistence patterns: `IWerewolfMatchArtifactStore` (Memory + Object), `IWerewolfDecisionTraceStore` (Memory + Object), build-artifact serialization, byte/count caps.
- Werewolf-specific public projection function `werewolfReplayEventToPublic` lives in `packages/realtime` (next to poker's `replayEventToPublic`) — strips `playerId` (and other actor-revealing fields) from `agent.action_*` events that fire in private night phases (`night-werewolf-vote`, `night-witch`, `night-seer`).
- The `WerewolfReplayEvent` and `WerewolfReplayEventType` types move from `werewolf-orchestrator` to `packages/shared` so both `realtime` (filter) and `persistence` (artifact builder) can import them without depending on `werewolf-orchestrator`. The orchestrator's existing `replay-event.ts` becomes a thin re-export — internal users keep working.
- Match-runner emits a *new* `phase` field on every action-related event so the public filter is purely data-driven (no stateful phase tracking by consumers).
- Persisted match artifact contains *only* public projections: redacted replay events, public history (`WerewolfPublicHistoryEntry[]`), and per-trace public decision traces (no `privateStateHash`, no full reasoning).
- `WerewolfDecisionTrace` lives in `packages/shared`, so persistence can serialize it without an upstream dep.
- **No circular workspace dep:** the dependency graph is `shared ← realtime ← persistence ← werewolf-orchestrator`. `werewolf-orchestrator` type-only-imports the persistence interfaces; `persistence` does NOT depend on `werewolf-orchestrator`. This keeps tsc composite project references a DAG.

**Tech Stack:** TypeScript 5.5 strict + NodeNext (`.js` extensions on relative imports), pnpm 10.33.2 workspaces, Vitest 2, Zod 3 (existing schemas in `@agent-poker/agent-protocol`), Node `crypto` (randomUUID, sha256), Node `fs`/`path` (file store).

**Working tree:** `/Users/zmy/intership/5/5-4-claude/.worktrees/plan3` on branch `plan3`. Commit per task.

---

## File Structure

**New files:**
- `packages/shared/src/werewolf-replay-event.ts` — `WerewolfReplayEvent` interface, `WerewolfReplayEventType` union (relocated from `werewolf-orchestrator`)
- `packages/shared/src/werewolf-decision-trace.ts` — `WerewolfDecisionTrace`, `WerewolfDecisionTraceAction`, `WerewolfDecisionTraceFallbackReason`, `WerewolfReasoningSummary`
- `packages/realtime/src/werewolf-filter.ts` — `werewolfReplayEventToPublic` (named distinctly from poker's `replayEventToPublic` to coexist in the same module namespace)
- `packages/realtime/src/__tests__/werewolf-filter.test.ts`
- `packages/persistence/src/werewolf-decision-trace-serialization.ts` — `serializeWerewolfDecisionTraces`, `parseWerewolfDecisionTraces`, `toPublicWerewolfDecisionTrace`
- `packages/persistence/src/werewolf-decision-trace-store.ts` — `IWerewolfDecisionTraceStore`, `MemoryWerewolfDecisionTraceStore`, `ObjectWerewolfDecisionTraceStore`, default limits
- `packages/persistence/src/werewolf-match-artifact-types.ts` — `WerewolfMatchArtifactManifest`, `WerewolfMatchArtifactRecord`, `WerewolfMatchPublicSummary`, `WerewolfMatchArtifactIndexEntry`
- `packages/persistence/src/werewolf-match-artifact-serialization.ts` — `buildWerewolfArtifact`, `serializeWerewolfReplayEvents`, `toPublicWerewolfReplayEvents`, `toPublicWerewolfHistory`, `BuildWerewolfArtifactInput`
- `packages/persistence/src/werewolf-match-artifact-store.ts` — `IWerewolfMatchArtifactStore`, `MemoryWerewolfMatchArtifactStore`, `ObjectWerewolfMatchArtifactStore`, default cost limits
- `packages/werewolf-orchestrator/src/decision-trace-recorder.ts` — `recordWerewolfDecisionTrace` helper used by match-runner
- `packages/werewolf-orchestrator/src/__tests__/orchestrator-persistence.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/orchestrator-delete-match.test.ts`
- `packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts`
- `packages/persistence/src/__tests__/werewolf-match-artifact-store.test.ts`
- `packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts`
- `packages/agent-runtime/src/__tests__/werewolf-wire-roundtrip.test.ts`

**Modified files:**
- `packages/werewolf-orchestrator/src/replay-event.ts` — becomes a thin re-export of `WerewolfReplayEvent` + `WerewolfReplayEventType` from `@agent-poker/shared`
- `packages/werewolf-orchestrator/src/match-runner.ts` — emit `phase` on `agent.action_received`, `agent.timeout`, `agent.invalid_action`; record decision traces via injected store
- `packages/werewolf-orchestrator/src/orchestrator.ts` — accept `IWerewolfMatchArtifactStore` + `IWerewolfDecisionTraceStore` in constructor, save artifact on `match.completed`, add `deleteMatch(matchId)`
- `packages/werewolf-orchestrator/src/index.ts` — re-exports unchanged (replay-event.ts still exports the same names)
- `packages/persistence/src/index.ts` — export werewolf store modules
- `packages/realtime/src/index.ts` — export `werewolfReplayEventToPublic`
- `packages/shared/src/index.ts` — export new types
- `packages/werewolf-orchestrator/tsconfig.json` — add `{ "path": "../persistence" }` to references (type-only consumption)
- `packages/werewolf-orchestrator/package.json` — add `"@agent-poker/persistence": "workspace:*"` dep
- `packages/persistence/tsconfig.json` — add `{ "path": "../realtime" }` to references
- `packages/persistence/package.json` — add `"@agent-poker/realtime": "workspace:*"` dep

---

## Plan-wide conventions

- **Per-package commands** (run from the worktree root):
  - Build (also typechecks): `pnpm --filter @agent-poker/<pkg> run build` (= `tsc -b`). Treat this as your typecheck — there is no separate `lint` script in this monorepo.
  - Single-file Vitest: `pnpm --filter @agent-poker/<pkg> exec vitest run src/__tests__/<file>.test.ts`
  - Watch one test by name: `pnpm --filter @agent-poker/<pkg> exec vitest run -t '<test name>'`
- **Workspace-wide green check** (run before each commit): `pnpm test && pnpm build`. Both must pass; absolutely no `any`, no `// @ts-ignore`, no `Math.random()` in werewolf-engine (that lives in another package, but if you happen to touch it, the reproducibility test will fail).
- **vitest does NOT typecheck.** A test can pass at runtime while `tsc -b` rejects it. Always run `pnpm --filter <pkg> run build` after writing or modifying a test before considering the task done.
- **TDD shape:** every task that adds behavior writes the failing test first, runs it to confirm failure, then implements. Commit after each green run.
- **Imports:** relative imports must use `.js` extension on `.ts` source (NodeNext). Cross-package imports use the `@agent-poker/<pkg>` workspace name.
- **Files use `kebab-case.ts`. Types use `PascalCase`. Functions/vars `camelCase`. Constants `SCREAMING_SNAKE_CASE`.**
- **Information-isolation invariant** (the whole point of this plan): public artifacts and public events must never leak (a) actor identity in night phases, (b) `WerewolfHistoryEntry` of types `'role-assigned'` or `'night-action'`, (c) the `inner` field on `'speak'`-typed history, (d) raw chain-of-thought beyond the bounded reasoning summary. Tests in this plan exist to enforce that.
- **No `Math.random()`** in `packages/werewolf-engine/**`. Other packages may use `crypto.randomUUID()`.

---

### Task 1: Add `phase` field to action-result replay events

The public-event filter (Task 2) needs the phase on every action-related event to decide whether to redact. Currently only `agent.action_requested` carries phase; `agent.action_received` / `agent.timeout` / `agent.invalid_action` don't. Add `phase: phaseBefore` to the three emit sites in `match-runner.ts` so all four are uniform.

**Files:**
- Modify: `packages/werewolf-orchestrator/src/match-runner.ts:190-249` (the three emit sites)
- Modify: `packages/werewolf-orchestrator/src/__tests__/match-runner.test.ts` (or whichever existing runner test asserts emitted events)

- [ ] **Step 1: Find existing runner-emit assertions**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec grep -rn "agent.action_received\|agent.timeout\|agent.invalid_action" src/__tests__`
Expected: at least one test that asserts the data shape of these events.

- [ ] **Step 2: Write the failing test**

Pick (or create, if no good fit exists) `packages/werewolf-orchestrator/src/__tests__/match-runner-phase-on-events.test.ts` and add:

```typescript
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '../replay-event.js';

describe('match-runner emits phase on every action event', () => {
  it('agent.action_received, agent.timeout, agent.invalid_action carry the same phase as agent.action_requested', async () => {
    const initial = createGame({ gameId: 'g-phase', seed: 'seed-phase' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const events: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    const requested = events.filter((e) => e.eventType === 'agent.action_requested');
    const received = events.filter((e) => e.eventType === 'agent.action_received');
    expect(requested.length).toBeGreaterThan(0);
    expect(received.length).toBe(requested.length);

    for (const e of [...requested, ...received]) {
      expect(typeof e.data['phase']).toBe('string');
    }
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner-phase-on-events.test.ts`
Expected: FAIL — `agent.action_received` events have `phase: undefined`.

- [ ] **Step 4: Add `phase: phaseBefore` to the three emit sites**

In `packages/werewolf-orchestrator/src/match-runner.ts`, modify the three emit calls. The `phaseBefore` local already exists at line 153. Update:

```typescript
// agent.timeout (around line 190-196):
this.emit('agent.timeout', {
  requestId: req.requestId,
  agentId: agent.agentId,
  playerId: player.id,
  phase: phaseBefore,
  elapsedMs,
  fallbackAction: sanitizeActionForBroadcast(action),
});

// agent.invalid_action (schema failure branch, around line 211-218):
this.emit('agent.invalid_action', {
  requestId: req.requestId,
  agentId: agent.agentId,
  playerId: player.id,
  phase: phaseBefore,
  schemaFailure: true,
  reason: invalidReason,
  fallbackAction: sanitizeActionForBroadcast(action),
});

// agent.invalid_action (validator failure branch, around line 228-235):
this.emit('agent.invalid_action', {
  requestId: req.requestId,
  agentId: agent.agentId,
  playerId: player.id,
  phase: phaseBefore,
  received: sanitizeActionForBroadcast(parsedAction),
  reason: invalidReason,
  fallbackAction: sanitizeActionForBroadcast(action),
});

// agent.action_received (around line 240-249):
this.emit('agent.action_received', {
  requestId: req.requestId,
  agentId: agent.agentId,
  playerId: player.id,
  phase: phaseBefore,
  action: sanitizeActionForBroadcast(action),
  usedFallback,
  timedOut,
  elapsedMs,
  ...(invalidReason !== null ? { invalidReason } : {}),
});
```

- [ ] **Step 5: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner-phase-on-events.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole orchestrator suite to make sure existing tests still pass**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run test`
Expected: all green. If any prior test snapshotted event-data keys, update it to include `phase`.

- [ ] **Step 7: Commit**

```bash
git add packages/werewolf-orchestrator/src/match-runner.ts \
        packages/werewolf-orchestrator/src/__tests__/match-runner-phase-on-events.test.ts
git commit -m "feat(werewolf-orchestrator): include phase on every action replay event

Plan 4a Task 1: agent.action_received / agent.timeout / agent.invalid_action
now carry the same phase field that agent.action_requested already had. Plan
4a Task 2's public-event filter relies on this field to decide whether to
redact actor identity in night phases."
```

---

### Task 2: Move types to shared + public replay-event filter (`werewolfReplayEventToPublic`)

Two related changes that ship together because the filter consumes the relocated type:
1. Move `WerewolfReplayEvent` + `WerewolfReplayEventType` from `werewolf-orchestrator` to `packages/shared`. Have `werewolf-orchestrator/src/replay-event.ts` re-export the same names from shared so internal consumers (`match-runner.ts`, etc.) keep compiling without edits.
2. Implement `werewolfReplayEventToPublic` in `packages/realtime` (next to poker's `replayEventToPublic`). The function name is prefixed because the two filters live in the same module namespace.

The filter is the *only* place that encodes "which phases are private." It strips `playerId` and `agentId` from `agent.action_*` events that fire in `night-werewolf-vote`, `night-witch`, or `night-seer`.

**Files:**
- Create: `packages/shared/src/werewolf-replay-event.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/werewolf-orchestrator/src/replay-event.ts` (becomes re-export)
- Create: `packages/realtime/src/werewolf-filter.ts`
- Modify: `packages/realtime/src/index.ts`
- Test: `packages/realtime/src/__tests__/werewolf-filter.test.ts`

- [ ] **Step 1: Move types to shared**

Create `packages/shared/src/werewolf-replay-event.ts`:

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

Add to `packages/shared/src/index.ts` (top-level export block):

```typescript
export type { WerewolfReplayEvent, WerewolfReplayEventType } from './werewolf-replay-event.js';
```

Replace `packages/werewolf-orchestrator/src/replay-event.ts` with:

```typescript
export type { WerewolfReplayEvent, WerewolfReplayEventType } from '@agent-poker/shared';
```

- [ ] **Step 2: Verify the move did not break anything**

Run: `pnpm --filter @agent-poker/shared run build && pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: green. The orchestrator's existing imports from `./replay-event.js` keep working because the names are re-exported.

- [ ] **Step 3: Add realtime workspace dep wiring**

The `packages/realtime` package already depends on `@agent-poker/shared` (see existing `tsconfig.json` references). No new dep needed here — realtime can import the new type directly.

- [ ] **Step 4: Write the failing filter test**

```typescript
// packages/realtime/src/__tests__/werewolf-filter.test.ts
import { describe, expect, it } from 'vitest';
import { werewolfReplayEventToPublic } from '../werewolf-filter.js';
import type { WerewolfReplayEvent } from '@agent-poker/shared';

const baseEvent = {
  eventId: 'evt-1',
  gameId: 'g-1',
  sequence: 0,
  timestamp: 1_000,
};

describe('replayEventToPublic — werewolf', () => {
  it('passes match.started through unchanged', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.started',
      data: {
        gameId: 'g-1',
        seed: 'seed-1',
        players: [{ id: 'p1', seatIndex: 0, name: 'Alice' }],
      },
    };
    expect(werewolfReplayEventToPublic(e)).toEqual(e);
  });

  it('passes match.completed through unchanged', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'match.completed',
      data: { gameId: 'g-1', winner: 'good', durationMs: 12, stepCount: 7 },
    };
    expect(werewolfReplayEventToPublic(e)).toEqual(e);
  });

  it('passes phase.changed through unchanged', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'phase.changed',
      data: { from: 'night-werewolf-vote', to: 'night-witch' },
    };
    expect(werewolfReplayEventToPublic(e)).toEqual(e);
  });

  it('strips playerId from agent.action_requested in private night phases', () => {
    for (const phase of ['night-werewolf-vote', 'night-witch', 'night-seer']) {
      const e: WerewolfReplayEvent = {
        ...baseEvent,
        eventType: 'agent.action_requested',
        data: {
          requestId: 'req-1',
          agentId: 'agent-x',
          playerId: 'p3',
          phase,
          validActionCount: 1,
        },
      };
      const out = werewolfReplayEventToPublic(e);
      expect(out).not.toBeNull();
      expect(out!.data['playerId']).toBeUndefined();
      expect(out!.data['agentId']).toBeUndefined();
      expect(out!.data['phase']).toBe(phase); // phase stays — it doesn't reveal *which* player
      expect(out!.data['requestId']).toBe('req-1');
    }
  });

  it('keeps playerId on agent.action_requested in public phases', () => {
    for (const phase of ['day-speeches', 'day-vote', 'hunter-shoot']) {
      const e: WerewolfReplayEvent = {
        ...baseEvent,
        eventType: 'agent.action_requested',
        data: { requestId: 'r', agentId: 'a', playerId: 'p3', phase, validActionCount: 1 },
      };
      const out = werewolfReplayEventToPublic(e)!;
      expect(out.data['playerId']).toBe('p3');
    }
  });

  it('strips actor identity from agent.action_received in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.action_received',
      data: {
        requestId: 'r',
        agentId: 'a',
        playerId: 'p2',
        phase: 'night-werewolf-vote',
        action: { type: 'werewolf-vote' },
        usedFallback: false,
        timedOut: false,
        elapsedMs: 100,
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
    expect(out.data['action']).toEqual({ type: 'werewolf-vote' });
  });

  it('strips actor identity from agent.timeout in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.timeout',
      data: {
        requestId: 'r', agentId: 'a', playerId: 'p2',
        phase: 'night-witch', elapsedMs: 5000,
        fallbackAction: { type: 'witch-skip-save' },
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
  });

  it('strips actor identity from agent.invalid_action in private phases', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'agent.invalid_action',
      data: {
        requestId: 'r', agentId: 'a', playerId: 'p2',
        phase: 'night-seer', reason: 'bad target',
        fallbackAction: { type: 'seer-divine' },
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    expect(out.data['playerId']).toBeUndefined();
    expect(out.data['agentId']).toBeUndefined();
    expect(out.data['reason']).toBe('bad target');
  });

  it('strips inner from speak action even if it slipped past sanitize-action', () => {
    // Defense in depth — sanitize-action.ts already drops `inner`, but if a
    // future event ever embeds a raw action, this filter catches it.
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'engine.action_applied',
      data: {
        phase: 'day-speeches',
        action: { type: 'speak', playerId: 'p1', inner: 'SECRET', performance: 'X', speech: 'Y' },
        newPhase: 'day-speeches',
      },
    };
    const out = werewolfReplayEventToPublic(e)!;
    const action = out.data['action'] as Record<string, unknown>;
    expect(action['inner']).toBeUndefined();
    expect(action['performance']).toBe('X');
  });

  it('returns the same reference when nothing needs redacting (cheap pass-through)', () => {
    const e: WerewolfReplayEvent = {
      ...baseEvent,
      eventType: 'phase.changed',
      data: { from: 'day-vote', to: 'day-resolve' },
    };
    expect(werewolfReplayEventToPublic(e)).toBe(e);
  });
});
```

- [ ] **Step 5: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/realtime exec vitest run src/__tests__/werewolf-filter.test.ts`
Expected: FAIL — `werewolf-filter` module not found.

- [ ] **Step 6: Implement the filter**

```typescript
// packages/realtime/src/werewolf-filter.ts
import type { WerewolfPhase, WerewolfReplayEvent } from '@agent-poker/shared';

const PRIVATE_PHASES: ReadonlySet<WerewolfPhase> = new Set([
  'night-werewolf-vote',
  'night-witch',
  'night-seer',
]);

const ACTOR_FIELDS_TO_STRIP = ['playerId', 'agentId'] as const;

// Public broadcast filter for WerewolfReplayEvent. Strips actor-identifying
// fields (playerId, agentId) from agent.action_* events that fire in private
// night phases. Returns the original reference when nothing needs redacting
// so consumers can compare by reference if they want.
//
// Returns null only as a future hook — currently every event is broadcastable
// in some form, so the implementation never returns null. The signature stays
// nullable so behavior can tighten later without breaking callers.
export function werewolfReplayEventToPublic(
  event: WerewolfReplayEvent,
): WerewolfReplayEvent | null {
  let next = event;
  if (isAgentActionEvent(event.eventType)) {
    const phase = event.data['phase'];
    if (typeof phase === 'string' && PRIVATE_PHASES.has(phase as WerewolfPhase)) {
      next = stripActorFields(next);
    }
  }
  // Defense in depth: even on engine.action_applied (which is public), make
  // sure we never broadcast `inner` from a speak action.
  if (containsSpeakInner(next.data)) {
    next = { ...next, data: stripSpeakInner(next.data) as Record<string, unknown> };
  }
  return next;
}

function isAgentActionEvent(eventType: string): boolean {
  return (
    eventType === 'agent.action_requested' ||
    eventType === 'agent.action_received' ||
    eventType === 'agent.timeout' ||
    eventType === 'agent.invalid_action'
  );
}

function stripActorFields(event: WerewolfReplayEvent): WerewolfReplayEvent {
  const next: Record<string, unknown> = { ...event.data };
  for (const field of ACTOR_FIELDS_TO_STRIP) {
    delete next[field];
  }
  return { ...event, data: next };
}

function containsSpeakInner(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSpeakInner);
  const obj = value as Record<string, unknown>;
  if (obj['type'] === 'speak' && Object.prototype.hasOwnProperty.call(obj, 'inner')) {
    return true;
  }
  for (const v of Object.values(obj)) {
    if (containsSpeakInner(v)) return true;
  }
  return false;
}

function stripSpeakInner(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripSpeakInner);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (obj['type'] === 'speak' && k === 'inner') continue;
    out[k] = stripSpeakInner(v);
  }
  return out;
}
```

- [ ] **Step 7: Run the test, expect PASS**

Run: `pnpm --filter @agent-poker/realtime exec vitest run src/__tests__/werewolf-filter.test.ts`
Expected: PASS.

- [ ] **Step 8: Export from realtime package index**

Edit `packages/realtime/src/index.ts` to add:

```typescript
export * from './werewolf-filter.js';
```

- [ ] **Step 9: Run lint + full realtime + orchestrator + shared suites**

Run: `pnpm --filter @agent-poker/shared run test && pnpm --filter @agent-poker/realtime run test && pnpm --filter @agent-poker/realtime run build && pnpm --filter @agent-poker/werewolf-orchestrator run test`
Expected: green. (The orchestrator's existing replay-event consumers continue to work because the orchestrator's `replay-event.ts` re-exports from shared.)

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/werewolf-replay-event.ts \
        packages/shared/src/index.ts \
        packages/werewolf-orchestrator/src/replay-event.ts \
        packages/realtime/src/werewolf-filter.ts \
        packages/realtime/src/__tests__/werewolf-filter.test.ts \
        packages/realtime/src/index.ts
git commit -m "feat(realtime,shared): werewolf public replay-event filter

Plan 4a Task 2: relocates WerewolfReplayEvent + WerewolfReplayEventType to
@agent-poker/shared so realtime + persistence can consume them without
depending on werewolf-orchestrator. Adds werewolfReplayEventToPublic in
realtime — strips playerId+agentId from agent.action_* events emitted in
private night phases (night-werewolf-vote / night-witch / night-seer).
Pure function; default path returns the same reference."
```

---

### Task 3: `WerewolfDecisionTrace` types in shared

Mirror poker's `DecisionTrace` shape (`packages/shared/src/types.ts:181-200`) but with werewolf-appropriate fields: phase is the full `WerewolfPhase` union, action is `WerewolfAction`, no `amount` field. Lives in shared so both orchestrator and persistence can import it without one taking a dep on the other.

**Files:**
- Create: `packages/shared/src/werewolf-decision-trace.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/werewolf-decision-trace-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/__tests__/werewolf-decision-trace-shape.test.ts
import { describe, expect, it } from 'vitest';
import type {
  WerewolfDecisionTrace,
  WerewolfDecisionTraceFallbackReason,
} from '../werewolf-decision-trace.js';

describe('WerewolfDecisionTrace', () => {
  it('compiles a complete sample trace', () => {
    const trace: WerewolfDecisionTrace = {
      traceId: 't-1',
      matchId: 'g-1',
      sequence: 5,
      requestId: 'r-1',
      agentId: 'agent-1',
      playerId: 'p1',
      phase: 'night-werewolf-vote',
      nightNumber: 1,
      dayNumber: 0,
      publicStateHash: 'sha256-pub',
      privateStateHash: 'sha256-priv',
      validActionTypes: ['werewolf-vote'],
      responseAction: { type: 'werewolf-vote' },
      appliedAction: { type: 'werewolf-vote' },
      latencyMs: 42,
      timedOut: false,
      invalidReason: null,
      fallbackReason: null,
      reasoningSummary: {
        intent: 'eliminate seer',
        confidence: 0.7,
        keyObservations: ['p3 acted suspiciously'],
      },
      createdAt: 1_700_000_000_000,
    };
    expect(trace.phase).toBe('night-werewolf-vote');
  });

  it('fallbackReason union covers timeout/invalid_action/missing_agent', () => {
    const reasons: WerewolfDecisionTraceFallbackReason[] = [
      'timeout',
      'invalid_action',
      'missing_agent',
    ];
    expect(reasons).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/shared exec vitest run src/__tests__/werewolf-decision-trace-shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types**

```typescript
// packages/shared/src/werewolf-decision-trace.ts
import type { WerewolfAction, WerewolfPhase, WerewolfPlayerId } from './werewolf-types.js';

export type WerewolfDecisionTraceFallbackReason =
  | 'timeout'
  | 'invalid_action'
  | 'missing_agent';

// Action-payload shape stored on a trace. We strip the `inner` field from
// 'speak' actions before persisting (defense in depth — the runner already
// drops it via sanitize-action, but the trace path is independent).
export type WerewolfDecisionTraceAction =
  | { readonly type: 'werewolf-vote' }
  | { readonly type: 'witch-save'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-save' }
  | { readonly type: 'witch-poison'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-poison' }
  | { readonly type: 'seer-divine'; readonly targetId: WerewolfPlayerId }
  | {
      readonly type: 'speak';
      readonly playerId: WerewolfPlayerId;
      readonly performance: string;
      readonly speech: string;
    }
  | {
      readonly type: 'day-vote';
      readonly voterId: WerewolfPlayerId;
      readonly targetId: WerewolfPlayerId | null;
    }
  | {
      readonly type: 'hunter-shoot';
      readonly targetId: WerewolfPlayerId | null;
    };

export interface WerewolfReasoningSummary {
  readonly intent: string;
  readonly confidence: number;
  readonly keyObservations: ReadonlyArray<string>;
}

export interface WerewolfDecisionTrace {
  readonly traceId: string;
  readonly matchId: string;
  // Monotonically increasing per match. Mirrors poker's reliance on
  // (handId, createdAt) ordering — werewolf has no handId, so a per-match
  // sequence number is the canonical ordering key.
  readonly sequence: number;
  readonly requestId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicStateHash: string;
  readonly privateStateHash: string;
  // Distilled valid-action list — full action payloads can carry IDs that
  // are private to the requesting agent (e.g. werewolf vote targets), so
  // we store only the action-type set. If a future analyzer needs more
  // detail, extend this with a payload-redacted shape.
  readonly validActionTypes: ReadonlyArray<WerewolfAction['type']>;
  readonly responseAction: WerewolfDecisionTraceAction | null;
  readonly appliedAction: WerewolfDecisionTraceAction;
  readonly latencyMs: number;
  readonly timedOut: boolean;
  readonly invalidReason: string | null;
  readonly fallbackReason: WerewolfDecisionTraceFallbackReason | null;
  readonly reasoningSummary: WerewolfReasoningSummary | null;
  readonly createdAt: number;
}
```

- [ ] **Step 4: Re-export from shared/index.ts**

Edit `packages/shared/src/index.ts` to add (at the bottom):

```typescript
export type {
  WerewolfDecisionTrace,
  WerewolfDecisionTraceAction,
  WerewolfDecisionTraceFallbackReason,
  WerewolfReasoningSummary,
} from './werewolf-decision-trace.js';
```

- [ ] **Step 5: Run test, expect PASS**

Run: `pnpm --filter @agent-poker/shared exec vitest run src/__tests__/werewolf-decision-trace-shape.test.ts`
Expected: PASS.

- [ ] **Step 6: Workspace build to ensure no downstream breakage**

Run: `pnpm build`
Expected: green. (`packages/shared` is depended on by everything; this verifies the new types compile cleanly.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/werewolf-decision-trace.ts \
        packages/shared/src/index.ts \
        packages/shared/src/__tests__/werewolf-decision-trace-shape.test.ts
git commit -m "feat(shared): WerewolfDecisionTrace types

Plan 4a Task 3: introduces a werewolf-specific decision-trace shape with
WerewolfPhase + WerewolfAction-typed payloads, distinct from poker's
DecisionTrace which is hard-coded to preflop/flop/turn/river phases."
```

---

### Task 4: `IWerewolfDecisionTraceStore` (Memory + Object) with byte/count caps

Mirror `packages/persistence/src/decision-trace-store.ts:16-118`. Same default caps (8KB / trace, 512KB / match, 1000 traces / match — these are reasonable for werewolf since reasoning summaries are short). Throw `ArtifactLimitExceededError` (the existing class in `@agent-poker/shared`) when caps are exceeded.

**Files:**
- Create: `packages/persistence/src/werewolf-decision-trace-serialization.ts`
- Create: `packages/persistence/src/werewolf-decision-trace-store.ts`
- Test: `packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts
import { describe, expect, it } from 'vitest';
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import type { WerewolfDecisionTrace } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
import {
  MemoryWerewolfDecisionTraceStore,
  ObjectWerewolfDecisionTraceStore,
} from '../werewolf-decision-trace-store.js';

const sample = (overrides: Partial<WerewolfDecisionTrace> = {}): WerewolfDecisionTrace => ({
  traceId: 't',
  matchId: 'g-1',
  sequence: 0,
  requestId: 'r',
  agentId: 'a',
  playerId: 'p1',
  phase: 'day-vote',
  nightNumber: 0,
  dayNumber: 1,
  publicStateHash: 'sha-pub',
  privateStateHash: 'sha-priv',
  validActionTypes: ['day-vote'],
  responseAction: null,
  appliedAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
  latencyMs: 10,
  timedOut: false,
  invalidReason: null,
  fallbackReason: null,
  reasoningSummary: null,
  createdAt: 1_000,
  ...overrides,
});

describe('MemoryWerewolfDecisionTraceStore', () => {
  it('appends and lists traces in insertion order', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    await store.appendDecisionTrace(sample({ traceId: 't1', sequence: 0 }));
    await store.appendDecisionTrace(sample({ traceId: 't2', sequence: 1 }));
    const list = await store.listDecisionTraces('g-1');
    expect(list.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });

  it('rejects oversized single trace', async () => {
    const store = new MemoryWerewolfDecisionTraceStore({ maxTraceBytes: 200 });
    const huge = sample({
      reasoningSummary: { intent: 'x'.repeat(1000), confidence: 0.5, keyObservations: [] },
    });
    await expect(store.appendDecisionTrace(huge)).rejects.toThrow(ArtifactLimitExceededError);
  });

  it('rejects exceeding per-match trace count', async () => {
    const store = new MemoryWerewolfDecisionTraceStore({ maxTracesPerMatch: 2 });
    await store.appendDecisionTrace(sample({ traceId: 't1' }));
    await store.appendDecisionTrace(sample({ traceId: 't2' }));
    await expect(store.appendDecisionTrace(sample({ traceId: 't3' }))).rejects.toThrow(
      ArtifactLimitExceededError,
    );
  });

  it('cleans matchId to safe path segment', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    await expect(
      store.appendDecisionTrace(sample({ matchId: '../../etc/passwd' })),
    ).rejects.toThrow(/Invalid matchId path segment/);
  });

  it('publicifies the trace on read (no internal mutation leaks)', async () => {
    const store = new MemoryWerewolfDecisionTraceStore();
    const trace = sample({ traceId: 't-mut' });
    await store.appendDecisionTrace(trace);
    const list1 = await store.listDecisionTraces('g-1');
    list1[0]!.validActionTypes; // read
    // Mutating returned data should not affect store contents.
    (list1 as unknown as WerewolfDecisionTrace[])[0] = { ...list1[0]!, traceId: 'OVERRIDDEN' };
    const list2 = await store.listDecisionTraces('g-1');
    expect(list2[0]!.traceId).toBe('t-mut');
  });
});

describe('ObjectWerewolfDecisionTraceStore (over MemoryObjectStore)', () => {
  it('appends and lists traces, persisting through the object store', async () => {
    const objStore = new MemoryObjectStore();
    const store = new ObjectWerewolfDecisionTraceStore(objStore);
    await store.appendDecisionTrace(sample({ traceId: 't1' }));
    await store.appendDecisionTrace(sample({ traceId: 't2' }));
    expect(await objStore.exists('matches/g-1/decision-trace.jsonl')).toBe(true);
    const list = await store.listDecisionTraces('g-1');
    expect(list.map((t) => t.traceId)).toEqual(['t1', 't2']);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-decision-trace-store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement serialization**

```typescript
// packages/persistence/src/werewolf-decision-trace-serialization.ts
import type { WerewolfDecisionTrace } from '@agent-poker/shared';

export function serializeWerewolfDecisionTraces(traces: WerewolfDecisionTrace[]): string {
  return (
    traces.map((t) => JSON.stringify(toPublicWerewolfDecisionTrace(t))).join('\n') +
    (traces.length > 0 ? '\n' : '')
  );
}

export function parseWerewolfDecisionTraces(raw: string): WerewolfDecisionTrace[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => toPublicWerewolfDecisionTrace(JSON.parse(line) as WerewolfDecisionTrace));
}

// Public projection — the trace is already public-safe in this design (no
// holeCard equivalent), so this currently round-trips. It exists as a single
// place to evolve the public contract (e.g. drop reasoningSummary entirely,
// trim observation lengths) without touching every store impl.
export function toPublicWerewolfDecisionTrace(
  trace: WerewolfDecisionTrace,
): WerewolfDecisionTrace {
  return {
    traceId: trace.traceId,
    matchId: trace.matchId,
    sequence: trace.sequence,
    requestId: trace.requestId,
    agentId: trace.agentId,
    playerId: trace.playerId,
    phase: trace.phase,
    nightNumber: trace.nightNumber,
    dayNumber: trace.dayNumber,
    publicStateHash: trace.publicStateHash,
    privateStateHash: trace.privateStateHash,
    validActionTypes: [...trace.validActionTypes],
    responseAction: trace.responseAction,
    appliedAction: trace.appliedAction,
    latencyMs: trace.latencyMs,
    timedOut: trace.timedOut,
    invalidReason: trace.invalidReason,
    fallbackReason: trace.fallbackReason,
    reasoningSummary: trace.reasoningSummary
      ? {
          intent: trace.reasoningSummary.intent,
          confidence: trace.reasoningSummary.confidence,
          keyObservations: [...trace.reasoningSummary.keyObservations],
        }
      : null,
    createdAt: trace.createdAt,
  };
}
```

- [ ] **Step 4: Implement store**

```typescript
// packages/persistence/src/werewolf-decision-trace-store.ts
import { ArtifactLimitExceededError, type WerewolfDecisionTrace } from '@agent-poker/shared';
import {
  parseWerewolfDecisionTraces,
  serializeWerewolfDecisionTraces,
  toPublicWerewolfDecisionTrace,
} from './werewolf-decision-trace-serialization.js';
import { safePathSegment } from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';

export interface WerewolfDecisionTraceStoreLimits {
  maxTraceBytes: number;
  maxMatchTraceBytes: number;
  maxTracesPerMatch: number;
}

export interface IWerewolfDecisionTraceStore {
  appendDecisionTrace(trace: WerewolfDecisionTrace): Promise<WerewolfDecisionTrace>;
  listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]>;
}

export const DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS: WerewolfDecisionTraceStoreLimits = {
  maxTraceBytes: 8 * 1024,
  maxMatchTraceBytes: 512 * 1024,
  maxTracesPerMatch: 1000,
};

export class MemoryWerewolfDecisionTraceStore implements IWerewolfDecisionTraceStore {
  private readonly traces = new Map<string, WerewolfDecisionTrace[]>();
  private readonly limits: WerewolfDecisionTraceStoreLimits;

  constructor(limits: Partial<WerewolfDecisionTraceStoreLimits> = {}) {
    this.limits = { ...DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(
    trace: WerewolfDecisionTrace,
  ): Promise<WerewolfDecisionTrace> {
    const publicTrace = toPublicWerewolfDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = this.traces.get(matchId) ?? [];
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);
    this.traces.set(matchId, next.map(cloneTrace));
    return cloneTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]> {
    return (this.traces.get(safePathSegment(matchId)) ?? []).map(cloneTrace);
  }
}

export class ObjectWerewolfDecisionTraceStore implements IWerewolfDecisionTraceStore {
  private readonly limits: WerewolfDecisionTraceStoreLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<WerewolfDecisionTraceStoreLimits> = {},
  ) {
    this.limits = { ...DEFAULT_WEREWOLF_DECISION_TRACE_STORE_LIMITS, ...limits };
  }

  async appendDecisionTrace(
    trace: WerewolfDecisionTrace,
  ): Promise<WerewolfDecisionTrace> {
    const publicTrace = toPublicWerewolfDecisionTrace(trace);
    const matchId = safePathSegment(publicTrace.matchId);
    const existing = await this.listDecisionTraces(matchId);
    const next = [...existing, publicTrace];
    assertWithinLimits(publicTrace, next, this.limits);

    await this.objectStore.putText({
      key: traceObjectKey(matchId),
      body: serializeWerewolfDecisionTraces(next),
      contentType: 'application/x-ndjson',
    });
    return cloneTrace(publicTrace);
  }

  async listDecisionTraces(matchId: string): Promise<WerewolfDecisionTrace[]> {
    const safe = safePathSegment(matchId);
    const raw = await this.objectStore.getText(traceObjectKey(safe));
    if (!raw) return [];
    return parseWerewolfDecisionTraces(raw);
  }
}

function assertWithinLimits(
  trace: WerewolfDecisionTrace,
  traces: WerewolfDecisionTrace[],
  limits: WerewolfDecisionTraceStoreLimits,
): void {
  const traceBytes = Buffer.byteLength(`${JSON.stringify(trace)}\n`, 'utf-8');
  if (traceBytes > limits.maxTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace is ${traceBytes} bytes; limit is ${limits.maxTraceBytes}`,
    );
  }
  if (traces.length > limits.maxTracesPerMatch) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace count is ${traces.length}; limit is ${limits.maxTracesPerMatch}`,
    );
  }
  const matchBytes = Buffer.byteLength(serializeWerewolfDecisionTraces(traces), 'utf-8');
  if (matchBytes > limits.maxMatchTraceBytes) {
    throw new ArtifactLimitExceededError(
      `Werewolf decision trace artifact is ${matchBytes} bytes; limit is ${limits.maxMatchTraceBytes}`,
    );
  }
}

function traceObjectKey(matchId: string): string {
  return `matches/${safePathSegment(matchId)}/decision-trace.jsonl`;
}

function cloneTrace(trace: WerewolfDecisionTrace): WerewolfDecisionTrace {
  return JSON.parse(JSON.stringify(toPublicWerewolfDecisionTrace(trace))) as WerewolfDecisionTrace;
}
```

- [ ] **Step 5: Re-export from package index**

Edit `packages/persistence/src/index.ts` to add:

```typescript
export * from './werewolf-decision-trace-serialization.js';
export * from './werewolf-decision-trace-store.js';
```

- [ ] **Step 6: Run test, expect PASS**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-decision-trace-store.test.ts && pnpm --filter @agent-poker/persistence run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/persistence/src/werewolf-decision-trace-serialization.ts \
        packages/persistence/src/werewolf-decision-trace-store.ts \
        packages/persistence/src/__tests__/werewolf-decision-trace-store.test.ts \
        packages/persistence/src/index.ts
git commit -m "feat(persistence): IWerewolfDecisionTraceStore (Memory + Object)

Plan 4a Task 4: mirrors poker's IDecisionTraceStore for WerewolfDecisionTrace.
Same default caps (8KB/trace, 512KB/match, 1000 traces/match). Object impl
writes \`matches/<id>/decision-trace.jsonl\`."
```

---

### Task 5: `WerewolfMatchArtifact` types + serialization

Mirror poker's `match-artifact-serialization.ts`. The artifact contains:

- `manifest`: artifact version, gameId, createdAt, file refs (sha256 + bytes for each blob).
- `summary`: a `WerewolfMatchPublicSummary` — like `WerewolfMatchSummary` but with `history: WerewolfPublicHistoryEntry[]` instead of full history (no role-assigned, no night-action, speech-record `inner` stripped).
- `replayEvents`: events that have been passed through `replayEventToPublic` and the speak-inner stripper. Stored as JSONL.
- `decisionTraces`: `WerewolfDecisionTrace[]`, ordered by `sequence`. Stored as JSONL.

**Files:**
- Create: `packages/persistence/src/werewolf-match-artifact-types.ts`
- Create: `packages/persistence/src/werewolf-match-artifact-serialization.ts`
- Test: `packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts
import { describe, expect, it } from 'vitest';
import type { WerewolfDecisionTrace, WerewolfHistoryEntry } from '@agent-poker/shared';
import { buildWerewolfArtifact } from '../werewolf-match-artifact-serialization.js';

describe('buildWerewolfArtifact', () => {
  const baseInput = () => ({
    matchId: 'g-1',
    seed: 'seed-1',
    startedAt: 1_000,
    completedAt: 2_000,
    nightCount: 1,
    dayCount: 1,
    stepCount: 12,
    replayEventCount: 30,
    winner: 'good' as const,
    finalPlayers: [
      { id: 'p1', seatIndex: 0, name: 'A', role: 'villager' as const, side: 'good' as const, alive: true },
    ],
    fullHistory: [
      { type: 'role-assigned', playerId: 'p1', role: 'villager' },
      { type: 'night-action', night: 1, record: {
        werewolfTarget: 'p1', witchSaved: null, witchPoisoned: null, seerTarget: null, seerResult: null,
      } },
      { type: 'death', day: 1, playerId: 'p2', cause: 'wolf-kill' },
      { type: 'speech', day: 1, record: { playerId: 'p1', inner: 'SECRET', performance: 'X', speech: 'Y' } },
      { type: 'game-over', winner: 'good' },
    ] as WerewolfHistoryEntry[],
    replayEvents: [
      {
        eventId: 'e1', gameId: 'g-1', sequence: 0,
        eventType: 'agent.action_received', timestamp: 100,
        data: {
          requestId: 'r', agentId: 'a', playerId: 'p1',
          phase: 'night-werewolf-vote', // private
          action: { type: 'werewolf-vote' },
          usedFallback: false, timedOut: false, elapsedMs: 10,
        },
      },
      {
        eventId: 'e2', gameId: 'g-1', sequence: 1,
        eventType: 'engine.action_applied', timestamp: 110,
        data: {
          phase: 'day-speeches',
          action: { type: 'speak', playerId: 'p1', inner: 'SECRET', performance: 'X', speech: 'Y' },
          newPhase: 'day-speeches',
        },
      },
    ],
    decisionTraces: [] as WerewolfDecisionTrace[],
  });

  it('produces a manifest with sha256 + bytes for every blob', () => {
    const { record, summaryRaw, replayRaw, decisionTraceRaw } = buildWerewolfArtifact(
      baseInput(),
      1_500,
    );
    expect(record.manifest.matchId).toBe('g-1');
    expect(record.manifest.createdAt).toBe(1_500);
    expect(record.manifest.files.summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.manifest.files.summary.bytes).toBeGreaterThan(0);
    expect(record.manifest.files.replay.bytes).toBeGreaterThan(0);
    expect(summaryRaw).toContain('"matchId": "g-1"');
    expect(replayRaw.split('\n').filter((l) => l.length > 0).length).toBe(2);
    expect(decisionTraceRaw).toBe('');
  });

  it('public summary strips role-assigned + night-action + speak.inner from history', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const types = record.summary.history.map((h) => h.type);
    expect(types).toEqual(['death', 'speech', 'game-over']);
    const speech = record.summary.history.find((h) => h.type === 'speech');
    expect(speech).toBeDefined();
    // speech record has no `inner`
    expect((speech as { record: Record<string, unknown> }).record.inner).toBeUndefined();
  });

  it('public replay events strip actor identity in private phases', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const e0 = record.replayEvents.find((e) => e.eventId === 'e1')!;
    expect(e0.data['playerId']).toBeUndefined();
    expect(e0.data['agentId']).toBeUndefined();
  });

  it('public replay events strip speak.inner', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const e1 = record.replayEvents.find((e) => e.eventId === 'e2')!;
    const action = e1.data['action'] as Record<string, unknown>;
    expect(action['inner']).toBeUndefined();
    expect(action['performance']).toBe('X');
  });

  it('rejects matchId with path separators', () => {
    const input = { ...baseInput(), matchId: 'a/b' };
    expect(() => buildWerewolfArtifact(input, 1_500)).toThrow(/Invalid matchId path segment/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-match-artifact-serialization.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types**

```typescript
// packages/persistence/src/werewolf-match-artifact-types.ts
import type {
  WerewolfDecisionTrace,
  WerewolfPublicHistoryEntry,
  WerewolfRole,
  WerewolfSide,
} from '@agent-poker/shared';
// WerewolfReplayEvent lives in shared (Task 2 relocated it there) so the
// persistence layer can use the canonical type without depending on
// werewolf-orchestrator.
import type { WerewolfReplayEvent } from '@agent-poker/shared';

export type { WerewolfReplayEvent };

export interface WerewolfMatchArtifactFileRef {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
}

export interface WerewolfMatchArtifactManifest {
  readonly artifactVersion: 1;
  readonly matchId: string;
  readonly createdAt: number;
  readonly files: {
    readonly summary: WerewolfMatchArtifactFileRef;
    readonly replay: WerewolfMatchArtifactFileRef;
    readonly decisionTrace: WerewolfMatchArtifactFileRef;
  };
}

// Player snapshot in the public summary. At game-over all roles are revealed
// (deaths reveal their role, alive winners reveal theirs at the reveal step),
// so finalPlayers carrying role+side at end-of-game does not leak game-time
// secrets. If a Plan-4 reviewer disagrees, swap to a redacted variant.
export interface WerewolfMatchFinalPlayerPublic {
  readonly id: string;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WerewolfMatchPublicSummary {
  readonly matchId: string;
  // Note: seed deliberately omitted; the public artifact must not let
  // spectators replay private RNG draws. (Mirrors poker omitting `seed`
  // from PublicMatchSummary in apps/api/src/routes/matches.ts.)
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly stepCount: number;
  readonly replayEventCount: number;
  readonly finalPlayers: ReadonlyArray<WerewolfMatchFinalPlayerPublic>;
  readonly history: ReadonlyArray<WerewolfPublicHistoryEntry>;
}

export interface WerewolfMatchArtifactRecord {
  readonly manifest: WerewolfMatchArtifactManifest;
  readonly summary: WerewolfMatchPublicSummary;
  readonly replayEvents: ReadonlyArray<WerewolfReplayEvent>;
  readonly decisionTraces: ReadonlyArray<WerewolfDecisionTrace>;
}

export interface WerewolfMatchArtifactIndexEntry {
  readonly matchId: string;
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly createdAt: number;
  readonly artifactPath: string;
}
```

- [ ] **Step 4: Implement serialization**

```typescript
// packages/persistence/src/werewolf-match-artifact-serialization.ts
import type {
  WerewolfDecisionTrace,
  WerewolfHistoryEntry,
  WerewolfPublicHistoryEntry,
  WerewolfSide,
} from '@agent-poker/shared';
import {
  fileRef,
  safePathSegment,
  serializeJson,
} from './match-artifact-serialization.js';
import type {
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
  WerewolfMatchArtifactRecord,
  WerewolfMatchFinalPlayerPublic,
  WerewolfMatchPublicSummary,
  WerewolfReplayEvent,
} from './werewolf-match-artifact-types.js';
import {
  serializeWerewolfDecisionTraces,
  toPublicWerewolfDecisionTrace,
} from './werewolf-decision-trace-serialization.js';
import { werewolfReplayEventToPublic } from '@agent-poker/realtime';

export interface BuildWerewolfArtifactInput {
  readonly matchId: string;
  readonly seed: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly stepCount: number;
  readonly replayEventCount: number;
  readonly winner: WerewolfSide;
  readonly finalPlayers: ReadonlyArray<WerewolfMatchFinalPlayerPublic>;
  readonly fullHistory: ReadonlyArray<WerewolfHistoryEntry>;
  readonly replayEvents: ReadonlyArray<WerewolfReplayEvent>;
  readonly decisionTraces: ReadonlyArray<WerewolfDecisionTrace>;
}

export interface SerializedWerewolfArtifact {
  readonly record: WerewolfMatchArtifactRecord;
  readonly summaryRaw: string;
  readonly replayRaw: string;
  readonly decisionTraceRaw: string;
  readonly manifestRaw: string;
}

export function buildWerewolfArtifact(
  input: BuildWerewolfArtifactInput,
  createdAt = Date.now(),
): SerializedWerewolfArtifact {
  safePathSegment(input.matchId);

  const publicHistory = toPublicWerewolfHistory(input.fullHistory);
  const summary: WerewolfMatchPublicSummary = {
    matchId: input.matchId,
    winner: input.winner,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    nightCount: input.nightCount,
    dayCount: input.dayCount,
    stepCount: input.stepCount,
    replayEventCount: input.replayEventCount,
    finalPlayers: input.finalPlayers,
    history: publicHistory,
  };

  const replayEvents = toPublicWerewolfReplayEvents(input.replayEvents);
  const decisionTraces = input.decisionTraces.map(toPublicWerewolfDecisionTrace);

  const summaryRaw = serializeJson(summary);
  const replayRaw = serializeWerewolfReplayEvents(replayEvents);
  const decisionTraceRaw = serializeWerewolfDecisionTraces(decisionTraces);

  const manifest: WerewolfMatchArtifactManifest = {
    artifactVersion: 1,
    matchId: input.matchId,
    createdAt,
    files: {
      summary: fileRef('summary.json', summaryRaw, 'application/json'),
      replay: fileRef('replay.jsonl', replayRaw, 'application/x-ndjson'),
      decisionTrace: fileRef('decision-trace.jsonl', decisionTraceRaw, 'application/x-ndjson'),
    },
  };

  return {
    record: { manifest, summary, replayEvents, decisionTraces },
    summaryRaw,
    replayRaw,
    decisionTraceRaw,
    manifestRaw: serializeJson(manifest),
  };
}

export function serializeWerewolfReplayEvents(
  events: ReadonlyArray<WerewolfReplayEvent>,
): string {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  return sorted.map((e) => JSON.stringify(e)).join('\n') + (sorted.length > 0 ? '\n' : '');
}

export function toPublicWerewolfReplayEvents(
  events: ReadonlyArray<WerewolfReplayEvent>,
): WerewolfMatchArtifactRecord['replayEvents'] {
  return events
    .map((e) => werewolfReplayEventToPublic(e))
    .filter((e): e is WerewolfReplayEvent => e !== null);
}

export function toPublicWerewolfHistory(
  history: ReadonlyArray<WerewolfHistoryEntry>,
): WerewolfPublicHistoryEntry[] {
  const out: WerewolfPublicHistoryEntry[] = [];
  for (const entry of history) {
    switch (entry.type) {
      case 'role-assigned':
      case 'night-action':
        continue;
      case 'speech': {
        const { inner: _omit, ...rest } = entry.record;
        out.push({ type: 'speech', day: entry.day, record: rest });
        break;
      }
      case 'death':
      case 'vote':
      case 'hunter-shoot':
      case 'game-over':
        out.push(entry);
        break;
    }
  }
  return out;
}

export function toWerewolfArtifactIndexEntry(
  record: WerewolfMatchArtifactRecord,
): WerewolfMatchArtifactIndexEntry {
  return {
    matchId: record.manifest.matchId,
    winner: record.summary.winner,
    startedAt: record.summary.startedAt,
    completedAt: record.summary.completedAt,
    createdAt: record.manifest.createdAt,
    artifactPath: `matches/${record.manifest.matchId}/manifest.json`,
  };
}
```

> **Note on the cross-package import:** `werewolf-match-artifact-serialization.ts` imports `werewolfReplayEventToPublic` from `@agent-poker/realtime`. That makes `@agent-poker/persistence` depend on `@agent-poker/realtime`. **Add the workspace dep** in `packages/persistence/package.json` under `"dependencies"` exactly as the existing `@agent-poker/shared` entry does:
> ```json
> "@agent-poker/realtime": "workspace:*"
> ```
> Then run `pnpm install` from the worktree root.

- [ ] **Step 5: Add the workspace dep + tsconfig reference + install**

Edit `packages/persistence/package.json` to add `"@agent-poker/realtime": "workspace:*"` to `dependencies`.

Edit `packages/persistence/tsconfig.json` to add `{ "path": "../realtime" }` to the `references` array and `"@agent-poker/realtime": ["../realtime/src/index.ts"]` to `compilerOptions.paths`.

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 6: Re-export from package index**

Edit `packages/persistence/src/index.ts` to add:

```typescript
export * from './werewolf-match-artifact-types.js';
export * from './werewolf-match-artifact-serialization.js';
```

- [ ] **Step 7: Run tests, expect PASS**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-match-artifact-serialization.test.ts && pnpm --filter @agent-poker/persistence run build && pnpm --filter @agent-poker/persistence run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/persistence/package.json \
        packages/persistence/src/werewolf-match-artifact-types.ts \
        packages/persistence/src/werewolf-match-artifact-serialization.ts \
        packages/persistence/src/__tests__/werewolf-match-artifact-serialization.test.ts \
        packages/persistence/src/index.ts \
        pnpm-lock.yaml
git commit -m "feat(persistence): WerewolfMatchArtifact types + serialization

Plan 4a Task 5: buildWerewolfArtifact projects fullHistory through
toPublicWerewolfHistory (drops role-assigned + night-action, strips
speak.inner) and replayEvents through werewolfReplayEventToPublic before
sealing the artifact. Manifest carries sha256+bytes for every blob.
Persistence gains a workspace dep on @agent-poker/realtime for the filter."
```

---

### Task 6: `IWerewolfMatchArtifactStore` (Memory + Object) with cost limits

Mirror `MemoryMatchArtifactStore` and `ObjectMatchArtifactStore`. Same cost-limit pattern (replay byte cap, summary byte cap, decision-trace byte cap, max index entries).

**Files:**
- Create: `packages/persistence/src/werewolf-match-artifact-store.ts`
- Test: `packages/persistence/src/__tests__/werewolf-match-artifact-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/persistence/src/__tests__/werewolf-match-artifact-store.test.ts
import { describe, expect, it } from 'vitest';
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
import {
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '../werewolf-match-artifact-store.js';
import type { BuildWerewolfArtifactInput } from '../werewolf-match-artifact-serialization.js';

const baseInput = (overrides: Partial<BuildWerewolfArtifactInput> = {}): BuildWerewolfArtifactInput => ({
  matchId: 'g-1',
  seed: 'seed-1',
  startedAt: 1_000,
  completedAt: 2_000,
  nightCount: 1,
  dayCount: 1,
  stepCount: 5,
  replayEventCount: 10,
  winner: 'good',
  finalPlayers: [
    { id: 'p1', seatIndex: 0, name: 'A', role: 'villager', side: 'good', alive: true },
  ],
  fullHistory: [{ type: 'game-over', winner: 'good' }],
  replayEvents: [],
  decisionTraces: [],
  ...overrides,
});

describe('MemoryWerewolfMatchArtifactStore', () => {
  it('save+get round trip', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    const rec = await store.saveMatchArtifact(baseInput());
    expect(rec.manifest.matchId).toBe('g-1');
    const loaded = await store.getMatchArtifact('g-1');
    expect(loaded?.summary.winner).toBe('good');
  });

  it('returns null for unknown match', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    expect(await store.getMatchArtifact('does-not-exist')).toBeNull();
  });

  it('list returns most-recently-created first', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(baseInput({ matchId: 'g-a' }));
    await store.saveMatchArtifact(baseInput({ matchId: 'g-b' }));
    const list = await store.listMatchArtifacts();
    expect(list[0]?.matchId).toBe('g-b');
  });

  it('options.includeReplayEvents=false returns empty replay array', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(
      baseInput({
        replayEvents: [{
          eventId: 'e', gameId: 'g-1', sequence: 0,
          eventType: 'phase.changed', timestamp: 1, data: { from: 'setup', to: 'night-werewolf-vote' },
        }],
      }),
    );
    const rec = await store.getMatchArtifact('g-1', { includeReplayEvents: false });
    expect(rec?.replayEvents).toEqual([]);
  });

  it('options.includeDecisionTraces=false returns empty traces array', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(baseInput());
    const rec = await store.getMatchArtifact('g-1', { includeDecisionTraces: false });
    expect(rec?.decisionTraces).toEqual([]);
  });

  it('rejects path-traversal matchId', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await expect(store.saveMatchArtifact(baseInput({ matchId: '../boom' }))).rejects.toThrow(
      /Invalid matchId path segment/,
    );
  });
});

describe('ObjectWerewolfMatchArtifactStore (over MemoryObjectStore)', () => {
  it('round trip via object store', async () => {
    const obj = new MemoryObjectStore();
    const store = new ObjectWerewolfMatchArtifactStore(obj);
    await store.saveMatchArtifact(baseInput());
    expect(await obj.exists('matches/g-1/manifest.json')).toBe(true);
    expect(await obj.exists('matches/g-1/summary.json')).toBe(true);
    expect(await obj.exists('matches/g-1/replay.jsonl')).toBe(true);
    expect(await obj.exists('matches/g-1/decision-trace.jsonl')).toBe(true);
    const loaded = await store.getMatchArtifact('g-1');
    expect(loaded?.summary.matchId).toBe('g-1');
  });

  it('rejects oversized replay payload', async () => {
    const obj = new MemoryObjectStore();
    const store = new ObjectWerewolfMatchArtifactStore(obj, { maxReplayBytes: 100 });
    const huge = baseInput({
      replayEvents: Array.from({ length: 50 }, (_, i) => ({
        eventId: `e${i}`, gameId: 'g-1', sequence: i,
        eventType: 'phase.changed', timestamp: i,
        data: { from: 'a-very-very-very-long-phase-name', to: 'another-extremely-long-phase' },
      })),
    });
    await expect(store.saveMatchArtifact(huge)).rejects.toThrow(ArtifactLimitExceededError);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-match-artifact-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```typescript
// packages/persistence/src/werewolf-match-artifact-store.ts
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import { safePathSegment } from './match-artifact-serialization.js';
import type { IObjectStore } from './object-store.js';
import {
  buildWerewolfArtifact,
  type BuildWerewolfArtifactInput,
  toWerewolfArtifactIndexEntry,
} from './werewolf-match-artifact-serialization.js';
import type {
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
  WerewolfMatchArtifactRecord,
  WerewolfMatchPublicSummary,
} from './werewolf-match-artifact-types.js';
import { parseWerewolfDecisionTraces } from './werewolf-decision-trace-serialization.js';

export interface GetWerewolfMatchArtifactOptions {
  includeReplayEvents?: boolean;
  includeDecisionTraces?: boolean;
}

export interface IWerewolfMatchArtifactStore {
  saveMatchArtifact(input: BuildWerewolfArtifactInput): Promise<WerewolfMatchArtifactRecord>;
  getMatchArtifact(
    matchId: string,
    options?: GetWerewolfMatchArtifactOptions,
  ): Promise<WerewolfMatchArtifactRecord | null>;
  listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]>;
  deleteMatchArtifact?(matchId: string): Promise<void>;
}

export interface WerewolfMatchArtifactCostLimits {
  maxReplayBytes: number;
  maxSummaryBytes: number;
  maxDecisionTraceBytes: number;
  maxIndexEntries: number;
}

export const DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS: WerewolfMatchArtifactCostLimits = {
  maxReplayBytes: 1024 * 1024,
  maxSummaryBytes: 256 * 1024,
  maxDecisionTraceBytes: 512 * 1024,
  maxIndexEntries: 100,
};

interface SequencedRecord {
  record: WerewolfMatchArtifactRecord;
  sequence: number;
}

export class MemoryWerewolfMatchArtifactStore implements IWerewolfMatchArtifactStore {
  private readonly records = new Map<string, SequencedRecord>();
  private nextSequence = 0;

  async saveMatchArtifact(
    input: BuildWerewolfArtifactInput,
  ): Promise<WerewolfMatchArtifactRecord> {
    const { record } = buildWerewolfArtifact(input);
    this.nextSequence += 1;
    this.records.set(record.manifest.matchId, { record, sequence: this.nextSequence });
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetWerewolfMatchArtifactOptions = {},
  ): Promise<WerewolfMatchArtifactRecord | null> {
    safePathSegment(matchId);
    const found = this.records.get(matchId);
    if (!found) return null;
    let next: WerewolfMatchArtifactRecord = found.record;
    if (options.includeReplayEvents === false) {
      next = { ...next, replayEvents: [] };
    }
    if (options.includeDecisionTraces === false) {
      next = { ...next, decisionTraces: [] };
    }
    return next;
  }

  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    return [...this.records.values()]
      .sort((a, b) => {
        const delta = b.record.manifest.createdAt - a.record.manifest.createdAt;
        if (delta !== 0) return delta;
        return b.sequence - a.sequence;
      })
      .map(({ record }) => toWerewolfArtifactIndexEntry(record));
  }

  async deleteMatchArtifact(matchId: string): Promise<void> {
    safePathSegment(matchId);
    this.records.delete(matchId);
  }
}

export class ObjectWerewolfMatchArtifactStore implements IWerewolfMatchArtifactStore {
  private readonly limits: WerewolfMatchArtifactCostLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<WerewolfMatchArtifactCostLimits> = {},
  ) {
    this.limits = { ...DEFAULT_WEREWOLF_MATCH_ARTIFACT_COST_LIMITS, ...limits };
  }

  async saveMatchArtifact(
    input: BuildWerewolfArtifactInput,
  ): Promise<WerewolfMatchArtifactRecord> {
    const { record, summaryRaw, replayRaw, decisionTraceRaw, manifestRaw } =
      buildWerewolfArtifact(input);
    this.assertWithinLimits(summaryRaw, replayRaw, decisionTraceRaw);
    const prefix = `matches/${record.manifest.matchId}`;
    await this.objectStore.putText({ key: `${prefix}/summary.json`, body: summaryRaw, contentType: 'application/json' });
    await this.objectStore.putText({ key: `${prefix}/replay.jsonl`, body: replayRaw, contentType: 'application/x-ndjson' });
    await this.objectStore.putText({ key: `${prefix}/decision-trace.jsonl`, body: decisionTraceRaw, contentType: 'application/x-ndjson' });
    await this.objectStore.putText({ key: `${prefix}/manifest.json`, body: manifestRaw, contentType: 'application/json' });
    await this.upsertIndex(toWerewolfArtifactIndexEntry(record));
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetWerewolfMatchArtifactOptions = {},
  ): Promise<WerewolfMatchArtifactRecord | null> {
    const safe = safePathSegment(matchId);
    const prefix = `matches/${safe}`;
    const manifestRaw = await this.objectStore.getText(`${prefix}/manifest.json`);
    const summaryRaw = await this.objectStore.getText(`${prefix}/summary.json`);
    if (!manifestRaw || !summaryRaw) return null;
    const manifest = JSON.parse(manifestRaw) as WerewolfMatchArtifactManifest;
    const summary = JSON.parse(summaryRaw) as WerewolfMatchPublicSummary;

    let replayEvents: WerewolfMatchArtifactRecord['replayEvents'] = [];
    if (options.includeReplayEvents !== false) {
      const replayRaw = await this.objectStore.getText(`${prefix}/replay.jsonl`);
      if (replayRaw === null) return null;
      replayEvents = replayRaw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as WerewolfMatchArtifactRecord['replayEvents'][number]);
    }

    let decisionTraces: WerewolfMatchArtifactRecord['decisionTraces'] = [];
    if (options.includeDecisionTraces !== false) {
      const traceRaw = await this.objectStore.getText(`${prefix}/decision-trace.jsonl`);
      if (traceRaw === null) return null;
      decisionTraces = parseWerewolfDecisionTraces(traceRaw);
    }

    return { manifest, summary, replayEvents, decisionTraces };
  }

  async listMatchArtifacts(): Promise<WerewolfMatchArtifactIndexEntry[]> {
    const raw = await this.objectStore.getText('matches/index.json');
    if (!raw) return [];
    const entries = JSON.parse(raw) as WerewolfMatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteMatchArtifact(matchId: string): Promise<void> {
    const safe = safePathSegment(matchId);
    const prefix = `matches/${safe}`;
    if (this.objectStore.delete) {
      await this.objectStore.delete(`${prefix}/summary.json`);
      await this.objectStore.delete(`${prefix}/replay.jsonl`);
      await this.objectStore.delete(`${prefix}/decision-trace.jsonl`);
      await this.objectStore.delete(`${prefix}/manifest.json`);
    }
    const entries = await this.listMatchArtifacts();
    const next = entries.filter((e) => e.matchId !== safe);
    await this.objectStore.putText({
      key: 'matches/index.json',
      body: `${JSON.stringify(next, null, 2)}\n`,
      contentType: 'application/json',
    });
  }

  private assertWithinLimits(summaryRaw: string, replayRaw: string, decisionTraceRaw: string): void {
    const sBytes = Buffer.byteLength(summaryRaw, 'utf-8');
    const rBytes = Buffer.byteLength(replayRaw, 'utf-8');
    const dBytes = Buffer.byteLength(decisionTraceRaw, 'utf-8');
    if (sBytes > this.limits.maxSummaryBytes) {
      throw new ArtifactLimitExceededError(`Werewolf summary is ${sBytes} bytes; limit is ${this.limits.maxSummaryBytes}`);
    }
    if (rBytes > this.limits.maxReplayBytes) {
      throw new ArtifactLimitExceededError(`Werewolf replay is ${rBytes} bytes; limit is ${this.limits.maxReplayBytes}`);
    }
    if (dBytes > this.limits.maxDecisionTraceBytes) {
      throw new ArtifactLimitExceededError(`Werewolf decision trace is ${dBytes} bytes; limit is ${this.limits.maxDecisionTraceBytes}`);
    }
  }

  private async upsertIndex(entry: WerewolfMatchArtifactIndexEntry): Promise<void> {
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter((existing) => existing.matchId !== entry.matchId),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, this.limits.maxIndexEntries);
    await this.objectStore.putText({
      key: 'matches/index.json',
      body: `${JSON.stringify(next, null, 2)}\n`,
      contentType: 'application/json',
    });
  }
}
```

- [ ] **Step 4: Re-export from package index**

Edit `packages/persistence/src/index.ts` to add:

```typescript
export * from './werewolf-match-artifact-store.js';
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm --filter @agent-poker/persistence exec vitest run src/__tests__/werewolf-match-artifact-store.test.ts && pnpm --filter @agent-poker/persistence run build && pnpm --filter @agent-poker/persistence run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/src/werewolf-match-artifact-store.ts \
        packages/persistence/src/__tests__/werewolf-match-artifact-store.test.ts \
        packages/persistence/src/index.ts
git commit -m "feat(persistence): IWerewolfMatchArtifactStore (Memory + Object)

Plan 4a Task 6: mirrors poker's IMatchArtifactStore with werewolf-specific
record shape and cost limits (1MB replay, 256KB summary, 512KB decision
trace, 100 index entries). deleteMatchArtifact removes both blobs and the
index entry."
```

---

### Task 7: Wire orchestrator to accept stores + persist on completion

Add optional `IWerewolfMatchArtifactStore` and `IWerewolfDecisionTraceStore` constructor params to `WerewolfOrchestrator`. When `runMatch` completes successfully, build and save the artifact (using the captured replay event stream + final state + accumulated decision traces). Existing constructor call sites must continue to work without args (backwards-compatible default = `null`).

The orchestrator now has to *capture* the runner's replay events to feed into the artifact builder. Add an internal subscriber that buffers events into the `MatchEntry`.

**Files:**
- Modify: `packages/werewolf-orchestrator/src/orchestrator.ts`
- Test: `packages/werewolf-orchestrator/src/__tests__/orchestrator-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/werewolf-orchestrator/src/__tests__/orchestrator-persistence.test.ts
import { describe, expect, it } from 'vitest';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';

describe('WerewolfOrchestrator persistence', () => {
  it('saves the match artifact when run completes', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });

    const { matchId, initialState } = orch.createMatch({ gameId: 'g-persist', seed: 's-persist' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);

    const list = await artifactStore.listMatchArtifacts();
    expect(list.map((e) => e.matchId)).toContain('g-persist');
    const rec = await artifactStore.getMatchArtifact('g-persist');
    expect(rec).not.toBeNull();
    expect(rec!.summary.matchId).toBe('g-persist');
    expect(rec!.summary.history.find((h) => h.type === 'game-over')).toBeDefined();
    // history projection MUST NOT include role-assigned / night-action types
    for (const h of rec!.summary.history) {
      expect(h.type).not.toBe('role-assigned');
      expect(h.type).not.toBe('night-action');
    }
    expect(rec!.replayEvents.length).toBeGreaterThan(0);
  });

  it('does nothing when no artifact store is configured', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-no-store', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await expect(orch.runMatch(matchId)).resolves.toBeDefined();
  });

  it('artifact public replay events have actor identity stripped in night phases', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-redact', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);
    const rec = (await artifactStore.getMatchArtifact('g-redact'))!;
    const nightActionEvents = rec.replayEvents.filter((e) =>
      typeof e.data['phase'] === 'string' &&
      ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.data['phase'] as string) &&
      (e.eventType === 'agent.action_requested' || e.eventType === 'agent.action_received'),
    );
    expect(nightActionEvents.length).toBeGreaterThan(0);
    for (const e of nightActionEvents) {
      expect(e.data['playerId']).toBeUndefined();
      expect(e.data['agentId']).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator-persistence.test.ts`
Expected: FAIL — orchestrator constructor takes no args yet.

- [ ] **Step 3: Add the workspace dep + tsconfig reference**

Edit `packages/werewolf-orchestrator/package.json` `dependencies` to add:

```json
"@agent-poker/persistence": "workspace:*"
```

Edit `packages/werewolf-orchestrator/tsconfig.json` to add `{ "path": "../persistence" }` to the `references` array and `"@agent-poker/persistence": ["../persistence/src/index.ts"]` to `compilerOptions.paths`.

(The dep is one-directional: persistence → realtime → shared, and werewolf-orchestrator → persistence (type-only) + shared + agent-runtime + agent-protocol + werewolf-engine. The full graph is a DAG; tsc composite refs accept it.)

Run: `pnpm install`

- [ ] **Step 4: Modify orchestrator.ts**

Replace the contents of `packages/werewolf-orchestrator/src/orchestrator.ts` with the version below. Key changes:
1. Constructor accepts `WerewolfOrchestratorOptions` with optional `artifactStore` and `decisionTraceStore`.
2. Each `MatchEntry` now buffers replay events into an array.
3. `runMatch` saves the artifact on success.

```typescript
import { EventEmitter } from 'events';
import type {
  WerewolfGameState,
  WerewolfPlayerId,
} from '@agent-poker/shared';
import type {
  IWerewolfMatchArtifactStore,
  IWerewolfDecisionTraceStore,
  BuildWerewolfArtifactInput,
} from '@agent-poker/persistence';
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

export interface WerewolfOrchestratorOptions {
  readonly artifactStore?: IWerewolfMatchArtifactStore;
  readonly decisionTraceStore?: IWerewolfDecisionTraceStore;
}

type MatchStatus = 'preparing' | 'running' | 'completed' | 'failed';

interface MatchEntry {
  readonly initialState: WerewolfGameState;
  readonly agents: Map<WerewolfPlayerId, WerewolfAgent>;
  readonly emitter: EventEmitter;
  readonly defaultTimeoutMs: number;
  readonly bufferedEvents: WerewolfReplayEvent[];
  status: MatchStatus;
  summary: WerewolfMatchSummary | null;
  finalState: WerewolfGameState | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class WerewolfOrchestrator {
  private readonly matches = new Map<string, MatchEntry>();
  private readonly artifactStore: IWerewolfMatchArtifactStore | null;
  private readonly decisionTraceStore: IWerewolfDecisionTraceStore | null;

  constructor(options: WerewolfOrchestratorOptions = {}) {
    this.artifactStore = options.artifactStore ?? null;
    this.decisionTraceStore = options.decisionTraceStore ?? null;
  }

  createMatch(
    config: WerewolfMatchConfig,
  ): { matchId: string; initialState: WerewolfGameState } {
    if (this.matches.has(config.gameId)) {
      throw new Error(`WerewolfOrchestrator: match ${config.gameId} already exists`);
    }
    const initialState = createGame({ gameId: config.gameId, seed: config.seed });
    const emitter = new EventEmitter();
    const bufferedEvents: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => bufferedEvents.push(e));
    const entry: MatchEntry = {
      initialState,
      agents: new Map(),
      emitter,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      bufferedEvents,
      status: 'preparing',
      summary: null,
      finalState: null,
    };
    this.matches.set(config.gameId, entry);
    return { matchId: config.gameId, initialState };
  }

  registerAgent(
    matchId: string,
    playerId: WerewolfPlayerId,
    agent: WerewolfAgent,
  ): void {
    const entry = this.requireEntry(matchId);
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
    const entry = this.requireEntry(matchId);
    entry.emitter.on('replay-event', listener);
    return () => entry.emitter.off('replay-event', listener);
  }

  async runMatch(
    matchId: string,
    options: WerewolfMatchRunnerOptions = {},
  ): Promise<WerewolfMatchSummary> {
    const entry = this.requireEntry(matchId);
    if (entry.status === 'running') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is already running`);
    }
    if (entry.status === 'completed') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} already completed`);
    }
    if (entry.status === 'failed') {
      throw new Error(
        `WerewolfOrchestrator: match ${matchId} failed previously and cannot be re-run`,
      );
    }
    entry.status = 'running';
    try {
      const runner = new WerewolfMatchRunner(
        entry.initialState,
        entry.agents,
        entry.defaultTimeoutMs,
        entry.emitter,
        {
          ...options,
          ...(this.decisionTraceStore ? { decisionTraceStore: this.decisionTraceStore } : {}),
        },
      );
      const summary = await runner.run();
      entry.summary = summary;
      entry.finalState = runner.getFinalState();
      entry.status = 'completed';
      if (this.artifactStore) {
        await this.persistArtifact(matchId, entry, summary);
      }
      return summary;
    } catch (err) {
      entry.status = 'failed';
      throw err;
    }
  }

  getMatchSummary(matchId: string): WerewolfMatchSummary | null {
    return this.matches.get(matchId)?.summary ?? null;
  }

  // Lifecycle: explicitly remove a match from in-memory state. Does NOT
  // delete persisted artifacts (callers can do that by calling the store's
  // deleteMatchArtifact directly). Idempotent.
  deleteMatch(matchId: string): boolean {
    return this.matches.delete(matchId);
  }

  private requireEntry(matchId: string): MatchEntry {
    const entry = this.matches.get(matchId);
    if (!entry) throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    return entry;
  }

  private async persistArtifact(
    matchId: string,
    entry: MatchEntry,
    summary: WerewolfMatchSummary,
  ): Promise<void> {
    if (!this.artifactStore || !entry.finalState) return;
    const decisionTraces = this.decisionTraceStore
      ? await this.decisionTraceStore.listDecisionTraces(matchId)
      : [];
    const input: BuildWerewolfArtifactInput = {
      matchId,
      seed: summary.seed,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      nightCount: summary.nightCount,
      dayCount: summary.dayCount,
      stepCount: summary.stepCount,
      replayEventCount: summary.replayEventCount,
      winner: summary.winner,
      finalPlayers: summary.finalPlayers,
      fullHistory: entry.finalState.history,
      replayEvents: entry.bufferedEvents,
      decisionTraces,
    };
    await this.artifactStore.saveMatchArtifact(input);
  }
}
```

> **Note:** the new `runner.getFinalState()` accessor is a tiny addition you'll make in Task 8 (it's not on the runner yet). For Task 7, exposing it now is the simplest path: add a `getFinalState(): WerewolfGameState` method to `WerewolfMatchRunner` that returns `this.state`. Do that as part of Task 7's implementation step (one extra file edit — see Step 5).

- [ ] **Step 5: Add `getFinalState` to match-runner**

Edit `packages/werewolf-orchestrator/src/match-runner.ts` and add (above the `private emit` method around line 264):

```typescript
getFinalState(): WerewolfGameState {
  return this.state;
}
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator-persistence.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the rest of the orchestrator suite (no regressions)**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build && pnpm --filter @agent-poker/werewolf-orchestrator run test`
Expected: green. The constructor change is non-breaking (default options).

- [ ] **Step 8: Commit**

```bash
git add packages/werewolf-orchestrator/package.json \
        packages/werewolf-orchestrator/src/orchestrator.ts \
        packages/werewolf-orchestrator/src/match-runner.ts \
        packages/werewolf-orchestrator/src/__tests__/orchestrator-persistence.test.ts \
        pnpm-lock.yaml
git commit -m "feat(werewolf-orchestrator): persist artifact on match completion

Plan 4a Task 7: WerewolfOrchestrator now accepts optional artifact +
decision-trace stores. On match success it captures the buffered replay
events + finalState.history and saves a public-projected artifact.
Backwards-compatible default (no opts) preserves existing behavior."
```

---

### Task 8: Wire match-runner to record decision traces

When `decisionTraceStore` is passed in `WerewolfMatchRunnerOptions`, append a `WerewolfDecisionTrace` for every agent action (request → response → applied), capturing latency, fallback reason, and (capped) reasoning summary.

The runner already has the data it needs: `req`, `parsed.data` (the response if the schema parses), the timeout flag, the validation result, and `phaseBefore`. Add a single helper that builds + writes a trace, then call it at the end of `runOneAction`.

**Reasoning-summary cap:** truncate `intent` to ≤200 chars, ≤10 keyObservations of ≤200 chars each. (Same caps as the Zod schema in `agent-protocol`.)

**Files:**
- Modify: `packages/werewolf-orchestrator/src/match-runner.ts`
- Create: `packages/werewolf-orchestrator/src/decision-trace-recorder.ts`
- Test: `packages/werewolf-orchestrator/src/__tests__/decision-trace-recording.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/werewolf-orchestrator/src/__tests__/decision-trace-recording.test.ts
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { MemoryWerewolfDecisionTraceStore } from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';

describe('WerewolfMatchRunner decision-trace recording', () => {
  it('writes one trace per agent action', async () => {
    const initial = createGame({ gameId: 'g-trace', seed: 'seed-trace' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, new EventEmitter(), {
      decisionTraceStore: traceStore,
    });
    const summary = await runner.run();
    const traces = await traceStore.listDecisionTraces('g-trace');

    expect(traces.length).toBeGreaterThan(0);
    expect(traces.length).toBe(summary.stepCount);
    // sequence numbers strictly monotonic
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i]!.sequence).toBe(traces[i - 1]!.sequence + 1);
    }
    // every trace has an applied action
    for (const t of traces) {
      expect(t.appliedAction).toBeDefined();
    }
  });

  it('truncates oversized intent and observations', async () => {
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    // We test the recorder directly to isolate the cap logic.
    const { recordWerewolfDecisionTrace } = await import('../decision-trace-recorder.js');
    await recordWerewolfDecisionTrace({
      store: traceStore,
      matchId: 'g-cap',
      sequence: 0,
      requestId: 'r',
      agentId: 'a',
      playerId: 'p1',
      phase: 'day-vote',
      nightNumber: 0,
      dayNumber: 1,
      publicState: { gameId: 'g', phase: 'day-vote', nightNumber: 0, dayNumber: 1, players: [], history: [], winner: null },
      privateState: { selfId: 'p1', selfRole: 'villager', selfSide: 'good', knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false },
      validActions: [{ type: 'day-vote', voterId: 'p1', targetId: 'p2' }],
      responseAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      appliedAction: { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      latencyMs: 5,
      timedOut: false,
      invalidReason: null,
      fallbackReason: null,
      reasoningSummary: {
        intent: 'X'.repeat(500),
        confidence: 0.7,
        keyObservations: Array.from({ length: 30 }, (_, i) => 'O'.repeat(500) + i),
      },
      now: 1_000,
    });
    const traces = await traceStore.listDecisionTraces('g-cap');
    expect(traces).toHaveLength(1);
    const t = traces[0]!;
    expect(t.reasoningSummary!.intent.length).toBeLessThanOrEqual(200);
    expect(t.reasoningSummary!.keyObservations.length).toBeLessThanOrEqual(10);
    for (const obs of t.reasoningSummary!.keyObservations) {
      expect(obs.length).toBeLessThanOrEqual(200);
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/decision-trace-recording.test.ts`
Expected: FAIL — `decision-trace-recorder` not found and `decisionTraceStore` not in options.

- [ ] **Step 3: Implement the recorder**

```typescript
// packages/werewolf-orchestrator/src/decision-trace-recorder.ts
import { createHash, randomUUID } from 'crypto';
import type {
  WerewolfAction,
  WerewolfDecisionTrace,
  WerewolfDecisionTraceAction,
  WerewolfDecisionTraceFallbackReason,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfPrivateState,
  WerewolfPublicState,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import type { IWerewolfDecisionTraceStore } from '@agent-poker/persistence';

const INTENT_MAX = 200;
const OBSERVATION_MAX = 200;
const OBSERVATIONS_MAX = 10;

export interface RecordWerewolfDecisionTraceInput {
  readonly store: IWerewolfDecisionTraceStore;
  readonly matchId: string;
  readonly sequence: number;
  readonly requestId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly responseAction: WerewolfAction | null;
  readonly appliedAction: WerewolfAction;
  readonly latencyMs: number;
  readonly timedOut: boolean;
  readonly invalidReason: string | null;
  readonly fallbackReason: WerewolfDecisionTraceFallbackReason | null;
  readonly reasoningSummary?: WerewolfReasoningSummary;
  readonly now: number;
}

export async function recordWerewolfDecisionTrace(
  input: RecordWerewolfDecisionTraceInput,
): Promise<WerewolfDecisionTrace> {
  const trace: WerewolfDecisionTrace = {
    traceId: randomUUID(),
    matchId: input.matchId,
    sequence: input.sequence,
    requestId: input.requestId,
    agentId: input.agentId,
    playerId: input.playerId,
    phase: input.phase,
    nightNumber: input.nightNumber,
    dayNumber: input.dayNumber,
    publicStateHash: hashState(input.publicState),
    privateStateHash: hashState(input.privateState),
    validActionTypes: input.validActions.map((a) => a.type),
    responseAction: input.responseAction ? toTraceAction(input.responseAction) : null,
    appliedAction: toTraceAction(input.appliedAction),
    latencyMs: input.latencyMs,
    timedOut: input.timedOut,
    invalidReason: input.invalidReason,
    fallbackReason: input.fallbackReason,
    reasoningSummary: input.reasoningSummary ? capReasoning(input.reasoningSummary) : null,
    createdAt: input.now,
  };
  return input.store.appendDecisionTrace(trace);
}

function toTraceAction(action: WerewolfAction): WerewolfDecisionTraceAction {
  // Drop `inner` from speak — defense in depth even though sanitize-action
  // already strips it before broadcast.
  switch (action.type) {
    case 'speak':
      return {
        type: 'speak',
        playerId: action.playerId,
        performance: action.performance,
        speech: action.speech,
      };
    case 'werewolf-vote':
      return { type: 'werewolf-vote' };
    case 'witch-save':
    case 'witch-poison':
    case 'seer-divine':
      return { type: action.type, targetId: action.targetId };
    case 'witch-skip-save':
    case 'witch-skip-poison':
      return { type: action.type };
    case 'day-vote':
      return { type: 'day-vote', voterId: action.voterId, targetId: action.targetId };
    case 'hunter-shoot':
      return { type: 'hunter-shoot', targetId: action.targetId };
  }
}

function capReasoning(r: WerewolfReasoningSummary): WerewolfReasoningSummary {
  return {
    intent: r.intent.slice(0, INTENT_MAX),
    confidence: r.confidence,
    keyObservations: r.keyObservations
      .slice(0, OBSERVATIONS_MAX)
      .map((s) => s.slice(0, OBSERVATION_MAX)),
  };
}

function hashState(state: unknown): string {
  return `sha256-${createHash('sha256').update(JSON.stringify(state)).digest('hex')}`;
}
```

- [ ] **Step 4: Wire the recorder into `match-runner.ts`**

Edit `packages/werewolf-orchestrator/src/match-runner.ts`:

1. Add a new option to `WerewolfMatchRunnerOptions`:

```typescript
export interface WerewolfMatchRunnerOptions {
  readonly maxSteps?: number;
  readonly decisionTraceStore?: import('@agent-poker/persistence').IWerewolfDecisionTraceStore;
}
```

2. Capture the option in the constructor:

```typescript
private readonly decisionTraceStore: import('@agent-poker/persistence').IWerewolfDecisionTraceStore | null;

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
  this.decisionTraceStore = options.decisionTraceStore ?? null;
}
```

3. At the end of `runOneAction`, after `engine.action_applied` emits, append:

```typescript
if (this.decisionTraceStore) {
  await recordWerewolfDecisionTrace({
    store: this.decisionTraceStore,
    matchId: this.state.gameId,
    sequence: this.stepCount,
    requestId: req.requestId,
    agentId: agent.agentId,
    playerId: player.id,
    phase: phaseBefore,
    nightNumber: this.state.nightNumber,
    dayNumber: this.state.dayNumber,
    publicState: getPublicState(this.state),
    privateState: getPrivateState(this.state, player.id),
    validActions,
    responseAction: timedOut || invalidReason !== null
      ? null
      : (parsedActionForTrace ?? null),
    appliedAction: action,
    latencyMs: elapsedMs,
    timedOut,
    invalidReason,
    fallbackReason: timedOut
      ? 'timeout'
      : invalidReason !== null
        ? 'invalid_action'
        : null,
    ...(parsedReasoningForTrace ? { reasoningSummary: parsedReasoningForTrace } : {}),
    now: Date.now(),
  });
}
```

   For `parsedActionForTrace` and `parsedReasoningForTrace`, capture them in the existing `if (parsed.success) { ... }` branch:

```typescript
let parsedActionForTrace: WerewolfAction | null = null;
let parsedReasoningForTrace: WerewolfReasoningSummary | undefined;
// ...
const parsed = WerewolfDecisionResponseSchema.safeParse(response);
if (!parsed.success) {
  // existing branch
} else {
  parsedActionForTrace = parsed.data.action as WerewolfAction;
  if (parsed.data.reasoningSummary) {
    parsedReasoningForTrace = parsed.data.reasoningSummary;
  }
  // existing branch
}
```

   Add the import at the top of `match-runner.ts`:

```typescript
import { recordWerewolfDecisionTrace } from './decision-trace-recorder.js';
import type { WerewolfReasoningSummary } from '@agent-poker/shared';
```

- [ ] **Step 5: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/decision-trace-recording.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the orchestrator-persistence test from Task 7 and the full suite**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run test && pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: green. (The Task 7 test should now also see decision traces in the artifact when both stores are wired.)

- [ ] **Step 7: Commit**

```bash
git add packages/werewolf-orchestrator/src/decision-trace-recorder.ts \
        packages/werewolf-orchestrator/src/match-runner.ts \
        packages/werewolf-orchestrator/src/__tests__/decision-trace-recording.test.ts
git commit -m "feat(werewolf-orchestrator): record decision traces

Plan 4a Task 8: each agent action now writes a WerewolfDecisionTrace via
the configured store. Reasoning summary is capped to 200-char intent and
≤10 observations of ≤200 chars each. Fallback reason is set to 'timeout'
or 'invalid_action' when the runner falls back."
```

---

### Task 9: `deleteMatch` lifecycle method (smoke test)

The `deleteMatch` method already landed in Task 7 (orchestrator.ts). This task adds a focused test to nail down semantics: the method removes the in-memory entry, is idempotent, returns `true`/`false` consistently, and does NOT touch the persisted artifact (callers can do that separately via the artifact store).

**Files:**
- Test: `packages/werewolf-orchestrator/src/__tests__/orchestrator-delete-match.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from 'vitest';
import { MemoryWerewolfMatchArtifactStore } from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';

describe('WerewolfOrchestrator.deleteMatch', () => {
  it('removes a preparing match', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'g-x', seed: 's' });
    expect(orch.deleteMatch('g-x')).toBe(true);
    expect(orch.deleteMatch('g-x')).toBe(false); // idempotent
    expect(orch.getMatchSummary('g-x')).toBeNull();
  });

  it('removes a completed match without removing its persisted artifact', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-keep', seed: 's' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(matchId);
    expect(orch.deleteMatch(matchId)).toBe(true);
    expect(orch.getMatchSummary(matchId)).toBeNull();
    // Artifact survives — caller can still read it.
    expect(await artifactStore.getMatchArtifact(matchId)).not.toBeNull();
  });

  it('throws on subscribe to a deleted match', () => {
    const orch = new WerewolfOrchestrator();
    orch.createMatch({ gameId: 'g-y', seed: 's' });
    orch.deleteMatch('g-y');
    expect(() => orch.subscribe('g-y', () => {})).toThrow(/unknown match/);
  });
});
```

- [ ] **Step 2: Run test, expect PASS** (the implementation already landed in Task 7)

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator-delete-match.test.ts`
Expected: PASS. If it fails, the Task 7 implementation diverged — fix it there.

- [ ] **Step 3: Commit**

```bash
git add packages/werewolf-orchestrator/src/__tests__/orchestrator-delete-match.test.ts
git commit -m "test(werewolf-orchestrator): pin deleteMatch semantics

Plan 4a Task 9: idempotent removal, does not delete persisted artifacts,
subscribe on a deleted match throws."
```

---

### Task 10: Werewolf wire-format Zod round-trip tests

Confirm `WerewolfDecisionRequest` and `WerewolfDecisionResponse` survive a JSON round-trip (the path real HTTP/WS adapters will take in Plans 4b/4c). This is a Zod-only test; no actual HTTP server. Tests cover: oversized speak fields are rejected, all action types parse, missing fields are rejected, unknown action.type is rejected.

**Files:**
- Test: `packages/agent-runtime/src/__tests__/werewolf-wire-roundtrip.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/agent-runtime/src/__tests__/werewolf-wire-roundtrip.test.ts
import { describe, expect, it } from 'vitest';
import {
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
  WEREWOLF_SPEAK_INNER_MAX,
  WEREWOLF_SPEAK_PERFORMANCE_MAX,
  WEREWOLF_SPEAK_SPEECH_MAX,
} from '@agent-poker/agent-protocol';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

describe('Werewolf wire-format JSON round trip', () => {
  it('serializes and re-parses a complete request', () => {
    const req = buildWerewolfDecisionRequest({
      requestId: 'r-1',
      gameId: 'g-1',
      agentId: 'a-1',
      playerId: 'p1',
      publicState: {
        gameId: 'g-1', phase: 'day-vote', nightNumber: 1, dayNumber: 1,
        players: [
          { id: 'p1', seatIndex: 0, name: 'A', alive: true, revealedRole: null },
        ],
        history: [], winner: null,
      },
      privateState: {
        selfId: 'p1', selfRole: 'villager', selfSide: 'good',
        knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false,
      },
      validActions: [
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      ],
      deadlineMs: 5_000,
    });
    const json = JSON.stringify(req);
    const parsed = WerewolfDecisionRequestSchema.parse(JSON.parse(json));
    expect(parsed.requestId).toBe('r-1');
    expect(parsed.validActions.length).toBe(2);
  });

  it('rejects speak with inner over WEREWOLF_SPEAK_INNER_MAX', () => {
    const oversize = {
      requestId: 'r', agentId: 'a',
      action: {
        type: 'speak', playerId: 'p1',
        inner: 'X'.repeat(WEREWOLF_SPEAK_INNER_MAX + 1),
        performance: 'ok', speech: 'ok',
      },
    };
    const result = WerewolfDecisionResponseSchema.safeParse(oversize);
    expect(result.success).toBe(false);
  });

  it('accepts speak at exactly the inner cap', () => {
    const ok = {
      requestId: 'r', agentId: 'a',
      action: {
        type: 'speak', playerId: 'p1',
        inner: 'X'.repeat(WEREWOLF_SPEAK_INNER_MAX),
        performance: 'X'.repeat(WEREWOLF_SPEAK_PERFORMANCE_MAX),
        speech: 'X'.repeat(WEREWOLF_SPEAK_SPEECH_MAX),
      },
    };
    expect(WerewolfDecisionResponseSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects unknown action.type', () => {
    const result = WerewolfDecisionResponseSchema.safeParse({
      requestId: 'r', agentId: 'a',
      action: { type: 'invent-a-move', targetId: 'p2' },
    });
    expect(result.success).toBe(false);
  });

  it('round-trips every action variant', () => {
    const variants = [
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      { type: 'witch-save', targetId: 'p1' },
      { type: 'witch-skip-save' },
      { type: 'witch-poison', targetId: 'p3' },
      { type: 'witch-skip-poison' },
      { type: 'seer-divine', targetId: 'p4' },
      { type: 'speak', playerId: 'p1', inner: 'i', performance: 'p', speech: 's' },
      { type: 'day-vote', voterId: 'p1', targetId: null },
      { type: 'day-vote', voterId: 'p1', targetId: 'p5' },
      { type: 'hunter-shoot', targetId: null },
      { type: 'hunter-shoot', targetId: 'p6' },
    ];
    for (const action of variants) {
      const wire = JSON.parse(JSON.stringify({ requestId: 'r', agentId: 'a', action }));
      expect(WerewolfDecisionResponseSchema.safeParse(wire).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test, expect PASS** (no implementation needed; everything already exists)

Run: `pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-wire-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 3: If any case unexpectedly fails, investigate**

If a variant rejects, that means a Zod schema bug from Plan 2 / Plan 3 — fix it in `packages/agent-protocol/src/werewolf-schemas.ts`. Otherwise commit.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/__tests__/werewolf-wire-roundtrip.test.ts
git commit -m "test(agent-runtime): JSON round-trip for werewolf wire format

Plan 4a Task 10: every WerewolfAction variant survives JSON.stringify→parse.
Speak inner/performance/speech caps enforced. Unknown action types rejected.
Locks the contract Plan 4b's HTTP/WS adapters will rely on."
```

---

### Task 11: Workspace-wide green check + final commit

The plan touches three packages. Run the full workspace test + lint to catch any cross-package regression (especially around the new `persistence ↔ werewolf-orchestrator` workspace edges).

- [ ] **Step 1: Workspace test**

Run: `pnpm test`
Expected: all packages green. Existing 689 tests + new tests (≈ 25-30 added across all tasks) all pass.

- [ ] **Step 2: Workspace build**

Run: `pnpm build`
Expected: green. No cycle errors from `tsc -b`.

- [ ] **Step 3: Skipped — there is no workspace `lint` script**

`pnpm build` (Step 2) already runs `tsc -b` for every package; that is the project's typecheck. The original plan referenced `pnpm lint` by mistake.

- [ ] **Step 4: If everything green, no commit needed (each task already committed)**

Run: `git log --oneline 8cf5ba9..HEAD`
Expected: roughly 11–13 new commits (one per task plus the Task 1 fixup).

---

## Self-review checklist

Before declaring Plan 4a done, the implementing agent (or reviewer) should walk through:

**1. Spec coverage** — every deferred-item that 4a owns:
- [ ] Item 1 (public event envelope filter) → Tasks 1+2
- [ ] Item 2 (match artifact persistence + redacted history) → Tasks 5+6+7
- [ ] Item 3 (decision-trace persistence with caps) → Tasks 3+4+8
- [ ] Item 4 (HTTP/WS wire-format round trip) → Task 10
- [ ] Item 7 (deleteMatch lifecycle) → Tasks 7+9

**2. Information-isolation invariants:**
- [ ] No `playerId`/`agentId` in `agent.action_*` events when `phase ∈ {night-werewolf-vote, night-witch, night-seer}` — pinned by replay-event-to-public.test.ts
- [ ] No `role-assigned` / `night-action` / `speak.inner` in `record.summary.history` — pinned by werewolf-match-artifact-serialization.test.ts
- [ ] No `seed` on the public summary — covered by the type definition (omitted entirely)
- [ ] Reasoning summary capped — pinned by decision-trace-recording.test.ts

**3. No placeholders / type drift:**
- [ ] Every test uses concrete types from `@agent-poker/shared`, never `any`.
- [ ] `IWerewolfMatchArtifactStore` and `IWerewolfDecisionTraceStore` interfaces have stable method names that match across orchestrator (consumer) and persistence (provider).
- [ ] `BuildWerewolfArtifactInput` shape matches what `WerewolfOrchestrator.persistArtifact` constructs.

If the post-implementation `pnpm test` is green and the boxes above check out, Plan 4a is complete. Move on to Plan 4b.

---

## What this plan deliberately does NOT do

- No `RealtimeHub` integration. The orchestrator's emitter still emits internal events; broadcast filtering happens at the boundary in Plan 4b.
- No `apps/api` routes. The artifact store is library-only here; Plan 4b builds the read-only HTTP routes.
- No `WerewolfHttpAgentAdapter` / `WerewolfWsAgentAdapter`. The wire format is *tested* (Task 10) but real adapters land in Plan 4c.
- No TTL-based match cleanup. `deleteMatch` is manual; runtime cleanup attaches in Plan 4b alongside the hub.
- No analysis-summary equivalent. Poker has `MatchAnalysisSummary` per-agent; werewolf can add an analogous one in Plan 4c if the demo benefits.
- No env-based store factory (`createWerewolfMatchArtifactStore`). The factory lives next to API wiring, so it's a Plan 4b concern.
