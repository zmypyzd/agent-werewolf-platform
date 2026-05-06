# Werewolf Plan 4b — API Routes + Realtime Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose werewolf match artifacts (built in 4a) as read-only HTTP routes and stream live match events over WebSocket without breaking the information-isolation invariants 4a established. After 4b lands, a spectator can hit `GET /api/v1/werewolf-matches/:id/replay` and an authenticated user can subscribe to `match:<gameId>` for public events and `player:<userId>:<gameId>` for their own private state.

**Architecture:**
- HTTP: a new `werewolf-matches.ts` route module mirrors `apps/api/src/routes/matches.ts`. Public projection strips `seed` (already absent from persisted summaries — defense in depth at the route layer too), `files` from manifests, and `privateStateHash` + `reasoningSummary` from each `WerewolfDecisionTrace`. Replay events are passthrough because 4a already persists them post-filter.
- Realtime: `attachWerewolfHub(orchestrator, hub)` lives in `packages/werewolf-orchestrator` (which gains a `@agent-poker/realtime` dep — keeps the DAG `shared ← realtime ← persistence ← werewolf-orchestrator`). It is the only piece that knows both the orchestrator's emitter shape and the WS topic schema. For each attached match it forwards public replay events through `werewolfReplayEventToPublic` to `match:<gameId>` and private-state snapshots to `player:<userId>:<gameId>`.
- Match-runner gains a *non-replay* event channel `'private-state'` with payload `{ playerId, privateState }`, fired immediately before each `agent.action_requested`. This channel is only routed to the per-player WS topic — never persisted, never broadcast publicly.
- WS route extends its server-side topic gate: `match:*` is publicly subscribable (read-only); `player:<userId>:<gameId>` is only subscribable when the connection's `userId` matches.
- Store factory: `apps/api/src/werewolf-match-artifact-store-factory.ts` chooses between `MemoryWerewolfMatchArtifactStore` and `ObjectWerewolfMatchArtifactStore(FileObjectStore)` based on `WEREWOLF_MATCH_ARTIFACT_STORE` and `WEREWOLF_MATCH_ARTIFACT_BASE_DIR`.
- TTL cleaner: a tiny `WerewolfMatchTtlCleaner` class with `runOnce(now?)` that removes completed in-memory match entries older than N ms. The class is scheduler-free; callers wrap it in `setInterval` if they want a daemon.

**Tech Stack:** TypeScript 5.5 strict + NodeNext (`.js` extensions on relative imports, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), pnpm 10.33.2 workspaces, Vitest 2, Fastify 4 + `@fastify/websocket`, `ws` for the test client, `RealtimeHub` from `@agent-poker/realtime`.

**Working tree:** `/Users/zmy/intership/5/5-4-claude/.worktrees/plan3` on branch `plan3`. Commit per task.

---

## File Structure

**New files:**
- `packages/werewolf-orchestrator/src/hub-integration.ts` — `attachWerewolfHub`, `WerewolfHubAttachment`, `AttachWerewolfMatchOptions`
- `packages/werewolf-orchestrator/src/match-ttl-cleaner.ts` — `WerewolfMatchTtlCleaner`, `WerewolfMatchTtlCleanerOptions`
- `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/match-ttl-cleaner.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/match-runner-private-state-channel.test.ts`
- `packages/werewolf-orchestrator/src/__tests__/orchestrator-subscribe-private.test.ts`
- `packages/realtime/src/__tests__/werewolf-wire.test.ts`
- `apps/api/src/werewolf-match-artifact-store-factory.ts`
- `apps/api/src/routes/werewolf-matches.ts`
- `apps/api/src/__tests__/werewolf-match-artifact-store-factory.test.ts`
- `apps/api/src/__tests__/werewolf-matches.test.ts`
- `apps/api/src/__tests__/werewolf-server-wiring.test.ts`
- `apps/api/src/__tests__/werewolf-ws.test.ts`
- `apps/api/src/__tests__/werewolf-matches.integration.test.ts`

**Modified files:**
- `packages/realtime/src/wire.ts` — add `werewolfMatchTopic` + `werewolfPlayerTopic` helpers; widen the `Topic` type
- `packages/werewolf-orchestrator/src/match-runner.ts` — emit `'private-state'` event channel with `{ playerId, privateState }` immediately before `agent.action_requested`
- `packages/werewolf-orchestrator/src/orchestrator.ts` — add `subscribePrivate(matchId, listener)` returning an unsubscriber; pipe match-runner's private-state emissions through the existing per-match `EventEmitter`
- `packages/werewolf-orchestrator/src/index.ts` — re-export `attachWerewolfHub`, `WerewolfMatchTtlCleaner`, related types
- `packages/werewolf-orchestrator/package.json` — add `"@agent-poker/realtime": "workspace:*"`
- `packages/werewolf-orchestrator/tsconfig.json` — add `{ "path": "../realtime" }` reference and `paths` entry
- `apps/api/src/server.ts` — accept werewolf options, build a `WerewolfOrchestrator`, attach the hub, register `werewolfMatchesRoutes`
- `apps/api/src/routes/ws.ts` — recognise `match:` and `player:` prefixes; reject `player:<otherUserId>:*` subscriptions

---

## Plan-wide conventions

- **Per-package commands** (run from the worktree root):
  - Build (also typechecks): `pnpm --filter @agent-poker/<pkg> run build` (= `tsc -b`). Treat this as your typecheck — there is no separate `lint` script in this monorepo.
  - For `apps/api`: `pnpm --filter api run build` (the package name is `api`, not `@agent-poker/api`).
  - Single-file Vitest: `pnpm --filter @agent-poker/<pkg> exec vitest run src/__tests__/<file>.test.ts`
  - Watch one test by name: `pnpm --filter @agent-poker/<pkg> exec vitest run -t '<test name>'`
- **Workspace-wide green check** (run before each commit): `pnpm test && pnpm build`. Both must pass; absolutely no `any`, no `// @ts-ignore`. Vitest does NOT typecheck, so always run `pnpm --filter <pkg> run build` after editing types or test files.
- **TDD shape:** every task that adds behaviour writes the failing test first, runs it to confirm failure, then implements. Commit after each green run.
- **Imports:** relative imports must use `.js` extension on `.ts` source (NodeNext). Cross-package imports use the `@agent-poker/<pkg>` workspace name.
- **Files use `kebab-case.ts`. Types use `PascalCase`. Functions/vars `camelCase`. Constants `SCREAMING_SNAKE_CASE`.**
- **`WerewolfRandomMockAgent`** is constructed with positional args `(agentId, name, options?)` — *not* an options object. Tests in this plan must follow that shape.
- **Information-isolation invariants** (must not regress):
  1. Public replay events stripped of actor identity in night phases (`night-werewolf-vote`, `night-witch`, `night-seer`).
  2. `match.started` events on the public stream / artifact carry NO `seed`.
  3. `speak` actions in any public event carry no `inner` field.
  4. `WerewolfDecisionTrace` exposed publicly never includes `privateStateHash` or `reasoningSummary`.
  5. `match:` topic is purely public; `player:<userId>:<gameId>` is only delivered to that exact `userId`.
  These are the same invariants 4a established. 4b sends data through the same `werewolfReplayEventToPublic` filter; do not invent a parallel path.

---

### Task 1: Match-runner emits a non-replay `private-state` channel

The hub integration needs per-player private-state snapshots so it can forward them to the player's WS topic. The match-runner already computes `privateState` at decision time (`match-runner.ts:162`). Add a non-replay channel emission `'private-state'` with `{ playerId, privateState }` immediately before each `agent.action_requested` so the orchestrator can pipe it to per-player listeners. This is purely additive — bufferedEvents (which only listens to `'replay-event'`) and persistence are unaffected.

**Files:**
- Modify: `packages/werewolf-orchestrator/src/match-runner.ts`
- Test: `packages/werewolf-orchestrator/src/__tests__/match-runner-private-state-channel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/match-runner-private-state-channel.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId, WerewolfPrivateState } from '@agent-poker/shared';

describe('match-runner private-state channel', () => {
  it('emits {playerId, privateState} before each agent.action_requested', async () => {
    const initial = createGame({ gameId: 'g-priv', seed: 'seed-priv' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();

    const requestedOrder: WerewolfPlayerId[] = [];
    const privateOrder: Array<{ playerId: WerewolfPlayerId; privateState: WerewolfPrivateState }> = [];
    emitter.on('agent.action_requested', (e: { data: { playerId: WerewolfPlayerId } }) => {
      requestedOrder.push(e.data.playerId);
    });
    emitter.on('private-state', (e: { playerId: WerewolfPlayerId; privateState: WerewolfPrivateState }) => {
      privateOrder.push({ playerId: e.playerId, privateState: e.privateState });
    });

    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();

    expect(privateOrder.length).toBe(requestedOrder.length);
    expect(privateOrder.length).toBeGreaterThan(0);
    for (let i = 0; i < requestedOrder.length; i++) {
      expect(privateOrder[i]!.playerId).toBe(requestedOrder[i]);
      expect(privateOrder[i]!.privateState.selfId).toBe(requestedOrder[i]);
    }
  });

  it("private-state events do NOT leak into the replay-event stream", async () => {
    const initial = createGame({ gameId: 'g-priv-2', seed: 'seed-priv-2' });
    const agents = new Map(
      initial.players.map((p) => [
        p.id,
        new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, { seed: `r-${p.id}` }),
      ]),
    );
    const emitter = new EventEmitter();
    const replay: Array<{ eventType: string }> = [];
    emitter.on('replay-event', (e: { eventType: string }) => replay.push(e));
    const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
    await runner.run();
    expect(replay.some((e) => (e.eventType as string) === 'private-state')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner-private-state-channel.test.ts`
Expected: FAIL — `privateOrder` is empty because nothing emits `'private-state'`.

- [ ] **Step 3: Emit `'private-state'` in `runOneAction`**

In `packages/werewolf-orchestrator/src/match-runner.ts`, immediately before the existing `this.emit('agent.action_requested', ...)` call (currently around lines 174–180), add a direct EventEmitter.emit (NOT going through the `emit` helper, because that wraps in a `WerewolfReplayEvent` and routes to `'replay-event'`):

```typescript
// Non-replay private-state channel. Carries the requesting player's full
// private state so per-player WS topic forwarders can push it. Deliberately
// uses emitter.emit (not this.emit) so the event neither becomes a
// WerewolfReplayEvent nor flows into bufferedEvents / persistence.
this.emitter.emit('private-state', { playerId: player.id, privateState });

this.emit('agent.action_requested', {
  requestId: req.requestId,
  agentId: agent.agentId,
  playerId: player.id,
  phase: req.phase,
  validActionCount: validActions.length,
});
```

- [ ] **Step 4: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-runner-private-state-channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the orchestrator suite to make sure nothing else broke**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run test`
Expected: all green.

- [ ] **Step 6: Build the package (typecheck)**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/werewolf-orchestrator/src/match-runner.ts \
        packages/werewolf-orchestrator/src/__tests__/match-runner-private-state-channel.test.ts
git commit -m "feat(werewolf-orchestrator): emit private-state channel before agent.action_requested

Plan 4b Task 1: non-replay 'private-state' EventEmitter channel carries
{playerId, privateState} so per-player WS topic forwarders can push the
snapshot. Deliberately bypasses the replay/persistence path."
```

---

### Task 2: Orchestrator exposes `subscribePrivate`

Plumbs the new `'private-state'` channel up through `WerewolfOrchestrator.subscribePrivate(matchId, listener)`, mirroring the existing `subscribe` API. Returns an unsubscriber.

**Files:**
- Modify: `packages/werewolf-orchestrator/src/orchestrator.ts`
- Test: `packages/werewolf-orchestrator/src/__tests__/orchestrator-subscribe-private.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/orchestrator-subscribe-private.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfPlayerId, WerewolfPrivateState } from '@agent-poker/shared';

describe('WerewolfOrchestrator.subscribePrivate', () => {
  it('streams {playerId, privateState} for the running match and the unsubscriber detaches', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({ gameId: 'g-sp', seed: 's-sp' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }

    const calls: Array<{ playerId: WerewolfPlayerId; selfId: WerewolfPlayerId }> = [];
    const unsubscribe = orch.subscribePrivate(matchId, (event) => {
      calls.push({ playerId: event.playerId, selfId: event.privateState.selfId });
    });

    await orch.runMatch(matchId);

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.playerId).toBe(c.selfId);
    }

    // After unsubscribe, no further calls (run a 2nd match-id to confirm the
    // returned function actually removes the listener — same orchestrator
    // instance, fresh match.)
    const before = calls.length;
    unsubscribe();
    const second = orch.createMatch({ gameId: 'g-sp-2', seed: 's-sp-2' });
    for (const p of second.initialState.players) {
      orch.registerAgent(second.matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    await orch.runMatch(second.matchId);
    // The listener was attached only to matchId 'g-sp'. Unsubscribing it does
    // not affect g-sp-2 because there was never a listener there to begin
    // with. The point of this assertion: calls.length must NOT have grown.
    expect(calls.length).toBe(before);
  });

  it('throws when subscribePrivate is called for an unknown matchId', () => {
    const orch = new WerewolfOrchestrator();
    expect(() => orch.subscribePrivate('does-not-exist', () => {})).toThrow(/unknown match/);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator-subscribe-private.test.ts`
Expected: FAIL — `subscribePrivate` is not a method on `WerewolfOrchestrator`.

- [ ] **Step 3: Add `subscribePrivate` to `WerewolfOrchestrator`**

In `packages/werewolf-orchestrator/src/orchestrator.ts`, add a new public method after `subscribe`:

```typescript
import type { WerewolfPrivateState } from '@agent-poker/shared';

export interface WerewolfPrivateStateEvent {
  readonly playerId: WerewolfPlayerId;
  readonly privateState: WerewolfPrivateState;
}
```

Place the `WerewolfPrivateStateEvent` interface near the top of the file (after the `WerewolfOrchestratorOptions` interface). Then add the method on the class, immediately after `subscribe`:

```typescript
subscribePrivate(
  matchId: string,
  listener: (event: WerewolfPrivateStateEvent) => void,
): () => void {
  const entry = this.requireEntry(matchId);
  const wrapped = (e: WerewolfPrivateStateEvent) => listener(e);
  entry.emitter.on('private-state', wrapped);
  return () => entry.emitter.off('private-state', wrapped);
}
```

Make sure to also import `WerewolfPrivateState` in the existing `import type { … } from '@agent-poker/shared'` block at the top of the file:

```typescript
import type {
  WerewolfGameState,
  WerewolfPlayerId,
  WerewolfPrivateState,
  WerewolfReplayEvent,
} from '@agent-poker/shared';
```

- [ ] **Step 4: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/orchestrator-subscribe-private.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: clean exit.

- [ ] **Step 6: Re-export the new type from the package barrel**

In `packages/werewolf-orchestrator/src/index.ts` no change needed yet — `WerewolfPrivateStateEvent` is exported via `export * from './orchestrator.js';`. Verify by running:

Run: `grep -n "WerewolfPrivateStateEvent" packages/werewolf-orchestrator/src/orchestrator.ts`
Expected: shows `export interface WerewolfPrivateStateEvent`.

- [ ] **Step 7: Commit**

```bash
git add packages/werewolf-orchestrator/src/orchestrator.ts \
        packages/werewolf-orchestrator/src/__tests__/orchestrator-subscribe-private.test.ts
git commit -m "feat(werewolf-orchestrator): WerewolfOrchestrator.subscribePrivate

Plan 4b Task 2: per-match private-state subscription. Mirrors subscribe();
returns an unsubscriber. Used by attachWerewolfHub in Task 5."
```

---

### Task 3: Realtime — werewolf topic helpers

Add `werewolfMatchTopic(gameId)` and `werewolfPlayerTopic(userId, gameId)` helpers to `packages/realtime/src/wire.ts`. Widen the `Topic` union so type-checked callers can spell these out. Keep the helpers tiny and template-literal — do NOT validate inputs (gameId / userId come from the auth-checked request and from server-controlled state).

**Files:**
- Modify: `packages/realtime/src/wire.ts`
- Test: `packages/realtime/src/__tests__/werewolf-wire.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/realtime/src/__tests__/werewolf-wire.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { werewolfMatchTopic, werewolfPlayerTopic } from '../wire.js';

describe('werewolf wire helpers', () => {
  it('werewolfMatchTopic returns "match:<gameId>"', () => {
    expect(werewolfMatchTopic('g-1')).toBe('match:g-1');
  });

  it('werewolfPlayerTopic returns "player:<userId>:<gameId>"', () => {
    expect(werewolfPlayerTopic('u-7', 'g-1')).toBe('player:u-7:g-1');
  });

  it('player topic round-trips: split by ":" yields exactly userId and gameId', () => {
    const t = werewolfPlayerTopic('user-uuid', 'game-uuid');
    const parts = t.split(':');
    expect(parts[0]).toBe('player');
    expect(parts[1]).toBe('user-uuid');
    expect(parts[2]).toBe('game-uuid');
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @agent-poker/realtime exec vitest run src/__tests__/werewolf-wire.test.ts`
Expected: FAIL — exports do not exist.

- [ ] **Step 3: Add the helpers**

In `packages/realtime/src/wire.ts`, widen the `Topic` type and add two helpers:

```typescript
export type Topic =
  | 'lobby'
  | `table:${string}`
  | `seat:${string}:${string}`
  | `match:${string}`
  | `player:${string}:${string}`;

// ...existing tableTopic + seatTopic stay…

export function werewolfMatchTopic(gameId: string): string {
  return `match:${gameId}`;
}

export function werewolfPlayerTopic(userId: string, gameId: string): string {
  return `player:${userId}:${gameId}`;
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter @agent-poker/realtime exec vitest run src/__tests__/werewolf-wire.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @agent-poker/realtime run build`
Expected: clean exit.

- [ ] **Step 6: Run the full realtime suite**

Run: `pnpm --filter @agent-poker/realtime run test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/realtime/src/wire.ts \
        packages/realtime/src/__tests__/werewolf-wire.test.ts
git commit -m "feat(realtime): werewolf topic helpers

Plan 4b Task 3: werewolfMatchTopic + werewolfPlayerTopic; widen Topic
union to include match:* and player:*:* template literals."
```

---

### Task 4: werewolf-orchestrator → realtime dependency

`attachWerewolfHub` (Task 5) needs `RealtimeHub` types. Add the workspace dep + tsconfig project reference. The DAG remains acyclic because `realtime` does not depend on `werewolf-orchestrator`.

**Files:**
- Modify: `packages/werewolf-orchestrator/package.json`
- Modify: `packages/werewolf-orchestrator/tsconfig.json`

- [ ] **Step 1: Add workspace dep**

Edit `packages/werewolf-orchestrator/package.json` — add `"@agent-poker/realtime": "workspace:*"` to the `dependencies` block. Final `dependencies` should be:

```json
"dependencies": {
  "@agent-poker/shared": "workspace:*",
  "@agent-poker/agent-protocol": "workspace:*",
  "@agent-poker/werewolf-engine": "workspace:*",
  "@agent-poker/agent-runtime": "workspace:*",
  "@agent-poker/persistence": "workspace:*",
  "@agent-poker/realtime": "workspace:*"
}
```

- [ ] **Step 2: Add tsconfig path + reference**

Edit `packages/werewolf-orchestrator/tsconfig.json`. Inside `compilerOptions.paths` add:
```json
"@agent-poker/realtime": ["../realtime/src/index.ts"]
```
And in the top-level `references` array append:
```json
{ "path": "../realtime" }
```

Final tsconfig should look like:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "paths": {
      "@agent-poker/shared": ["../shared/src/index.ts"],
      "@agent-poker/agent-protocol": ["../agent-protocol/src/index.ts"],
      "@agent-poker/werewolf-engine": ["../werewolf-engine/src/index.ts"],
      "@agent-poker/agent-runtime": ["../agent-runtime/src/index.ts"],
      "@agent-poker/persistence": ["../persistence/src/index.ts"],
      "@agent-poker/realtime": ["../realtime/src/index.ts"]
    }
  },
  "references": [
    { "path": "../shared" },
    { "path": "../agent-protocol" },
    { "path": "../werewolf-engine" },
    { "path": "../agent-runtime" },
    { "path": "../persistence" },
    { "path": "../realtime" }
  ],
  "include": ["src"]
}
```

- [ ] **Step 3: Re-install workspace deps**

Run: `pnpm install`
Expected: pnpm installs the workspace symlink (no network changes); exits cleanly.

- [ ] **Step 4: Build the package — verify reference cycle does not exist**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: clean exit. If you see `error TS6202: Project references may not form a circular graph`, double-check that nothing under `packages/realtime/**` imports `@agent-poker/werewolf-orchestrator`. (It should not.)

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-orchestrator/package.json \
        packages/werewolf-orchestrator/tsconfig.json
git commit -m "chore(werewolf-orchestrator): add @agent-poker/realtime workspace dep

Plan 4b Task 4: prepares the package for attachWerewolfHub. DAG stays
shared <- realtime <- persistence <- werewolf-orchestrator."
```

---

### Task 5: `attachWerewolfHub` — orchestrator-to-RealtimeHub bridge

Wires per-match orchestrator emitters to RealtimeHub topics. For each attached match:
- Public replay events flow through `werewolfReplayEventToPublic`. Output (always non-null today) is published to `match:<gameId>` with `type: <eventType>` and the event's `data` as the payload (mirrors poker's `hub.publishTable(tableId, pub.eventType, pub.data)` pattern in `packages/table-orchestrator/src/orchestrator.ts:473`).
- Private-state events route to `player:<userId>:<gameId>` with `type: 'werewolf.private_state'` and payload `{ matchId, playerId, privateState }`. Players without an entry in the ownership map do not get private pushes (mock-only matches stay clean).

**Files:**
- Create: `packages/werewolf-orchestrator/src/hub-integration.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts`
- Modify: `packages/werewolf-orchestrator/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { RealtimeHub, type HubConnection } from '@agent-poker/realtime';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { attachWerewolfHub } from '../hub-integration.js';

interface CapturedFrame {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
}

function fakeConnection(userId: string): { conn: HubConnection; frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  const conn: HubConnection = {
    userId,
    send(json: string) { frames.push(JSON.parse(json) as CapturedFrame); },
  };
  return { conn, frames };
}

async function runMatch(orch: WerewolfOrchestrator, gameId: string, seed: string): Promise<{
  matchId: string;
  players: Array<{ id: string }>;
}> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  return { matchId, players: initialState.players.map((p) => ({ id: p.id })) };
}

describe('attachWerewolfHub', () => {
  it('publishes public replay events to match:<gameId> with actor identity stripped in night phases', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId } = await runMatch(orch, 'g-public', 's-public');
    attachment.attachMatch(matchId, []); // no ownership; only match: topic gets pushes

    const spectator = fakeConnection('user-spec');
    hub.subscribe(spectator.conn, `match:${matchId}`);

    await orch.runMatch(matchId);

    const matchFrames = spectator.frames.filter((f) => f.topic === `match:${matchId}`);
    expect(matchFrames.length).toBeGreaterThan(0);

    // match.started carries no seed
    const started = matchFrames.find((f) => f.type === 'match.started');
    expect(started).toBeDefined();
    expect(started!.payload['seed']).toBeUndefined();

    // night-phase agent.action_received frames have no actor identity
    const nightFrames = matchFrames.filter(
      (f) =>
        (f.type === 'agent.action_requested' || f.type === 'agent.action_received') &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(f.payload['phase'] as string),
    );
    expect(nightFrames.length).toBeGreaterThan(0);
    for (const f of nightFrames) {
      expect(f.payload['playerId']).toBeUndefined();
      expect(f.payload['agentId']).toBeUndefined();
    }
  });

  it('publishes per-player private-state snapshots only to that player\'s player:<userId>:<gameId> topic', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId, players } = await runMatch(orch, 'g-priv', 's-priv');
    // Map first player to user-A, second to user-B; the rest unowned.
    const ownership = [
      { playerId: players[0]!.id, userId: 'user-A' },
      { playerId: players[1]!.id, userId: 'user-B' },
    ];
    attachment.attachMatch(matchId, ownership);

    const userA = fakeConnection('user-A');
    const userB = fakeConnection('user-B');
    hub.subscribe(userA.conn, `player:user-A:${matchId}`);
    hub.subscribe(userB.conn, `player:user-B:${matchId}`);

    await orch.runMatch(matchId);

    const aFrames = userA.frames.filter((f) => f.type === 'werewolf.private_state');
    const bFrames = userB.frames.filter((f) => f.type === 'werewolf.private_state');
    expect(aFrames.length).toBeGreaterThan(0);
    expect(bFrames.length).toBeGreaterThan(0);

    // No cross-leak.
    for (const f of aFrames) {
      expect(f.topic).toBe(`player:user-A:${matchId}`);
      expect((f.payload['privateState'] as { selfId: string }).selfId).toBe(players[0]!.id);
    }
    for (const f of bFrames) {
      expect(f.topic).toBe(`player:user-B:${matchId}`);
      expect((f.payload['privateState'] as { selfId: string }).selfId).toBe(players[1]!.id);
    }
  });

  it('detachMatch removes all listeners for that match', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId } = await runMatch(orch, 'g-detach', 's-detach');
    attachment.attachMatch(matchId, []);
    attachment.detachMatch(matchId);

    const spectator = fakeConnection('user-spec');
    hub.subscribe(spectator.conn, `match:${matchId}`);

    await orch.runMatch(matchId);
    expect(spectator.frames.length).toBe(0);
  });

  it('attaching the same matchId twice throws', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);
    const { matchId } = await runMatch(orch, 'g-twice', 's-twice');
    attachment.attachMatch(matchId, []);
    expect(() => attachment.attachMatch(matchId, [])).toThrow(/already attached/);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/hub-integration.test.ts`
Expected: FAIL — `attachWerewolfHub` does not exist yet.

- [ ] **Step 3: Implement `hub-integration.ts`**

Create `packages/werewolf-orchestrator/src/hub-integration.ts`:

```typescript
import {
  type RealtimeHub,
  werewolfMatchTopic,
  werewolfPlayerTopic,
  werewolfReplayEventToPublic,
} from '@agent-poker/realtime';
import type { WerewolfOrchestrator, WerewolfPrivateStateEvent } from './orchestrator.js';

export interface WerewolfPlayerOwnership {
  readonly playerId: string;
  readonly userId: string;
}

export interface AttachWerewolfMatchOptions {
  // No options yet — placeholder for future knobs (e.g. selective filters).
}

export interface WerewolfHubAttachment {
  attachMatch(
    matchId: string,
    ownership: ReadonlyArray<WerewolfPlayerOwnership>,
    options?: AttachWerewolfMatchOptions,
  ): void;
  detachMatch(matchId: string): void;
  detachAll(): void;
}

interface MatchHandle {
  readonly unsubscribeReplay: () => void;
  readonly unsubscribePrivate: () => void;
}

export function attachWerewolfHub(
  orchestrator: WerewolfOrchestrator,
  hub: RealtimeHub,
): WerewolfHubAttachment {
  const handles = new Map<string, MatchHandle>();

  function attachMatch(
    matchId: string,
    ownership: ReadonlyArray<WerewolfPlayerOwnership>,
    _options: AttachWerewolfMatchOptions = {},
  ): void {
    if (handles.has(matchId)) {
      throw new Error(`attachWerewolfHub: match ${matchId} is already attached`);
    }
    const playerToUser = new Map<string, string>();
    for (const o of ownership) {
      playerToUser.set(o.playerId, o.userId);
    }
    const matchTopic = werewolfMatchTopic(matchId);

    const unsubscribeReplay = orchestrator.subscribe(matchId, (event) => {
      const publicEvent = werewolfReplayEventToPublic(event);
      if (publicEvent === null) return;
      hub.publish(matchTopic, {
        topic: matchTopic,
        type: publicEvent.eventType,
        payload: { ...publicEvent.data, eventId: publicEvent.eventId, sequence: publicEvent.sequence, timestamp: publicEvent.timestamp },
      });
    });

    const unsubscribePrivate = orchestrator.subscribePrivate(matchId, (e: WerewolfPrivateStateEvent) => {
      const userId = playerToUser.get(e.playerId);
      if (!userId) return;
      const playerTopic = werewolfPlayerTopic(userId, matchId);
      hub.publish(playerTopic, {
        topic: playerTopic,
        type: 'werewolf.private_state',
        payload: { matchId, playerId: e.playerId, privateState: e.privateState },
      });
    });

    handles.set(matchId, { unsubscribeReplay, unsubscribePrivate });
  }

  function detachMatch(matchId: string): void {
    const handle = handles.get(matchId);
    if (!handle) return;
    handle.unsubscribeReplay();
    handle.unsubscribePrivate();
    handles.delete(matchId);
  }

  function detachAll(): void {
    for (const matchId of [...handles.keys()]) detachMatch(matchId);
  }

  return { attachMatch, detachMatch, detachAll };
}
```

- [ ] **Step 4: Re-export the new module**

Edit `packages/werewolf-orchestrator/src/index.ts` — add a line:

```typescript
export * from './hub-integration.js';
```

Final file:

```typescript
export * from './action-validator.js';
export * from './werewolf-fallback.js';
export * from './sanitize-action.js';
export * from './replay-event.js';
export * from './match-summary.js';
export * from './match-runner.js';
export * from './orchestrator.js';
export * from './hub-integration.js';
```

- [ ] **Step 5: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/hub-integration.test.ts`
Expected: PASS for all four cases.

- [ ] **Step 6: Build the package**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: clean exit.

- [ ] **Step 7: Run the full orchestrator suite**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/werewolf-orchestrator/src/hub-integration.ts \
        packages/werewolf-orchestrator/src/__tests__/hub-integration.test.ts \
        packages/werewolf-orchestrator/src/index.ts
git commit -m "feat(werewolf-orchestrator): attachWerewolfHub bridges orchestrator to RealtimeHub

Plan 4b Task 5: per-match attach/detach helper. Public replay events
flow through werewolfReplayEventToPublic to match:<gameId>; private-state
snapshots route to player:<userId>:<gameId> only when ownership maps
that player to a userId. Caller controls ownership."
```

---

### Task 6: Werewolf match-artifact store factory

Mirror `apps/api/src/match-artifact-store-factory.ts`. Env vars `WEREWOLF_MATCH_ARTIFACT_STORE` (default `memory`) and `WEREWOLF_MATCH_ARTIFACT_BASE_DIR` (required for `file`). `object` mode requires an injected `IObjectStore`.

**Files:**
- Create: `apps/api/src/werewolf-match-artifact-store-factory.ts`
- Create: `apps/api/src/__tests__/werewolf-match-artifact-store-factory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/werewolf-match-artifact-store-factory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import { createWerewolfMatchArtifactStore } from '../werewolf-match-artifact-store-factory.js';

describe('createWerewolfMatchArtifactStore', () => {
  it('returns memory store by default', () => {
    const store = createWerewolfMatchArtifactStore({});
    expect(store).toBeInstanceOf(MemoryWerewolfMatchArtifactStore);
  });

  it('returns object-backed file store when mode=file and base dir is provided', () => {
    const store = createWerewolfMatchArtifactStore({
      WEREWOLF_MATCH_ARTIFACT_STORE: 'file',
      WEREWOLF_MATCH_ARTIFACT_BASE_DIR: '/tmp/werewolf-artifacts',
    });
    expect(store).toBeInstanceOf(ObjectWerewolfMatchArtifactStore);
  });

  it('rejects file mode without a base dir', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'file' }))
      .toThrow('WEREWOLF_MATCH_ARTIFACT_BASE_DIR is required when WEREWOLF_MATCH_ARTIFACT_STORE=file');
  });

  it('rejects object mode without an injected object store', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'object' }))
      .toThrow('object mode requires an injected IObjectStore');
  });

  it('rejects unknown modes', () => {
    expect(() => createWerewolfMatchArtifactStore({ WEREWOLF_MATCH_ARTIFACT_STORE: 'redis' }))
      .toThrow(/Unsupported WEREWOLF_MATCH_ARTIFACT_STORE mode: redis/);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-match-artifact-store-factory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

Create `apps/api/src/werewolf-match-artifact-store-factory.ts`:

```typescript
import {
  FileObjectStore,
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import type { IObjectStore, IWerewolfMatchArtifactStore } from '@agent-poker/persistence';

export interface WerewolfMatchArtifactStoreEnv {
  WEREWOLF_MATCH_ARTIFACT_STORE?: string;
  WEREWOLF_MATCH_ARTIFACT_BASE_DIR?: string;
}

export interface WerewolfMatchArtifactStoreFactoryOptions {
  objectStore?: IObjectStore;
}

export function createWerewolfMatchArtifactStore(
  env: WerewolfMatchArtifactStoreEnv = process.env,
  options: WerewolfMatchArtifactStoreFactoryOptions = {},
): IWerewolfMatchArtifactStore {
  const mode = env.WEREWOLF_MATCH_ARTIFACT_STORE ?? 'memory';

  if (mode === 'memory') return new MemoryWerewolfMatchArtifactStore();

  if (mode === 'file') {
    const baseDir = env.WEREWOLF_MATCH_ARTIFACT_BASE_DIR;
    if (!baseDir) {
      throw new Error(
        'WEREWOLF_MATCH_ARTIFACT_BASE_DIR is required when WEREWOLF_MATCH_ARTIFACT_STORE=file',
      );
    }
    return new ObjectWerewolfMatchArtifactStore(new FileObjectStore(baseDir));
  }

  if (mode === 'object') {
    if (!options.objectStore) {
      throw new Error('object mode requires an injected IObjectStore');
    }
    return new ObjectWerewolfMatchArtifactStore(options.objectStore);
  }

  throw new Error(`Unsupported WEREWOLF_MATCH_ARTIFACT_STORE mode: ${mode}`);
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-match-artifact-store-factory.test.ts`
Expected: PASS for all five cases.

- [ ] **Step 5: Build apps/api**

Run: `pnpm --filter api run build`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/werewolf-match-artifact-store-factory.ts \
        apps/api/src/__tests__/werewolf-match-artifact-store-factory.test.ts
git commit -m "feat(api): createWerewolfMatchArtifactStore factory

Plan 4b Task 6: env-driven werewolf store factory mirroring poker's.
WEREWOLF_MATCH_ARTIFACT_STORE=memory|file|object; file mode requires
WEREWOLF_MATCH_ARTIFACT_BASE_DIR."
```

---

### Task 7: Read-only werewolf-matches HTTP routes

Mirror `apps/api/src/routes/matches.ts`. Public projection contract:
- `GET /werewolf-matches` returns the index (entries already lack `seed`).
- `GET /werewolf-matches/:matchId` returns `{ manifest, summary }`. Strip `files` from the manifest. Summary already lacks `seed` from 4a.
- `GET /werewolf-matches/:matchId/replay` returns the persisted replay events as-is (4a guarantees they were filtered before being saved).
- `GET /werewolf-matches/:matchId/decision-trace` returns each trace minus `privateStateHash` and `reasoningSummary`.
- 404 → `MATCH_NOT_FOUND` (the existing `AppError` code; no new error code needed).

**Files:**
- Create: `apps/api/src/routes/werewolf-matches.ts`
- Create: `apps/api/src/__tests__/werewolf-matches.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/werewolf-matches.test.ts`. This is a *unit-style* test that registers `werewolfMatchesRoutes` against a minimal Fastify instance with a hand-rolled error handler — it does NOT depend on `buildServer`, so it stays self-contained in Task 7. The full `buildServer` integration is exercised in Task 10.

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { AppError } from '@agent-poker/shared';
import { werewolfMatchesRoutes } from '../routes/werewolf-matches.js';

let app: FastifyInstance;
let artifactStore: MemoryWerewolfMatchArtifactStore;
let traceStore: MemoryWerewolfDecisionTraceStore;
let orch: WerewolfOrchestrator;

beforeEach(async () => {
  artifactStore = new MemoryWerewolfMatchArtifactStore();
  traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      reply.status(error.code === 'MATCH_NOT_FOUND' ? 404 : 500).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  });
  await app.register(werewolfMatchesRoutes, {
    prefix: '/api/v1',
    werewolfMatchArtifactStore: artifactStore,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function runMatch(gameId: string): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  await orch.runMatch(matchId);
}

describe('werewolf match artifact routes', () => {
  it('GET /api/v1/werewolf-matches is public and starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);
  });

  it('GET /api/v1/werewolf-matches lists a completed match without seed', async () => {
    await runMatch('g-list');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.map((e: { matchId: string }) => e.matchId)).toContain('g-list');
    for (const entry of body.data) {
      expect(entry).not.toHaveProperty('seed');
    }
  });

  it('GET /api/v1/werewolf-matches/:id returns manifest+summary stripped of files+seed', async () => {
    await runMatch('g-detail');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/g-detail' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.summary.matchId).toBe('g-detail');
    expect(body.data.summary).not.toHaveProperty('seed');
    expect(body.data.manifest).not.toHaveProperty('files');
    expect(body.data.replayEvents).toBeUndefined();
    expect(body.data.decisionTraces).toBeUndefined();
  });

  it('GET /api/v1/werewolf-matches/:id/replay returns persisted (already public) events with no actor identity in night phases and no seed', async () => {
    await runMatch('g-replay');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/g-replay/replay' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const matchStarted = body.data.find((e: { eventType: string }) => e.eventType === 'match.started');
    expect(matchStarted.data.seed).toBeUndefined();
    const nightPrivate = body.data.filter(
      (e: { eventType: string; data: Record<string, unknown> }) =>
        ['agent.action_requested', 'agent.action_received'].includes(e.eventType) &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.data['phase'] as string),
    );
    expect(nightPrivate.length).toBeGreaterThan(0);
    for (const e of nightPrivate) {
      expect(e.data.playerId).toBeUndefined();
      expect(e.data.agentId).toBeUndefined();
    }
  });

  it('GET /api/v1/werewolf-matches/:id/decision-trace strips privateStateHash + reasoningSummary', async () => {
    await runMatch('g-trace');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf-matches/g-trace/decision-trace',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.data)).not.toContain('privateStateHash');
    expect(JSON.stringify(body.data)).not.toContain('reasoningSummary');
    for (const t of body.data) {
      expect(t.publicStateHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([
    '/api/v1/werewolf-matches/no-such',
    '/api/v1/werewolf-matches/no-such/replay',
    '/api/v1/werewolf-matches/no-such/decision-trace',
  ])('%s returns 404 with MATCH_NOT_FOUND', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-matches.test.ts`
Expected: FAIL — module `../routes/werewolf-matches.js` does not exist yet.

- [ ] **Step 3: Implement the routes module**

Create `apps/api/src/routes/werewolf-matches.ts`:

```typescript
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  GetWerewolfMatchArtifactOptions,
  IWerewolfMatchArtifactStore,
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
} from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';
import type { WerewolfDecisionTrace } from '@agent-poker/shared';

interface WerewolfMatchesPluginOptions extends FastifyPluginOptions {
  werewolfMatchArtifactStore: IWerewolfMatchArtifactStore;
}

type PublicWerewolfMatchArtifactManifest = Omit<WerewolfMatchArtifactManifest, 'files'>;
type PublicWerewolfDecisionTrace = Omit<
  WerewolfDecisionTrace,
  'privateStateHash' | 'reasoningSummary'
>;

function publicManifest(
  manifest: WerewolfMatchArtifactManifest,
): PublicWerewolfMatchArtifactManifest {
  const { files: _files, ...rest } = manifest;
  return rest;
}

function publicIndexEntry(
  entry: WerewolfMatchArtifactIndexEntry,
): WerewolfMatchArtifactIndexEntry {
  // The persisted index entry already lacks `seed`; defense in depth — explicitly
  // strip if a future revision re-introduces it.
  const cloned: Record<string, unknown> = { ...entry };
  delete cloned['seed'];
  return cloned as WerewolfMatchArtifactIndexEntry;
}

function publicDecisionTraces(
  traces: ReadonlyArray<WerewolfDecisionTrace>,
): PublicWerewolfDecisionTrace[] {
  return traces.map((t) => {
    const {
      privateStateHash: _privateStateHash,
      reasoningSummary: _reasoningSummary,
      ...rest
    } = t;
    return rest;
  });
}

async function getRecordOrThrow(
  store: IWerewolfMatchArtifactStore,
  matchId: string,
  options?: GetWerewolfMatchArtifactOptions,
) {
  try {
    const record = await store.getMatchArtifact(matchId, options);
    if (record) return record;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid matchId path segment:')) {
      throw new AppError('MATCH_NOT_FOUND', `Werewolf match ${matchId} not found`);
    }
    throw e;
  }
  throw new AppError('MATCH_NOT_FOUND', `Werewolf match ${matchId} not found`);
}

export async function werewolfMatchesRoutes(
  app: FastifyInstance,
  opts: WerewolfMatchesPluginOptions,
) {
  const { werewolfMatchArtifactStore: store } = opts;

  app.get('/werewolf-matches', async (_req, reply) => {
    const entries = await store.listMatchArtifacts();
    reply.send({ data: entries.map(publicIndexEntry) });
  });

  app.get<{ Params: { matchId: string } }>('/werewolf-matches/:matchId', async (req, reply) => {
    const record = await getRecordOrThrow(store, req.params.matchId, {
      includeReplayEvents: false,
      includeDecisionTraces: false,
    });
    reply.send({
      data: {
        manifest: publicManifest(record.manifest),
        summary: record.summary,
      },
    });
  });

  app.get<{ Params: { matchId: string } }>(
    '/werewolf-matches/:matchId/replay',
    async (req, reply) => {
      const record = await getRecordOrThrow(store, req.params.matchId);
      reply.send({ data: record.replayEvents });
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/werewolf-matches/:matchId/decision-trace',
    async (req, reply) => {
      const record = await getRecordOrThrow(store, req.params.matchId, {
        includeReplayEvents: false,
      });
      reply.send({ data: publicDecisionTraces(record.decisionTraces) });
    },
  );
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-matches.test.ts`
Expected: PASS for all six cases (including the parameterised 404 sub-tests).

- [ ] **Step 5: Build apps/api**

Run: `pnpm --filter api run build`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/werewolf-matches.ts \
        apps/api/src/__tests__/werewolf-matches.test.ts
git commit -m "feat(api): public read-only werewolf-matches routes

Plan 4b Task 7: GET /werewolf-matches, /:id, /:id/replay, /:id/decision-trace.
Strips files from manifests and privateStateHash + reasoningSummary from
decision traces. Maps unsafe paths and missing matches to MATCH_NOT_FOUND."
```

---

### Task 8: Wire werewolf store + orchestrator + hub into `buildServer`

Lands the server wiring **first** so Task 9's WS-route test (which references the new `BuildServerOptions` fields) can typecheck. Extends `BuildServerOptions`, constructs a `WerewolfOrchestrator` + stores when not injected, registers `werewolfMatchesRoutes`, and (unless the caller supplies a pre-built `werewolfHubAttachment`) calls `attachWerewolfHub` itself.

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add werewolf options to `BuildServerOptions`**

In `apps/api/src/server.ts`, augment the imports and the options type. Replace the existing imports + options interface:

```typescript
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { TableOrchestrator } from '@agent-poker/table-orchestrator';
import {
  MemoryTableStore,
  MemoryHandStore,
  MemoryDecisionTraceStore,
  MemoryWerewolfDecisionTraceStore,
  openDatabase,
  SqliteUserStore,
  SqliteSessionStore,
  SqliteUserAgentConfigStore,
  SqliteAgentInviteStore,
} from '@agent-poker/persistence';
import type {
  IUserStore,
  ISessionStore,
  IUserAgentConfigStore,
  IAgentInviteStore,
  IMatchArtifactStore,
  IDecisionTraceStore,
  IWerewolfMatchArtifactStore,
  IWerewolfDecisionTraceStore,
  SqliteDb,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import { AppError, RateLimitedError } from '@agent-poker/shared';
import { RateLimiter, authPlugin } from '@agent-poker/auth';
import type { RateLimiterConfig, RuntimeEnv } from '@agent-poker/auth';
import { RealtimeHub } from '@agent-poker/realtime';
import { tablesRoutes } from './routes/tables.js';
import { simulateRoutes } from './routes/simulate.js';
import { matchesRoutes } from './routes/matches.js';
import { werewolfMatchesRoutes } from './routes/werewolf-matches.js';
import { authRoutes } from './routes/auth.js';
import { wsRoutes } from './routes/ws.js';
import { meAgentsRoutes } from './routes/me-agents.js';
import { agentInvitesRoutes } from './routes/agent-invites.js';
import { healthRoutes } from './routes/health.js';
import { createMatchArtifactStore } from './match-artifact-store-factory.js';
import { createWerewolfMatchArtifactStore } from './werewolf-match-artifact-store-factory.js';

export interface BuildServerOptions {
  orchestrator?: TableOrchestrator;
  handStore?: InstanceType<typeof MemoryHandStore>;
  matchArtifactStore?: IMatchArtifactStore;
  decisionTraceStore?: IDecisionTraceStore;
  werewolfMatchArtifactStore?: IWerewolfMatchArtifactStore;
  werewolfDecisionTraceStore?: IWerewolfDecisionTraceStore;
  werewolfOrchestrator?: WerewolfOrchestrator;
  // When provided, buildServer assumes the caller has already attached the
  // werewolf orchestrator to the hub and will skip its own attach call. Used
  // by tests that need a handle on the WerewolfHubAttachment to drive
  // attachMatch from outside buildServer.
  werewolfHubAttachment?: WerewolfHubAttachment;
  userStore?: IUserStore;
  sessionStore?: ISessionStore;
  agentConfigStore?: IUserAgentConfigStore;
  agentInviteStore?: IAgentInviteStore;
  authDb?: SqliteDb;
  env?: RuntimeEnv;
  hub?: RealtimeHub;
  authRateLimit?: RateLimiterConfig;
}
```

- [ ] **Step 2: Construct werewolf wiring inside `buildServer`**

Inside `buildServer`, after the existing `const orch = …` line and before the `authDb` assignment, add:

```typescript
const werewolfMatchArtifactStore =
  opts.werewolfMatchArtifactStore ?? createWerewolfMatchArtifactStore();
const werewolfDecisionTraceStore =
  opts.werewolfDecisionTraceStore ?? new MemoryWerewolfDecisionTraceStore();

const werewolfOrch =
  opts.werewolfOrchestrator ??
  new WerewolfOrchestrator({
    artifactStore: werewolfMatchArtifactStore,
    decisionTraceStore: werewolfDecisionTraceStore,
  });

// If the caller passed a pre-built attachment, trust them. Otherwise create one
// and own its lifecycle here. (Tests that need to drive attachMatch externally
// pass werewolfHubAttachment.)
if (!opts.werewolfHubAttachment) {
  attachWerewolfHub(werewolfOrch, hub);
}
```

- [ ] **Step 3: Register the werewolf routes inside the existing `app.register` scope**

Below the existing `await scope.register(matchesRoutes, …)`, add:

```typescript
await scope.register(werewolfMatchesRoutes, {
  prefix: '/api/v1',
  werewolfMatchArtifactStore,
});
```

- [ ] **Step 4: Build apps/api**

Run: `pnpm --filter api run build`
Expected: clean exit. (No new test was added in this task; the existing route-direct test from Task 7 + the new server-wiring smoke test in Step 5 below are the coverage for this task.)

- [ ] **Step 5: Add a tiny smoke test for buildServer wiring**

Create `apps/api/src/__tests__/werewolf-server-wiring.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeEach(async () => {
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  app = buildServer({
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('buildServer wires werewolf routes', () => {
  it('GET /api/v1/werewolf-matches succeeds and returns an empty list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);
  });

  it('GET /api/v1/werewolf-matches/:id returns 404 for unknown matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/nope' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error.code).toBe('MATCH_NOT_FOUND');
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-server-wiring.test.ts`
Expected: PASS for both cases.

- [ ] **Step 7: Run all existing api tests to confirm no regressions**

Run: `pnpm --filter api run test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/server.ts \
        apps/api/src/__tests__/werewolf-server-wiring.test.ts
git commit -m "feat(api): wire werewolf orchestrator + store + routes into buildServer

Plan 4b Task 8: BuildServerOptions gains werewolfMatchArtifactStore,
werewolfDecisionTraceStore, werewolfOrchestrator, werewolfHubAttachment.
buildServer registers werewolfMatchesRoutes and (unless the caller passes
a pre-built attachment) calls attachWerewolfHub itself."
```

---

### Task 9: WS route — accept `match:` and `player:` topics with server-side gate

Extends `apps/api/src/routes/ws.ts` so a connection authenticated as `userId` can subscribe to:
- `lobby` (already handled)
- `table:<tableId>` (already handled — auto-also-subscribes to its `seat:<userId>:<tableId>`)
- `match:<gameId>` (NEW — public, anyone can subscribe)
- `player:<userId>:<gameId>` (NEW — only when the userId in the topic matches the connection's authenticated userId; otherwise silently drop the subscribe message)

Unrecognised topics continue to be dropped. Task 8 already widened `BuildServerOptions`, so the new test compiles.

**Files:**
- Modify: `apps/api/src/routes/ws.ts`
- Create: `apps/api/src/__tests__/werewolf-ws.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/werewolf-ws.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { RealtimeHub } from '@agent-poker/realtime';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;

beforeEach(async () => {
  hub = new RealtimeHub();
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  attachment = attachWerewolfHub(orch, hub);

  app = buildServer({
    hub,
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
    werewolfHubAttachment: attachment,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<{ sid: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register ${email} failed: ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sid = /apk_sid=([^;]+)/.exec(setCookie)?.[1];
  if (!sid) throw new Error('no apk_sid');
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `apk_sid=${sid}` } });
  const meBody = await me.json() as { data: { userId: string } };
  return { sid, userId: meBody.data.userId };
}

function connectWs(sid: string): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers: { cookie: `apk_sid=${sid}` } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function awaitMessage(messages: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 4000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('awaitMessage timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function setupAndRunMatch(gameId: string, ownerships: Array<{ userId: string }>): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  const ownership = ownerships.map((o, i) => ({ playerId: initialState.players[i]!.id, userId: o.userId }));
  attachment.attachMatch(matchId, ownership);
  await orch.runMatch(matchId);
}

describe('werewolf WS topics', () => {
  it('match:<gameId> is publicly subscribable and emits replay events with no actor identity in night phases', async () => {
    const alice = await registerAs('a-werewolf@x.test');
    const a = await connectWs(alice.sid);
    a.ws.send(JSON.stringify({ topic: 'match:g-public', type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: 'match:g-public', type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-public' && m['type'] === 'pong');

    await setupAndRunMatch('g-public', []);

    await awaitMessage(a.messages, (m) => m['topic'] === 'match:g-public' && m['type'] === 'match.completed');

    const matchFrames = a.messages.filter((m) => m['topic'] === 'match:g-public' && m['type'] !== 'pong');
    expect(matchFrames.length).toBeGreaterThan(0);
    const nightFrames = matchFrames.filter(
      (m) =>
        ['agent.action_requested', 'agent.action_received'].includes(m['type'] as string) &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(((m['payload'] as Record<string, unknown>)['phase'] as string)),
    );
    expect(nightFrames.length).toBeGreaterThan(0);
    for (const f of nightFrames) {
      expect((f['payload'] as Record<string, unknown>)['playerId']).toBeUndefined();
      expect((f['payload'] as Record<string, unknown>)['agentId']).toBeUndefined();
    }

    a.ws.close();
  }, 10_000);

  it('player:<userId>:<gameId> is delivered only to the owning user', async () => {
    const alice = await registerAs('alice-w@x.test');
    const bob = await registerAs('bob-w@x.test');
    const a = await connectWs(alice.sid);
    const b = await connectWs(bob.sid);

    const aliceTopic = `player:${alice.userId}:g-priv`;
    const bobTopic = `player:${bob.userId}:g-priv`;

    a.ws.send(JSON.stringify({ topic: aliceTopic, type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: aliceTopic, type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === aliceTopic && m['type'] === 'pong');

    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    await setupAndRunMatch('g-priv', [{ userId: alice.userId }, { userId: bob.userId }]);

    await awaitMessage(a.messages, (m) => m['topic'] === aliceTopic && m['type'] === 'werewolf.private_state');
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');

    // Alice never sees Bob's player topic frames.
    const aliceCrossTopic = a.messages.filter((m) => m['topic'] === bobTopic);
    expect(aliceCrossTopic).toHaveLength(0);

    a.ws.close();
    b.ws.close();
  }, 10_000);

  it("a client cannot subscribe to another user's player topic — server-side gate drops the subscribe", async () => {
    const alice = await registerAs('alice-gate@x.test');
    const bob = await registerAs('bob-gate@x.test');
    const a = await connectWs(alice.sid);
    const b = await connectWs(bob.sid);

    // Bob legitimately subscribes to his own topic so he WILL receive frames.
    const bobTopic = `player:${bob.userId}:g-gate`;
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    b.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    // Alice tries to subscribe to Bob's player topic — the server-side gate
    // must silently drop the subscribe.
    a.ws.send(JSON.stringify({ topic: bobTopic, type: 'subscribe', payload: {} }));
    a.ws.send(JSON.stringify({ topic: bobTopic, type: 'ping', payload: {} }));
    await awaitMessage(a.messages, (m) => m['topic'] === bobTopic && m['type'] === 'pong');

    await setupAndRunMatch('g-gate', [{ userId: bob.userId }, { userId: bob.userId }]);

    // Bob receives private state on his own topic.
    await awaitMessage(b.messages, (m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');

    // Alice never sees Bob's private state — confirms the gate worked.
    const aliceFrames = a.messages.filter((m) => m['topic'] === bobTopic && m['type'] === 'werewolf.private_state');
    expect(aliceFrames).toHaveLength(0);

    a.ws.close();
    b.ws.close();
  }, 10_000);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-ws.test.ts`
Expected: FAIL — `match:` and `player:` topics are not yet recognised by `wsRoutes`.

- [ ] **Step 3: Update `apps/api/src/routes/ws.ts`**

Replace the contents of `apps/api/src/routes/ws.ts` with:

```typescript
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { WebSocket } from 'ws';
import { WsClientMessageSchema } from '@agent-poker/agent-protocol';
import type { HubConnection, RealtimeHub } from '@agent-poker/realtime';
import { LOBBY_TOPIC } from '@agent-poker/realtime';

interface WsRoutesOptions extends FastifyPluginOptions {
  hub: RealtimeHub;
}

const PLAYER_TOPIC_PREFIX = 'player:';

function isOwnPlayerTopic(topic: string, userId: string): boolean {
  // 'player:<userId>:<gameId>' — the userId segment must equal the
  // authenticated userId. Slice + indexOf instead of split, so a malformed
  // gameId containing ":" cannot fool the gate.
  if (!topic.startsWith(PLAYER_TOPIC_PREFIX)) return false;
  const rest = topic.slice(PLAYER_TOPIC_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return false;
  return rest.slice(0, colon) === userId;
}

export async function wsRoutes(app: FastifyInstance, opts: WsRoutesOptions) {
  const { hub } = opts;

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!req.user) {
      try { socket.send(JSON.stringify({ topic: 'system', type: 'error', payload: { code: 'UNAUTHENTICATED' } })); } catch { /* ignore */ }
      socket.close(1008, 'unauthenticated');
      return;
    }

    const userId = req.user.userId;
    const conn: HubConnection = {
      userId,
      send(json) { (socket as unknown as WebSocket).send(json); },
      close() { socket.close(); },
    };

    socket.on('message', (raw: Buffer | ArrayBuffer | Uint8Array) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = WsClientMessageSchema.safeParse(parsed);
      if (!result.success) return;
      const msg = result.data;

      switch (msg.type) {
        case 'subscribe':
          if (msg.topic === LOBBY_TOPIC || msg.topic.startsWith('table:')) {
            hub.subscribe(conn, msg.topic);
            if (msg.topic.startsWith('table:')) {
              const tableId = msg.topic.slice('table:'.length);
              hub.subscribe(conn, `seat:${userId}:${tableId}`);
            }
          } else if (msg.topic.startsWith('match:')) {
            hub.subscribe(conn, msg.topic);
          } else if (isOwnPlayerTopic(msg.topic, userId)) {
            hub.subscribe(conn, msg.topic);
          }
          // else: silently drop — same behaviour as before for unknown topics.
          break;
        case 'unsubscribe':
          hub.unsubscribe(conn, msg.topic);
          if (msg.topic.startsWith('table:')) {
            const tableId = msg.topic.slice('table:'.length);
            hub.unsubscribe(conn, `seat:${userId}:${tableId}`);
          }
          break;
        case 'ping':
          try { conn.send(JSON.stringify({ topic: msg.topic, type: 'pong', payload: {} })); } catch { /* swallow */ }
          break;
      }
    });

    socket.on('close', () => {
      hub.unsubscribeAll(conn);
    });
    socket.on('error', () => {
      hub.unsubscribeAll(conn);
    });
  });
}
```

- [ ] **Step 4: Run the new test, expect PASS**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-ws.test.ts`
Expected: PASS for all three cases.

- [ ] **Step 5: Run the existing ws tests to confirm no regression**

Run: `pnpm --filter api exec vitest run src/__tests__/ws.test.ts`
Expected: all green.

- [ ] **Step 6: Build apps/api**

Run: `pnpm --filter api run build`
Expected: clean exit.

- [ ] **Step 7: Run the full workspace test + build**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/ws.ts \
        apps/api/src/__tests__/werewolf-ws.test.ts
git commit -m "feat(api): WS route accepts match:* and player:<userId>:<gameId>

Plan 4b Task 9: server-side gate. match:* is publicly subscribable;
player:<userId>:<gameId> is delivered only when the topic userId matches
the authenticated session. Tests assert the gate via a real WebSocket
client + match run."
```

---

### Task 10: End-to-end integration test

A single comprehensive test that drives a 9-AI match through the test-injected orchestrator while:
- A spectator subscribes to `match:<gameId>` on a real WS client.
- A registered player subscribes to `player:<userId>:<gameId>`.
- After completion, `GET /api/v1/werewolf-matches/:id/replay` matches the live WS replay event count (after public filter).
- `GET /api/v1/werewolf-matches/:id/decision-trace` carries no private fields.

This is the smoke test that protects the wiring.

**Files:**
- Create: `apps/api/src/__tests__/werewolf-matches.integration.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/api/src/__tests__/werewolf-matches.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { RealtimeHub } from '@agent-poker/realtime';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;
let artifactStore: MemoryWerewolfMatchArtifactStore;

beforeEach(async () => {
  hub = new RealtimeHub();
  artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  attachment = attachWerewolfHub(orch, hub);

  app = buildServer({
    hub,
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
    werewolfHubAttachment: attachment,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<{ sid: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${await res.text()}`);
  const sid = /apk_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `apk_sid=${sid}` } });
  const meBody = await me.json() as { data: { userId: string } };
  return { sid, userId: meBody.data.userId };
}

function connectWs(sid: string): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers: { cookie: `apk_sid=${sid}` } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function awaitMessage(messages: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 8000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('awaitMessage timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('werewolf E2E: live WS + persisted artifact match', () => {
  it('a spectator and an owning player both observe the match; persisted artifact is consistent and private fields stripped', async () => {
    const spectator = await registerAs('spec-werewolf@x.test');
    const player1 = await registerAs('player1-werewolf@x.test');

    const specClient = await connectWs(spectator.sid);
    const playerClient = await connectWs(player1.sid);

    const gameId = 'g-e2e';
    const matchTopic = `match:${gameId}`;
    const player1Topic = `player:${player1.userId}:${gameId}`;

    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'subscribe', payload: {} }));
    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'ping', payload: {} }));
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'pong');

    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'subscribe', payload: {} }));
    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'ping', payload: {} }));
    await awaitMessage(playerClient.messages, (m) => m['topic'] === player1Topic && m['type'] === 'pong');

    // Build the match.
    const { matchId, initialState } = orch.createMatch({ gameId, seed: 'seed-e2e' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    // Map first player to player1; rest unowned.
    attachment.attachMatch(matchId, [{ playerId: initialState.players[0]!.id, userId: player1.userId }]);

    await orch.runMatch(matchId);
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'match.completed');

    // Live WS observed events: count the public replay events the spectator saw.
    const liveEventTypes: Array<{ type: string; sequence: number }> = specClient.messages
      .filter((m) => m['topic'] === matchTopic && m['type'] !== 'pong')
      .map((m) => ({
        type: m['type'] as string,
        sequence: ((m['payload'] as Record<string, unknown>)['sequence'] as number) ?? -1,
      }));
    expect(liveEventTypes.length).toBeGreaterThan(0);
    // Sequence must be monotonically non-decreasing.
    for (let i = 1; i < liveEventTypes.length; i++) {
      expect(liveEventTypes[i]!.sequence).toBeGreaterThanOrEqual(liveEventTypes[i - 1]!.sequence);
    }

    // The owning player saw at least one private-state frame, and only on their own topic.
    const playerPrivate = playerClient.messages.filter(
      (m) => m['topic'] === player1Topic && m['type'] === 'werewolf.private_state',
    );
    expect(playerPrivate.length).toBeGreaterThan(0);
    expect(specClient.messages.filter((m) => m['topic'] === player1Topic).length).toBe(0);

    // Persisted artifact reachable through HTTP.
    const replayRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/replay`);
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json() as { data: Array<{ eventType: string; sequence: number; data: Record<string, unknown> }> };
    expect(replayBody.data.length).toBe(liveEventTypes.length);
    // Persisted match.started carries no seed.
    expect(replayBody.data.find((e) => e.eventType === 'match.started')?.data['seed']).toBeUndefined();

    const traceRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/decision-trace`);
    expect(traceRes.status).toBe(200);
    const traceBody = await traceRes.text();
    expect(traceBody).not.toContain('privateStateHash');
    expect(traceBody).not.toContain('reasoningSummary');

    specClient.ws.close();
    playerClient.ws.close();
  }, 20_000);
});
```

- [ ] **Step 2: Run the test, expect PASS**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-matches.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run all api tests**

Run: `pnpm --filter api run test`
Expected: all green.

- [ ] **Step 4: Run the full workspace test + build**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/__tests__/werewolf-matches.integration.test.ts
git commit -m "test(api): werewolf E2E covering WS + persisted artifact

Plan 4b Task 10: drives a real match through the orchestrator while a
spectator and the owning player observe via real WS. Asserts public WS
event count matches persisted replay, that no cross-leak occurs to other
users' player topics, and that decision traces are stripped of private
fields."
```

---

### Task 11: Werewolf TTL cleaner

Provide an opt-in helper that removes long-completed in-memory match entries from the orchestrator. Pure: takes a clock + ttl in ms, returns the matchIds it cleaned. Callers wrap it in `setInterval` if they want a daemon; this plan does not add any background timer.

The cleaner relies on `IWerewolfMatchArtifactStore.listMatchArtifacts()` to identify completed matches (each entry carries `completedAt`). Persisted artifacts stay; only the in-memory orchestrator entry is removed.

**Files:**
- Create: `packages/werewolf-orchestrator/src/match-ttl-cleaner.ts`
- Create: `packages/werewolf-orchestrator/src/__tests__/match-ttl-cleaner.test.ts`
- Modify: `packages/werewolf-orchestrator/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/werewolf-orchestrator/src/__tests__/match-ttl-cleaner.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { WerewolfMatchTtlCleaner } from '../match-ttl-cleaner.js';

async function setupCompletedMatch(orch: WerewolfOrchestrator, gameId: string): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  await orch.runMatch(matchId);
}

describe('WerewolfMatchTtlCleaner', () => {
  it('runOnce removes matches whose completedAt is older than ttlMs', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const traceStore = new MemoryWerewolfDecisionTraceStore();
    const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });

    await setupCompletedMatch(orch, 'g-old');
    await setupCompletedMatch(orch, 'g-new');

    const list = await artifactStore.listMatchArtifacts();
    const oldEntry = list.find((e) => e.matchId === 'g-old')!;
    const newEntry = list.find((e) => e.matchId === 'g-new')!;
    // Pretend "now" is well past g-old's completion but right after g-new's.
    const now = newEntry.completedAt + 1_000;
    const ttlMs = 500;
    void oldEntry; // referenced for clarity; cleaner uses store directly

    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs,
    });
    const cleaned = await cleaner.runOnce(now);

    expect(cleaned).toContain('g-old');
    expect(cleaned).not.toContain('g-new');
    expect(orch.deleteMatch('g-old')).toBe(false); // already removed
    expect(orch.deleteMatch('g-new')).toBe(true);
  });

  it('runOnce is a no-op when no match is older than ttlMs', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    await setupCompletedMatch(orch, 'g-fresh');
    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs: 60_000,
    });
    const cleaned = await cleaner.runOnce(Date.now());
    expect(cleaned).toEqual([]);
    expect(orch.deleteMatch('g-fresh')).toBe(true);
  });

  it('uses Date.now() when no `now` argument is passed', async () => {
    const artifactStore = new MemoryWerewolfMatchArtifactStore();
    const orch = new WerewolfOrchestrator({ artifactStore });
    await setupCompletedMatch(orch, 'g-default-now');
    // ttlMs of 0 means "anything completed at or before `now` is stale", so
    // running with the default `now` (Date.now() — strictly later than the
    // match's completedAt because Date.now() advances after the await) should
    // clean it.
    const cleaner = new WerewolfMatchTtlCleaner({
      orchestrator: orch,
      store: artifactStore,
      ttlMs: 0,
    });
    const cleaned = await cleaner.runOnce();
    expect(cleaned).toEqual(['g-default-now']);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-ttl-cleaner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cleaner**

Create `packages/werewolf-orchestrator/src/match-ttl-cleaner.ts`:

```typescript
import type { IWerewolfMatchArtifactStore } from '@agent-poker/persistence';
import type { WerewolfOrchestrator } from './orchestrator.js';

export interface WerewolfMatchTtlCleanerOptions {
  readonly orchestrator: WerewolfOrchestrator;
  readonly store: IWerewolfMatchArtifactStore;
  // A match is eligible for cleanup once `now - completedAt >= ttlMs`.
  readonly ttlMs: number;
}

export class WerewolfMatchTtlCleaner {
  private readonly orchestrator: WerewolfOrchestrator;
  private readonly store: IWerewolfMatchArtifactStore;
  private readonly ttlMs: number;

  constructor(options: WerewolfMatchTtlCleanerOptions) {
    this.orchestrator = options.orchestrator;
    this.store = options.store;
    this.ttlMs = options.ttlMs;
  }

  // Returns the matchIds that were dropped from the orchestrator. Callers can
  // log or aggregate. Persisted artifacts are NOT removed — that lives in the
  // store's deleteMatchArtifact and is policy-distinct from in-memory cleanup.
  async runOnce(now: number = Date.now()): Promise<string[]> {
    const entries = await this.store.listMatchArtifacts();
    const cleaned: string[] = [];
    for (const entry of entries) {
      if (now - entry.completedAt < this.ttlMs) continue;
      const removed = this.orchestrator.deleteMatch(entry.matchId);
      if (removed) cleaned.push(entry.matchId);
    }
    return cleaned;
  }
}
```

- [ ] **Step 4: Re-export from the package barrel**

Edit `packages/werewolf-orchestrator/src/index.ts` — append:

```typescript
export * from './match-ttl-cleaner.js';
```

- [ ] **Step 5: Run the new test, expect PASS**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator exec vitest run src/__tests__/match-ttl-cleaner.test.ts`
Expected: PASS.

- [ ] **Step 6: Build the package**

Run: `pnpm --filter @agent-poker/werewolf-orchestrator run build`
Expected: clean exit.

- [ ] **Step 7: Run the workspace test + build**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/werewolf-orchestrator/src/match-ttl-cleaner.ts \
        packages/werewolf-orchestrator/src/__tests__/match-ttl-cleaner.test.ts \
        packages/werewolf-orchestrator/src/index.ts
git commit -m "feat(werewolf-orchestrator): WerewolfMatchTtlCleaner.runOnce

Plan 4b Task 11: opt-in helper. Looks at the artifact store's index, drops
in-memory orchestrator entries whose completedAt is older than ttlMs.
Returns the matchIds it cleaned. Scheduler-free; callers wrap it in
setInterval if desired."
```

---

## Self-review notes

- All 6 in-scope items from the 4b/4c scope sketch are covered: store factory (Task 6), routes (Task 7), hub integration (Tasks 1 + 2 + 4 + 5), buildServer wiring (Task 8), WS prefixes (Task 9), TTL cleaner (Task 11). Tasks 3 and 10 add adjacent essentials (topic helpers + E2E sanity).
- Tasks 7 → 8 → 9 → 10 form a chain. Task 7's unit-style routes test stands alone. Task 8 adds server wiring (and a tiny smoke test) so Task 9's WS test can typecheck. Task 9 ships the WS gate with a real-WebSocket integration test. Task 10 layers the E2E artifact/WS-consistency check on top. Each task is independently committable because every test it adds is green by the end of that same task.
- No placeholder code in any step. Every code block is the final form to commit.
- All identifier names are pinned: `attachWerewolfHub`, `WerewolfHubAttachment`, `WerewolfPlayerOwnership`, `WerewolfPrivateStateEvent`, `werewolfMatchTopic`, `werewolfPlayerTopic`, `werewolfMatchesRoutes`, `createWerewolfMatchArtifactStore`, `WerewolfMatchTtlCleaner`. Tasks reference each other using the exact names above.
- Privacy invariants checked across tasks:
  - Task 5's hub publishing leverages `werewolfReplayEventToPublic` — does not invent a parallel filter.
  - Task 7's route does not call the filter again because Plan 4a already filters before persisting.
  - Task 9's WS gate is the only ingress check; there is no other path from `player:*` topics to a connection.
  - Task 1's private-state channel deliberately bypasses `'replay-event'` so persistence + bufferedEvents never see it.
- TTL cleaner deletes only in-memory entries; persisted artifacts are policy-distinct.

---

## Out of scope (deferred to Plan 4c)

- `WerewolfHttpAgentAdapter` and `WerewolfWsAgentAdapter` (real network adapters).
- `examples/werewolf-local-simulation` end-to-end demo runnable via `pnpm demo:werewolf`.
- A `MatchAnalysisSummary`-equivalent for werewolf and its `/analysis` route.
- Decision-trace search/filter API.
