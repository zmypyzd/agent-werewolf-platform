# Werewolf Engine Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure-function 9-player werewolf game engine (`packages/werewolf-engine`) plus the supporting types/constants/errors in `packages/shared`, mirroring the discipline already used by `packages/poker-engine` (no I/O, no `Math.random()`, seeded RNG, full Vitest coverage). The engine must be drivable end-to-end by a deterministic test harness without any agent runtime, network, or persistence.

**Architecture:** State is an immutable `WerewolfGameState`. The engine exposes a small surface: `createGame(config)` (initial state + seeded role assignment), `applyAction(state, action)` (state machine reducer that handles all night/day phase transitions), `getValidActions(state, playerId)`, `getPublicState(state)` and `getPrivateState(state, playerId)` (the information-isolation boundary), and `checkWinCondition(state)`. All randomness flows through `createSeededRng(seed)` so a seed reproduces a full game byte-for-byte.

**Tech Stack:** TypeScript 5.5 strict (NodeNext, `.js` import suffix on relative paths), Vitest 2, pnpm workspaces. Zero external runtime deps inside this engine — only `@agent-poker/shared`.

**Reference inputs (do NOT port code):**
- `参考代码/werewolfGameAi/src/rules/{day_rules,night_rules,win_conditions}.py` — minimal day/night/win rule layout
- `参考代码/WolfMind-main/backend/core/game_engine.py`, `backend/models/{roles,schemas}.py` — productional rules + Pydantic schemas. Use as algorithmic and data-structure reference.

**Standard 9-player setup (locked for v1):**
- 3 Werewolves (`werewolf`)
- 3 Villagers (`villager`)
- 1 Seer (`seer`) — nightly divination
- 1 Witch (`witch`) — one save potion + one poison potion, may not use both same night
- 1 Hunter (`hunter`) — on death (killed at night OR banished), may shoot one alive player

---

## File Map

**Created in `packages/shared/src/`:**
- `werewolf-types.ts` — roles, sides, phases, game state, actions, history entries, public/private views
- `werewolf-constants.ts` — standard role distribution, role-to-side mapping, max PK rounds, name pool
- `werewolf-errors.ts` — `InvalidWerewolfActionError`, `WerewolfPhaseError`

**Modified in `packages/shared/src/`:**
- `index.ts` — append three new exports

**Created in `packages/werewolf-engine/`:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/index.ts` — public exports
- `src/prng.ts` — seeded RNG helpers (Fisher-Yates shuffle uses `createSeededRng`)
- `src/create-game.ts` — initial state + role assignment
- `src/valid-actions.ts` — legal actions per `(state, playerId)`
- `src/apply-action.ts` — main reducer, dispatches to phase handlers
- `src/phases.ts` — phase-transition helpers (resolve night, resolve day vote, advance to next night)
- `src/win-condition.ts` — victory check
- `src/public-state.ts` — strip private info for spectators
- `src/private-state.ts` — per-player private view
- `src/__tests__/create-game.test.ts`
- `src/__tests__/valid-actions.test.ts`
- `src/__tests__/apply-action-night.test.ts`
- `src/__tests__/apply-action-day.test.ts`
- `src/__tests__/apply-action-hunter.test.ts`
- `src/__tests__/win-condition.test.ts`
- `src/__tests__/public-private-state.test.ts`
- `src/__tests__/full-game.test.ts`
- `src/__tests__/reproducibility.test.ts`

---

## Data Model (locked here so later tasks stay consistent)

```typescript
// packages/shared/src/werewolf-types.ts

export type WerewolfRole =
  | 'werewolf'
  | 'villager'
  | 'seer'
  | 'witch'
  | 'hunter';

export type WerewolfSide = 'werewolf' | 'good';

export type WerewolfPhase =
  | 'setup'
  | 'night-werewolf-vote'
  | 'night-witch'
  | 'night-seer'
  | 'night-resolve'
  | 'day-announce'
  | 'day-speeches'
  | 'day-vote'
  | 'day-resolve'
  | 'hunter-shoot'
  | 'game-over';

export type WerewolfPlayerId = string; // canonical "p1".."p9"

export interface WerewolfPlayer {
  readonly id: WerewolfPlayerId;
  readonly seatIndex: number;          // 0..8
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WitchPotionState {
  readonly hasSave: boolean;
  readonly hasPoison: boolean;
}

export interface NightActionRecord {
  readonly werewolfTarget: WerewolfPlayerId | null;
  readonly witchSaved: WerewolfPlayerId | null;
  readonly witchPoisoned: WerewolfPlayerId | null;
  readonly seerTarget: WerewolfPlayerId | null;
  readonly seerResult: WerewolfSide | null;
}

export interface SpeechRecord {
  readonly playerId: WerewolfPlayerId;
  readonly inner: string;       // 心声 — STRIPPED in public state
  readonly performance: string; // 表现
  readonly speech: string;      // 发言
}

export interface DayVoteRecord {
  readonly votes: ReadonlyArray<{ voterId: WerewolfPlayerId; targetId: WerewolfPlayerId | null }>;
  readonly tally: Readonly<Record<WerewolfPlayerId, number>>;
  readonly banished: WerewolfPlayerId | null;
  readonly pkRound: number;     // 0 = first vote; 1..3 = PK rounds
  readonly tied: boolean;
}

export type WerewolfHistoryEntry =
  | { readonly type: 'role-assigned'; readonly playerId: WerewolfPlayerId; readonly role: WerewolfRole }
  | { readonly type: 'night-action'; readonly night: number; readonly record: NightActionRecord }
  | { readonly type: 'death'; readonly day: number; readonly playerId: WerewolfPlayerId; readonly cause: 'wolf-kill' | 'witch-poison' | 'banishment' | 'hunter-shoot' }
  | { readonly type: 'speech'; readonly day: number; readonly record: SpeechRecord }
  | { readonly type: 'vote'; readonly day: number; readonly record: DayVoteRecord }
  | { readonly type: 'hunter-shoot'; readonly shooterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId | null }
  | { readonly type: 'game-over'; readonly winner: WerewolfSide };

export interface PendingNightActions {
  // Per-werewolf vote, then majority resolves.
  readonly werewolfVotes: Readonly<Record<WerewolfPlayerId, WerewolfPlayerId>>;
  readonly witchSaved: WerewolfPlayerId | null;
  readonly witchPoisoned: WerewolfPlayerId | null;
  readonly seerTarget: WerewolfPlayerId | null;
  readonly seerResult: WerewolfSide | null;
}

export interface PendingHunterShoot {
  readonly hunterId: WerewolfPlayerId;
  readonly cause: 'wolf-kill' | 'witch-poison' | 'banishment';
}

export interface WerewolfGameState {
  readonly gameId: string;
  readonly seed: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;     // n>=1 once a night begins
  readonly dayNumber: number;       // n>=1 once a day begins
  readonly players: ReadonlyArray<WerewolfPlayer>;
  readonly witchPotions: WitchPotionState;
  readonly pendingNight: PendingNightActions;
  readonly pendingDaySpeeches: ReadonlyArray<SpeechRecord>;
  readonly pendingDayVote: DayVoteRecord | null;
  readonly pendingHunterShoot: PendingHunterShoot | null;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>;
  readonly winner: WerewolfSide | null;
}

export type WerewolfAction =
  | { readonly type: 'werewolf-vote'; readonly voterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-save'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-save' }
  | { readonly type: 'witch-poison'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'witch-skip-poison' }
  | { readonly type: 'seer-divine'; readonly targetId: WerewolfPlayerId }
  | { readonly type: 'speak'; readonly playerId: WerewolfPlayerId; readonly inner: string; readonly performance: string; readonly speech: string }
  | { readonly type: 'day-vote'; readonly voterId: WerewolfPlayerId; readonly targetId: WerewolfPlayerId | null }
  | { readonly type: 'hunter-shoot'; readonly targetId: WerewolfPlayerId | null };

export interface WerewolfPublicState {
  readonly gameId: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly players: ReadonlyArray<{
    readonly id: WerewolfPlayerId;
    readonly seatIndex: number;
    readonly name: string;
    readonly alive: boolean;
    // role intentionally omitted unless game-over
    readonly revealedRole: WerewolfRole | null;
  }>;
  readonly history: ReadonlyArray<WerewolfHistoryEntry>; // already redacted: no role-assigned, no night-action, no speech.inner
  readonly winner: WerewolfSide | null;
}

export interface WerewolfPrivateState {
  readonly selfId: WerewolfPlayerId;
  readonly selfRole: WerewolfRole;
  readonly selfSide: WerewolfSide;
  readonly knownAllies: ReadonlyArray<WerewolfPlayerId>; // werewolves only; otherwise empty
  readonly seerKnowledge: ReadonlyArray<{ readonly targetId: WerewolfPlayerId; readonly side: WerewolfSide }>;
  readonly witchView: {
    readonly potions: WitchPotionState;
    readonly currentNightKillTarget: WerewolfPlayerId | null; // populated only during night-witch phase
  } | null;
  readonly hunterCanShoot: boolean; // true only during hunter-shoot phase if self is the hunter
}
```

**Constants:**

```typescript
// packages/shared/src/werewolf-constants.ts

import type { WerewolfRole, WerewolfSide } from './werewolf-types.js';

export const WEREWOLF_TOTAL_PLAYERS = 9 as const;

export const WEREWOLF_ROLE_DISTRIBUTION: ReadonlyArray<WerewolfRole> = [
  'werewolf', 'werewolf', 'werewolf',
  'villager', 'villager', 'villager',
  'seer',
  'witch',
  'hunter',
];

export const WEREWOLF_ROLE_TO_SIDE: Readonly<Record<WerewolfRole, WerewolfSide>> = {
  werewolf: 'werewolf',
  villager: 'good',
  seer: 'good',
  witch: 'good',
  hunter: 'good',
};

export const WEREWOLF_MAX_PK_ROUNDS = 3 as const;

// Atmospheric names (deterministic order; assignment uses seeded shuffle)
export const WEREWOLF_NAME_POOL: ReadonlyArray<string> = [
  '天狼', '星辰', '明月',
  '清风', '流水', '青山',
  '先知', '灵巫', '猎手',
];
```

**Errors:**

```typescript
// packages/shared/src/werewolf-errors.ts

import { AppError } from './errors.js';

export class InvalidWerewolfActionError extends AppError {
  constructor(reason: string) { super('WEREWOLF_INVALID_ACTION', reason); }
}

export class WerewolfPhaseError extends AppError {
  constructor(reason: string) { super('WEREWOLF_WRONG_PHASE', reason); }
}
```

---

## Phase State Machine (locked here)

```
setup
  │
  ▼
night-werewolf-vote ──► night-witch ──► night-seer ──► night-resolve
                                                           │
                                                           ▼
                                              (deaths applied; if hunter died → hunter-shoot)
                                                           │
                                                           ▼
                                                    day-announce
                                                           │
                                                           ▼
                                                    day-speeches
                                                           │
                                                           ▼
                                                       day-vote ──┐ (tied & pkRound < 3) ──► day-vote (next round)
                                                           │      │
                                                           ▼      └─────────────────────────────┐
                                                      day-resolve                                │
                                                           │                                     │
                                                           ▼                                     │
                                            (banishment applied; if hunter banished → hunter-shoot)
                                                           │                                     │
                                                           ▼                                     │
                                          checkWinCondition → (game-over OR night-werewolf-vote of next night)
```

`hunter-shoot` is a transient phase: when entered, the only legal action is `{type:'hunter-shoot', targetId}`; after applying it, control returns to whatever phase `pendingHunterShoot.cause` mandates resuming (always: re-check win, then advance day-resolve → next night, OR night-resolve → day-announce).

**Information-isolation rules (must be enforced by `getPublicState` / `getPrivateState`):**

1. `role-assigned` history entries → never in public state.
2. `night-action` history entries → never in public state. Public state shows `death` entries with cause only.
3. `speech.inner` → STRIPPED in `getPublicState`. The full record stays in private state (the speaking player still sees their own inner).
4. `knownAllies` → populated only for werewolves.
5. `seerKnowledge` → only for the seer.
6. `witchView` → only for the witch (and `currentNightKillTarget` is populated only during `night-witch` phase).

---

## Task 1: Add werewolf types/constants/errors to `packages/shared`

**Files:**
- Create: `packages/shared/src/werewolf-types.ts`
- Create: `packages/shared/src/werewolf-constants.ts`
- Create: `packages/shared/src/werewolf-errors.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `werewolf-types.ts` with the full data model**

Copy the entire **Data Model** code block from this plan's preamble into `packages/shared/src/werewolf-types.ts` verbatim.

- [ ] **Step 2: Create `werewolf-constants.ts`**

Copy the **Constants** code block above into `packages/shared/src/werewolf-constants.ts` verbatim.

- [ ] **Step 3: Create `werewolf-errors.ts`**

Copy the **Errors** code block above into `packages/shared/src/werewolf-errors.ts` verbatim.

- [ ] **Step 4: Append exports to `packages/shared/src/index.ts`**

Open `packages/shared/src/index.ts` and append three lines so the file becomes:

```typescript
export * from './types.js';
export * from './constants.js';
export * from './errors.js';
export * from './werewolf-types.js';
export * from './werewolf-constants.js';
export * from './werewolf-errors.js';
```

- [ ] **Step 5: Verify shared still type-checks**

Run from repo root:
```bash
pnpm --filter @agent-poker/shared run build
```
Expected: build succeeds, `packages/shared/dist/werewolf-*.js` files exist.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/werewolf-types.ts packages/shared/src/werewolf-constants.ts packages/shared/src/werewolf-errors.ts packages/shared/src/index.ts
git commit -m "feat(shared): werewolf types, constants, errors"
```

---

## Task 2: Bootstrap `packages/werewolf-engine` package skeleton

**Files:**
- Create: `packages/werewolf-engine/package.json`
- Create: `packages/werewolf-engine/tsconfig.json`
- Create: `packages/werewolf-engine/vitest.config.ts`
- Create: `packages/werewolf-engine/src/index.ts`
- Create: `packages/werewolf-engine/src/__tests__/smoke.test.ts`

- [ ] **Step 1: Write a failing smoke test**

Create `packages/werewolf-engine/src/__tests__/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../index.js';

describe('werewolf-engine smoke', () => {
  it('exports a version constant', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Create package skeleton files**

Create `packages/werewolf-engine/package.json`:
```json
{
  "name": "@agent-poker/werewolf-engine",
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
    "@agent-poker/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Create `packages/werewolf-engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true,
    "paths": {
      "@agent-poker/shared": ["../shared/src/index.ts"]
    }
  },
  "references": [
    { "path": "../shared" }
  ],
  "include": ["src"]
}
```

Create `packages/werewolf-engine/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true } });
```

Create `packages/werewolf-engine/src/index.ts`:
```typescript
export const ENGINE_VERSION = '0.1.0';
```

- [ ] **Step 3: Install workspace links and verify build + test**

Run from repo root:
```bash
pnpm install
pnpm --filter @agent-poker/werewolf-engine run build
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: install succeeds, build succeeds, smoke test passes.

- [ ] **Step 4: Commit**

```bash
git add packages/werewolf-engine pnpm-lock.yaml
git commit -m "feat(werewolf-engine): scaffold package skeleton"
```

---

## Task 3: Implement seeded shuffle and `createGame`

**Files:**
- Create: `packages/werewolf-engine/src/prng.ts`
- Create: `packages/werewolf-engine/src/create-game.ts`
- Create: `packages/werewolf-engine/src/__tests__/create-game.test.ts`
- Modify: `packages/werewolf-engine/src/index.ts`

- [ ] **Step 1: Write failing test for `createGame`**

Create `packages/werewolf-engine/src/__tests__/create-game.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import {
  WEREWOLF_TOTAL_PLAYERS,
  WEREWOLF_ROLE_TO_SIDE,
  WEREWOLF_NAME_POOL,
} from '@agent-poker/shared';

describe('createGame', () => {
  it('returns a setup-phase state with 9 players, all alive', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.gameId).toBe('g1');
    expect(s.seed).toBe('seed-A');
    expect(s.phase).toBe('setup');
    expect(s.players.length).toBe(WEREWOLF_TOTAL_PLAYERS);
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it('assigns canonical ids p1..p9 and seat indices 0..8', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.players.map((p) => p.id)).toEqual(['p1','p2','p3','p4','p5','p6','p7','p8','p9']);
    expect(s.players.map((p) => p.seatIndex)).toEqual([0,1,2,3,4,5,6,7,8]);
  });

  it('contains exactly the standard role distribution', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const roles = s.players.map((p) => p.role).sort();
    expect(roles).toEqual([
      'hunter','seer','villager','villager','villager',
      'werewolf','werewolf','werewolf','witch',
    ]);
  });

  it('side derives correctly from role', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players) {
      expect(p.side).toBe(WEREWOLF_ROLE_TO_SIDE[p.role]);
    }
  });

  it('names come from the name pool, one each', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const names = s.players.map((p) => p.name).sort();
    expect(names).toEqual([...WEREWOLF_NAME_POOL].sort());
  });

  it('logs role-assigned history entries (one per player) and nothing else', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.history.length).toBe(WEREWOLF_TOTAL_PLAYERS);
    expect(s.history.every((e) => e.type === 'role-assigned')).toBe(true);
  });

  it('initial witch potions are both available', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s.witchPotions).toEqual({ hasSave: true, hasPoison: true });
  });

  it('same seed produces identical assignments', () => {
    const s1 = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s2 = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(s1.players).toEqual(s2.players);
    expect(s1.history).toEqual(s2.history);
  });

  it('different seeds produce different assignments', () => {
    const s1 = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s2 = createGame({ gameId: 'g1', seed: 'seed-B' });
    expect(s1.players).not.toEqual(s2.players);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/create-game.test.ts
```
Expected: FAIL — module `../create-game.js` not found.

- [ ] **Step 3: Implement seeded shuffle**

Create `packages/werewolf-engine/src/prng.ts`:
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

export function shuffle<T>(input: ReadonlyArray<T>, rng: () => number): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}
```

- [ ] **Step 4: Implement `createGame`**

Create `packages/werewolf-engine/src/create-game.ts`:
```typescript
import {
  type WerewolfGameState,
  type WerewolfPlayer,
  type WerewolfHistoryEntry,
  WEREWOLF_TOTAL_PLAYERS,
  WEREWOLF_ROLE_DISTRIBUTION,
  WEREWOLF_ROLE_TO_SIDE,
  WEREWOLF_NAME_POOL,
} from '@agent-poker/shared';
import { createSeededRng, shuffle } from './prng.js';

export interface CreateGameInput {
  readonly gameId: string;
  readonly seed: string;
}

export function createGame(input: CreateGameInput): WerewolfGameState {
  const rng = createSeededRng(`${input.seed}-roles`);
  const shuffledRoles = shuffle(WEREWOLF_ROLE_DISTRIBUTION, rng);
  const shuffledNames = shuffle(WEREWOLF_NAME_POOL, createSeededRng(`${input.seed}-names`));

  const players: WerewolfPlayer[] = [];
  const history: WerewolfHistoryEntry[] = [];
  for (let i = 0; i < WEREWOLF_TOTAL_PLAYERS; i++) {
    const role = shuffledRoles[i]!;
    const name = shuffledNames[i]!;
    const id = `p${i + 1}`;
    players.push({
      id,
      seatIndex: i,
      name,
      role,
      side: WEREWOLF_ROLE_TO_SIDE[role],
      alive: true,
    });
    history.push({ type: 'role-assigned', playerId: id, role });
  }

  return {
    gameId: input.gameId,
    seed: input.seed,
    phase: 'setup',
    nightNumber: 0,
    dayNumber: 0,
    players,
    witchPotions: { hasSave: true, hasPoison: true },
    pendingNight: { werewolfVotes: {}, witchSaved: null, witchPoisoned: null, seerTarget: null, seerResult: null },
    pendingDaySpeeches: [],
    pendingDayVote: null,
    pendingHunterShoot: null,
    history,
    winner: null,
  };
}
```

- [ ] **Step 5: Wire export and run test**

Update `packages/werewolf-engine/src/index.ts`:
```typescript
export const ENGINE_VERSION = '0.1.0';
export { createGame } from './create-game.js';
export type { CreateGameInput } from './create-game.js';
export { createSeededRng, shuffle } from './prng.js';
```

Run:
```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all 8 `createGame` tests + smoke test PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/werewolf-engine/src/prng.ts packages/werewolf-engine/src/create-game.ts packages/werewolf-engine/src/__tests__/create-game.test.ts packages/werewolf-engine/src/index.ts
git commit -m "feat(werewolf-engine): createGame with seeded role assignment"
```

---

## Task 4: Implement `getValidActions` for all phases

**Files:**
- Create: `packages/werewolf-engine/src/valid-actions.ts`
- Create: `packages/werewolf-engine/src/__tests__/valid-actions.test.ts`
- Modify: `packages/werewolf-engine/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/werewolf-engine/src/__tests__/valid-actions.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function find(state: WerewolfGameState, role: 'werewolf' | 'seer' | 'witch' | 'hunter' | 'villager') {
  return state.players.filter((p) => p.role === role);
}

function withPhase(state: WerewolfGameState, phase: WerewolfGameState['phase']): WerewolfGameState {
  return { ...state, phase };
}

describe('getValidActions', () => {
  it('setup phase: no actions for any player', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players) {
      expect(getValidActions(s, p.id)).toEqual([]);
    }
  });

  it('night-werewolf-vote: only alive werewolves may vote, targeting any alive non-werewolf', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s = withPhase({ ...base, nightNumber: 1 }, 'night-werewolf-vote');
    const wolves = find(s, 'werewolf');
    const villagers = find(s, 'villager').concat(find(s, 'seer')).concat(find(s, 'witch')).concat(find(s, 'hunter'));
    expect(wolves).toHaveLength(3);
    for (const w of wolves) {
      const acts = getValidActions(s, w.id);
      expect(acts.every((a) => a.type === 'werewolf-vote' && a.voterId === w.id)).toBe(true);
      expect(new Set(acts.map((a) => (a.type === 'werewolf-vote' ? a.targetId : '')))).toEqual(
        new Set(villagers.map((v) => v.id)),
      );
    }
    for (const v of villagers) {
      expect(getValidActions(s, v.id)).toEqual([]);
    }
  });

  it('night-witch with both potions and a kill target: save / skip-save / poison-each-alive / skip-poison', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const witch = find(base, 'witch')[0]!;
    const target = base.players.find((p) => p.role !== 'witch')!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'night-witch',
      nightNumber: 1,
      pendingNight: { ...base.pendingNight, werewolfVotes: { /* unused for legality */ } },
    };
    // Simulate that werewolf-vote already resolved into a current target via state.
    const s2 = { ...s, pendingNight: { ...s.pendingNight, werewolfVotes: { p1: target.id, p2: target.id, p3: target.id } } };
    const acts = getValidActions(s2, witch.id);
    const types = acts.map((a) => a.type);
    expect(types).toContain('witch-save');
    expect(types).toContain('witch-skip-save');
    expect(types).toContain('witch-poison');
    expect(types).toContain('witch-skip-poison');
  });

  it('night-witch with no save potion: no save action', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const witch = find(base, 'witch')[0]!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'night-witch',
      nightNumber: 1,
      witchPotions: { hasSave: false, hasPoison: true },
    };
    const acts = getValidActions(s, witch.id);
    expect(acts.some((a) => a.type === 'witch-save')).toBe(false);
    expect(acts.some((a) => a.type === 'witch-skip-save')).toBe(true);
  });

  it('night-seer: seer chooses any alive non-self target', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const seer = find(base, 'seer')[0]!;
    const s: WerewolfGameState = { ...base, phase: 'night-seer', nightNumber: 1 };
    const acts = getValidActions(s, seer.id);
    expect(acts.every((a) => a.type === 'seer-divine')).toBe(true);
    expect(acts.length).toBe(8);
  });

  it('day-speeches: only alive players whose seat is current speaker', () => {
    // Tested end-to-end in apply-action-day.test.ts; here just sanity that all alive players have a 'speak' option in day-speeches phase.
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'day-speeches', dayNumber: 1 };
    for (const p of s.players) {
      const acts = getValidActions(s, p.id);
      expect(acts.every((a) => a.type === 'speak' && a.playerId === p.id)).toBe(true);
    }
  });

  it('day-vote: alive players may vote any alive non-self target or abstain (null)', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'day-vote', dayNumber: 1, pendingDayVote: { votes: [], tally: {}, banished: null, pkRound: 0, tied: false } };
    const voter = s.players[0]!;
    const acts = getValidActions(s, voter.id);
    const targets = acts.filter((a) => a.type === 'day-vote').map((a) => (a as { targetId: string | null }).targetId);
    expect(targets).toContain(null);
    expect(targets).toContain('p2');
    expect(targets).not.toContain('p1');
  });

  it('hunter-shoot: only the pending hunter may act, targeting any alive non-self or null (no shot)', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const hunter = find(base, 'hunter')[0]!;
    const s: WerewolfGameState = {
      ...base,
      phase: 'hunter-shoot',
      pendingHunterShoot: { hunterId: hunter.id, cause: 'banishment' },
    };
    for (const p of s.players) {
      const acts = getValidActions(s, p.id);
      if (p.id === hunter.id) {
        expect(acts.length).toBeGreaterThan(0);
        expect(acts.every((a) => a.type === 'hunter-shoot')).toBe(true);
      } else {
        expect(acts).toEqual([]);
      }
    }
  });

  it('game-over: nobody acts', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s: WerewolfGameState = { ...base, phase: 'game-over', winner: 'good' };
    for (const p of s.players) {
      expect(getValidActions(s, p.id)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/valid-actions.test.ts
```
Expected: FAIL — module `../valid-actions.js` not found.

- [ ] **Step 3: Implement `getValidActions`**

Create `packages/werewolf-engine/src/valid-actions.ts`:
```typescript
import type {
  WerewolfAction,
  WerewolfGameState,
  WerewolfPlayer,
  WerewolfPlayerId,
} from '@agent-poker/shared';

function aliveNonSelf(players: ReadonlyArray<WerewolfPlayer>, selfId: WerewolfPlayerId): WerewolfPlayer[] {
  return players.filter((p) => p.alive && p.id !== selfId);
}

function aliveNonWolves(players: ReadonlyArray<WerewolfPlayer>): WerewolfPlayer[] {
  return players.filter((p) => p.alive && p.role !== 'werewolf');
}

export function getValidActions(state: WerewolfGameState, playerId: WerewolfPlayerId): WerewolfAction[] {
  const self = state.players.find((p) => p.id === playerId);
  if (!self || !self.alive) return [];

  switch (state.phase) {
    case 'setup':
    case 'night-resolve':
    case 'day-announce':
    case 'day-resolve':
    case 'game-over':
      return [];

    case 'night-werewolf-vote': {
      if (self.role !== 'werewolf') return [];
      return aliveNonWolves(state.players).map((t) => ({
        type: 'werewolf-vote',
        voterId: self.id,
        targetId: t.id,
      }));
    }

    case 'night-witch': {
      if (self.role !== 'witch') return [];
      const out: WerewolfAction[] = [];
      const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
      if (state.witchPotions.hasSave && killTarget) {
        out.push({ type: 'witch-save', targetId: killTarget });
      }
      out.push({ type: 'witch-skip-save' });
      if (state.witchPotions.hasPoison) {
        for (const t of aliveNonSelf(state.players, self.id)) {
          out.push({ type: 'witch-poison', targetId: t.id });
        }
      }
      out.push({ type: 'witch-skip-poison' });
      return out;
    }

    case 'night-seer': {
      if (self.role !== 'seer') return [];
      return aliveNonSelf(state.players, self.id).map((t) => ({
        type: 'seer-divine',
        targetId: t.id,
      }));
    }

    case 'day-speeches':
      return [{
        type: 'speak',
        playerId: self.id,
        inner: '',
        performance: '',
        speech: '',
      }];

    case 'day-vote': {
      const out: WerewolfAction[] = [{ type: 'day-vote', voterId: self.id, targetId: null }];
      for (const t of aliveNonSelf(state.players, self.id)) {
        out.push({ type: 'day-vote', voterId: self.id, targetId: t.id });
      }
      return out;
    }

    case 'hunter-shoot': {
      if (!state.pendingHunterShoot || state.pendingHunterShoot.hunterId !== self.id) return [];
      const out: WerewolfAction[] = [{ type: 'hunter-shoot', targetId: null }];
      for (const t of aliveNonSelf(state.players, self.id)) {
        out.push({ type: 'hunter-shoot', targetId: t.id });
      }
      return out;
    }
  }
}

export function computeWolfKillTarget(
  votes: Readonly<Record<WerewolfPlayerId, WerewolfPlayerId>>,
): WerewolfPlayerId | null {
  const tally: Record<WerewolfPlayerId, number> = {};
  for (const target of Object.values(votes)) {
    tally[target] = (tally[target] ?? 0) + 1;
  }
  let best: WerewolfPlayerId | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [target, count] of Object.entries(tally)) {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}
```

- [ ] **Step 4: Wire export and run test**

Update `packages/werewolf-engine/src/index.ts`:
```typescript
export const ENGINE_VERSION = '0.1.0';
export { createGame } from './create-game.js';
export type { CreateGameInput } from './create-game.js';
export { createSeededRng, shuffle } from './prng.js';
export { getValidActions, computeWolfKillTarget } from './valid-actions.js';
```

Run:
```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all `valid-actions` tests PASS, prior tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-engine/src/valid-actions.ts packages/werewolf-engine/src/__tests__/valid-actions.test.ts packages/werewolf-engine/src/index.ts
git commit -m "feat(werewolf-engine): getValidActions for all phases"
```

---

## Task 5: Implement `applyAction` — night phase reducers

**Files:**
- Create: `packages/werewolf-engine/src/phases.ts`
- Create: `packages/werewolf-engine/src/apply-action.ts`
- Create: `packages/werewolf-engine/src/__tests__/apply-action-night.test.ts`
- Modify: `packages/werewolf-engine/src/index.ts`

- [ ] **Step 1: Write failing tests for night phase reducers**

Create `packages/werewolf-engine/src/__tests__/apply-action-night.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';
import { InvalidWerewolfActionError, WerewolfPhaseError } from '@agent-poker/shared';

function setupNight(): WerewolfGameState {
  const base = createGame({ gameId: 'g1', seed: 'seed-A' });
  return startFirstNight(base);
}

function rolePlayers(s: WerewolfGameState, role: 'werewolf' | 'seer' | 'witch' | 'hunter') {
  return s.players.filter((p) => p.role === role);
}

describe('applyAction — night phase', () => {
  it('startFirstNight transitions setup → night-werewolf-vote', () => {
    const base = createGame({ gameId: 'g1', seed: 'seed-A' });
    const s = startFirstNight(base);
    expect(s.phase).toBe('night-werewolf-vote');
    expect(s.nightNumber).toBe(1);
  });

  it('werewolf-vote records each vote and transitions to night-witch when all wolves voted', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[0]!.id, targetId: target.id });
    expect(s.phase).toBe('night-werewolf-vote');
    expect(s.pendingNight.werewolfVotes[wolves[0]!.id]).toBe(target.id);
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[1]!.id, targetId: target.id });
    s = applyAction(s, { type: 'werewolf-vote', voterId: wolves[2]!.id, targetId: target.id });
    expect(s.phase).toBe('night-witch');
  });

  it('werewolf-vote rejects non-werewolf voter', () => {
    const s = setupNight();
    const villager = s.players.find((p) => p.role === 'villager')!;
    const target = s.players.find((p) => p.role === 'werewolf')!;
    expect(() =>
      applyAction(s, { type: 'werewolf-vote', voterId: villager.id, targetId: target.id }),
    ).toThrow(InvalidWerewolfActionError);
  });

  it('werewolf-vote rejects targeting another werewolf', () => {
    const s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    expect(() =>
      applyAction(s, { type: 'werewolf-vote', voterId: wolves[0]!.id, targetId: wolves[1]!.id }),
    ).toThrow(InvalidWerewolfActionError);
  });

  it('witch-skip-save then witch-skip-poison transitions to night-seer', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    expect(s.phase).toBe('night-witch');
    s = applyAction(s, { type: 'witch-skip-save' });
    expect(s.phase).toBe('night-witch'); // still witch's turn for poison decision
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
  });

  it('witch-save consumes the save potion and marks pendingNight.witchSaved', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-save', targetId: target.id });
    expect(s.witchPotions.hasSave).toBe(false);
    expect(s.pendingNight.witchSaved).toBe(target.id);
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
  });

  it('witch-save rejected when target is not the wolf-kill target', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    const other = s.players.find((p) => p.id !== target.id && p.alive)!;
    expect(() => applyAction(s, { type: 'witch-save', targetId: other.id })).toThrow(InvalidWerewolfActionError);
  });

  it('witch cannot use save+poison the same night', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const target = s.players.find((p) => p.role !== 'werewolf')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-save', targetId: target.id });
    const villager = s.players.find((p) => p.role === 'villager')!;
    expect(() => applyAction(s, { type: 'witch-poison', targetId: villager.id })).toThrow(InvalidWerewolfActionError);
  });

  it('seer-divine records seerKnowledge and advances to night-resolve', () => {
    let s = setupNight();
    const wolves = rolePlayers(s, 'werewolf');
    const wolfTarget = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: wolfTarget.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    expect(s.phase).toBe('night-seer');
    const seerCheck = wolves[0]!;
    s = applyAction(s, { type: 'seer-divine', targetId: seerCheck.id });
    // resolveNightAndAdvance runs synchronously: night-resolve → day-announce → day-speeches
    // (or hunter-shoot if hunter died at night, or game-over if win triggered).
    expect(['day-speeches', 'hunter-shoot', 'game-over']).toContain(s.phase);
    // pendingNight has been reset; check the appended night-action history entry instead.
    const lastNight = [...s.history].reverse().find((e) => e.type === 'night-action');
    expect(lastNight).toBeDefined();
    if (lastNight?.type === 'night-action') {
      expect(lastNight.record.seerTarget).toBe(seerCheck.id);
      expect(lastNight.record.seerResult).toBe('werewolf');
    }
  });

  it('rejects out-of-phase actions with WerewolfPhaseError', () => {
    const s = setupNight();
    expect(() => applyAction(s, { type: 'witch-skip-save' })).toThrow(WerewolfPhaseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/apply-action-night.test.ts
```
Expected: FAIL — modules `../apply-action.js` and `../phases.js` not found.

- [ ] **Step 3: Implement `phases.ts` (transition helpers, with dead-role auto-skip)**

Create `packages/werewolf-engine/src/phases.ts`:
```typescript
import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPlayer,
  WerewolfPlayerId,
  WerewolfRole,
  PendingNightActions,
  NightActionRecord,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import { checkWinCondition } from './win-condition.js';

function isRoleAlive(state: WerewolfGameState, role: WerewolfRole): boolean {
  return state.players.some((p) => p.alive && p.role === role);
}

export function advanceToNightWitch(state: WerewolfGameState): WerewolfGameState {
  if (isRoleAlive(state, 'witch')) return { ...state, phase: 'night-witch' };
  return advanceToNightSeer(state);
}

export function advanceToNightSeer(state: WerewolfGameState): WerewolfGameState {
  if (isRoleAlive(state, 'seer')) return { ...state, phase: 'night-seer' };
  // No seer alive → resolve night immediately.
  return resolveNightAndAdvance({ ...state, phase: 'night-resolve' });
}

export function startFirstNight(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'night-werewolf-vote',
    nightNumber: state.nightNumber + 1,
    pendingNight: emptyPendingNight(),
  };
}

export function emptyPendingNight(): PendingNightActions {
  return { werewolfVotes: {}, witchSaved: null, witchPoisoned: null, seerTarget: null, seerResult: null };
}

export function resolveNightAndAdvance(state: WerewolfGameState): WerewolfGameState {
  const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
  const { witchSaved, witchPoisoned } = state.pendingNight;
  const deaths: { id: WerewolfPlayerId; cause: 'wolf-kill' | 'witch-poison' }[] = [];

  if (killTarget && killTarget !== witchSaved) {
    deaths.push({ id: killTarget, cause: 'wolf-kill' });
  }
  if (witchPoisoned && witchPoisoned !== killTarget /* avoid double-counting */) {
    deaths.push({ id: witchPoisoned, cause: 'witch-poison' });
  }

  const players: WerewolfPlayer[] = state.players.map((p) =>
    deaths.some((d) => d.id === p.id) ? { ...p, alive: false } : p,
  );
  const dayNumber = state.dayNumber + 1;
  const history: WerewolfHistoryEntry[] = [
    ...state.history,
    {
      type: 'night-action',
      night: state.nightNumber,
      record: {
        werewolfTarget: killTarget,
        witchSaved: state.pendingNight.witchSaved,
        witchPoisoned: state.pendingNight.witchPoisoned,
        seerTarget: state.pendingNight.seerTarget,
        seerResult: state.pendingNight.seerResult,
      } satisfies NightActionRecord,
    },
    ...deaths.map((d) => ({ type: 'death' as const, day: dayNumber, playerId: d.id, cause: d.cause })),
  ];

  let next: WerewolfGameState = {
    ...state,
    phase: 'day-announce',
    dayNumber,
    players,
    history,
    pendingNight: emptyPendingNight(),
  };

  // Hunter detour: any of the deaths is the hunter? hunter shoots BEFORE day-announce.
  const hunterDeath = deaths.find((d) => state.players.find((p) => p.id === d.id)?.role === 'hunter');
  if (hunterDeath) {
    next = {
      ...next,
      phase: 'hunter-shoot',
      pendingHunterShoot: { hunterId: hunterDeath.id, cause: hunterDeath.cause },
    };
  }

  // Win check supersedes everything else.
  const winner = checkWinCondition(next);
  if (winner) {
    return {
      ...next,
      phase: 'game-over',
      winner,
      pendingHunterShoot: null,
      history: [...next.history, { type: 'game-over', winner }],
    };
  }

  // After hunter detour or directly, the day proceeds via dayAnnounceAndAdvance().
  if (next.phase === 'day-announce') {
    next = dayAnnounceAndAdvance(next);
  }
  return next;
}

export function dayAnnounceAndAdvance(state: WerewolfGameState): WerewolfGameState {
  // day-announce is a pass-through bookkeeping phase; transitions immediately to day-speeches.
  return { ...state, phase: 'day-speeches', pendingDaySpeeches: [] };
}

export function startDayVote(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'day-vote',
    pendingDayVote: { votes: [], tally: {}, banished: null, pkRound: 0, tied: false },
  };
}

export function startNextNight(state: WerewolfGameState): WerewolfGameState {
  return {
    ...state,
    phase: 'night-werewolf-vote',
    nightNumber: state.nightNumber + 1,
    pendingDaySpeeches: [],
    pendingDayVote: null,
    pendingNight: emptyPendingNight(),
  };
}
```

- [ ] **Step 4: Implement `apply-action.ts` — night branches only (day branches added in Task 6)**

Create `packages/werewolf-engine/src/apply-action.ts`:
```typescript
import {
  type WerewolfAction,
  type WerewolfGameState,
  type WerewolfPlayer,
  WEREWOLF_TOTAL_PLAYERS,
  InvalidWerewolfActionError,
  WerewolfPhaseError,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import { resolveNightAndAdvance, advanceToNightSeer, advanceToNightWitch } from './phases.js';

function findPlayer(state: WerewolfGameState, id: string): WerewolfPlayer {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new InvalidWerewolfActionError(`unknown player ${id}`);
  return p;
}

function aliveCount(state: WerewolfGameState): number {
  return state.players.filter((p) => p.alive).length;
}

function aliveWolves(state: WerewolfGameState): WerewolfPlayer[] {
  return state.players.filter((p) => p.alive && p.role === 'werewolf');
}

export function applyAction(state: WerewolfGameState, action: WerewolfAction): WerewolfGameState {
  switch (action.type) {
    case 'werewolf-vote':
      return applyWerewolfVote(state, action);
    case 'witch-save':
    case 'witch-skip-save':
    case 'witch-poison':
    case 'witch-skip-poison':
      return applyWitch(state, action);
    case 'seer-divine':
      return applySeerDivine(state, action);
    case 'speak':
    case 'day-vote':
    case 'hunter-shoot':
      throw new WerewolfPhaseError(`action ${action.type} handled in Task 6`);
  }
}

function applyWerewolfVote(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'werewolf-vote' }>,
): WerewolfGameState {
  if (state.phase !== 'night-werewolf-vote') {
    throw new WerewolfPhaseError(`cannot werewolf-vote in phase ${state.phase}`);
  }
  const voter = findPlayer(state, action.voterId);
  if (voter.role !== 'werewolf' || !voter.alive) {
    throw new InvalidWerewolfActionError(`only alive werewolves may werewolf-vote`);
  }
  const target = findPlayer(state, action.targetId);
  if (!target.alive) {
    throw new InvalidWerewolfActionError(`cannot target a dead player`);
  }
  if (target.role === 'werewolf') {
    throw new InvalidWerewolfActionError(`cannot target another werewolf`);
  }
  const next: WerewolfGameState = {
    ...state,
    pendingNight: {
      ...state.pendingNight,
      werewolfVotes: { ...state.pendingNight.werewolfVotes, [action.voterId]: action.targetId },
    },
  };
  const wolvesAlive = aliveWolves(next);
  const allVoted = wolvesAlive.every((w) => next.pendingNight.werewolfVotes[w.id] !== undefined);
  if (allVoted) {
    return advanceToNightWitch(next);
  }
  return next;
}

function applyWitch(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'witch-save' | 'witch-skip-save' | 'witch-poison' | 'witch-skip-poison' }>,
): WerewolfGameState {
  if (state.phase !== 'night-witch') {
    throw new WerewolfPhaseError(`cannot perform witch action in phase ${state.phase}`);
  }
  switch (action.type) {
    case 'witch-save': {
      if (!state.witchPotions.hasSave) throw new InvalidWerewolfActionError('save potion already used');
      if (state.pendingNight.witchSaved !== null || state.pendingNight.witchPoisoned !== null) {
        throw new InvalidWerewolfActionError('witch already acted this night');
      }
      const killTarget = computeWolfKillTarget(state.pendingNight.werewolfVotes);
      if (killTarget === null || action.targetId !== killTarget) {
        throw new InvalidWerewolfActionError('save must target the wolf-kill victim');
      }
      return {
        ...state,
        witchPotions: { ...state.witchPotions, hasSave: false },
        pendingNight: { ...state.pendingNight, witchSaved: action.targetId },
      };
    }
    case 'witch-skip-save':
      // marker only; no state change beyond moving on (pendingNight.witchSaved stays null)
      return state;
    case 'witch-poison': {
      if (!state.witchPotions.hasPoison) throw new InvalidWerewolfActionError('poison potion already used');
      if (state.pendingNight.witchSaved !== null) {
        throw new InvalidWerewolfActionError('cannot save and poison same night');
      }
      const target = findPlayer(state, action.targetId);
      if (!target.alive) throw new InvalidWerewolfActionError('cannot poison a dead player');
      return advanceToNightSeer({
        ...state,
        witchPotions: { ...state.witchPotions, hasPoison: false },
        pendingNight: { ...state.pendingNight, witchPoisoned: action.targetId },
      });
    }
    case 'witch-skip-poison':
      return advanceToNightSeer(state);
  }
}

function applySeerDivine(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'seer-divine' }>,
): WerewolfGameState {
  if (state.phase !== 'night-seer') {
    throw new WerewolfPhaseError(`cannot seer-divine in phase ${state.phase}`);
  }
  const seer = state.players.find((p) => p.role === 'seer' && p.alive);
  if (!seer) {
    // seer is dead — seer phase auto-skips; defensive throw
    throw new WerewolfPhaseError('no living seer');
  }
  const target = state.players.find((p) => p.id === action.targetId);
  if (!target || !target.alive || target.id === seer.id) {
    throw new InvalidWerewolfActionError('invalid seer target');
  }
  const next: WerewolfGameState = {
    ...state,
    phase: 'night-resolve',
    pendingNight: { ...state.pendingNight, seerTarget: target.id, seerResult: target.side },
  };
  return resolveNightAndAdvance(next);
}
```

- [ ] **Step 5: Add a stub `win-condition.ts` so `phases.ts` compiles**

Create `packages/werewolf-engine/src/win-condition.ts` (FULL implementation deferred to Task 8 — this stub returns null so night/day reducers can compile):
```typescript
import type { WerewolfGameState, WerewolfSide } from '@agent-poker/shared';

export function checkWinCondition(_state: WerewolfGameState): WerewolfSide | null {
  return null; // implemented in Task 8
}
```

- [ ] **Step 6: Wire exports**

Update `packages/werewolf-engine/src/index.ts`:
```typescript
export const ENGINE_VERSION = '0.1.0';
export { createGame } from './create-game.js';
export type { CreateGameInput } from './create-game.js';
export { createSeededRng, shuffle } from './prng.js';
export { getValidActions, computeWolfKillTarget } from './valid-actions.js';
export { applyAction } from './apply-action.js';
export {
  startFirstNight,
  advanceToNightWitch,
  advanceToNightSeer,
  resolveNightAndAdvance,
  dayAnnounceAndAdvance,
  startDayVote,
  startNextNight,
} from './phases.js';
export { checkWinCondition } from './win-condition.js';
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all night-phase tests PASS, prior tests PASS. The `seer-divine` test asserts the next phase is one of `day-announce / hunter-shoot / game-over`; with the stub, no game-over yet — `day-announce` is auto-advanced to `day-speeches`, and `hunter-shoot` only triggers if hunter happens to be the kill target. Either is allowed by the assertion.

- [ ] **Step 8: Commit**

```bash
git add packages/werewolf-engine/src/phases.ts packages/werewolf-engine/src/apply-action.ts packages/werewolf-engine/src/win-condition.ts packages/werewolf-engine/src/__tests__/apply-action-night.test.ts packages/werewolf-engine/src/index.ts
git commit -m "feat(werewolf-engine): applyAction night reducers + phase helpers"
```

---

## Task 6: Implement `applyAction` — day phase reducers

**Files:**
- Modify: `packages/werewolf-engine/src/apply-action.ts`
- Modify: `packages/werewolf-engine/src/phases.ts`
- Create: `packages/werewolf-engine/src/__tests__/apply-action-day.test.ts`

- [ ] **Step 1: Write failing tests for day phase**

Create `packages/werewolf-engine/src/__tests__/apply-action-day.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight, startDayVote } from '../phases.js';
import type { WerewolfGameState } from '@agent-poker/shared';
import { InvalidWerewolfActionError, WerewolfPhaseError } from '@agent-poker/shared';

function rushToDaySpeeches(seed = 'seed-A'): WerewolfGameState {
  // Build a state already at day-speeches, day 1, all alive (use a fully-skipped night).
  let s = createGame({ gameId: 'g1', seed });
  s = startFirstNight(s);
  const wolves = s.players.filter((p) => p.role === 'werewolf');
  const villager = s.players.find((p) => p.role === 'villager')!;
  for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
  s = applyAction(s, { type: 'witch-save', targetId: villager.id }); // fully neutralize the kill
  s = applyAction(s, { type: 'witch-skip-poison' });
  const seer = s.players.find((p) => p.role === 'seer')!;
  const someoneElse = s.players.find((p) => p.id !== seer.id)!;
  s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
  expect(s.phase).toBe('day-speeches');
  return s;
}

describe('applyAction — day phase', () => {
  it('speak appends to pendingDaySpeeches but stays in day-speeches until all alive players spoke once', () => {
    let s = rushToDaySpeeches();
    const aliveOrder = s.players.filter((p) => p.alive).map((p) => p.id);
    for (let i = 0; i < aliveOrder.length - 1; i++) {
      s = applyAction(s, { type: 'speak', playerId: aliveOrder[i]!, inner: 'i', performance: 'p', speech: 's' });
      expect(s.phase).toBe('day-speeches');
    }
    s = applyAction(s, { type: 'speak', playerId: aliveOrder[aliveOrder.length - 1]!, inner: 'i', performance: 'p', speech: 's' });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote).not.toBeNull();
  });

  it('speak rejects a player who already spoke this round', () => {
    let s = rushToDaySpeeches();
    const first = s.players.find((p) => p.alive)!;
    s = applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' });
    expect(() => applyAction(s, { type: 'speak', playerId: first.id, inner: 'i', performance: 'p', speech: 's' })).toThrow(InvalidWerewolfActionError);
  });

  it('day-vote with majority banishes; transitions through day-resolve to either next night or game-over', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const target = s.players.find((p) => p.role === 'villager')!;
    const voters = s.players.filter((p) => p.alive && p.id !== target.id);
    for (const v of voters) {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: target.id });
    }
    s = applyAction(s, { type: 'day-vote', voterId: target.id, targetId: null });
    expect(['night-werewolf-vote', 'game-over', 'hunter-shoot']).toContain(s.phase);
    expect(s.players.find((p) => p.id === target.id)!.alive).toBe(false);
  });

  it('day-vote tie triggers a PK round (still in day-vote, pkRound increments)', () => {
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const a = s.players[0]!;
    const b = s.players[1]!;
    const others = s.players.filter((p) => p.id !== a.id && p.id !== b.id && p.alive);
    // 4-4 tie split: half vote a, half vote b, the two candidates abstain
    others.slice(0, Math.floor(others.length / 2)).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: a.id });
    });
    others.slice(Math.floor(others.length / 2)).forEach((v) => {
      s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: b.id });
    });
    s = applyAction(s, { type: 'day-vote', voterId: a.id, targetId: null });
    s = applyAction(s, { type: 'day-vote', voterId: b.id, targetId: null });
    expect(s.phase).toBe('day-vote');
    expect(s.pendingDayVote!.pkRound).toBe(1);
    expect(s.pendingDayVote!.tied).toBe(true);
  });

  it('hunter-shoot fires when banished hunter shoots a target', () => {
    // Force a state where hunter is the only viable target and gets banished.
    let s = rushToDaySpeeches();
    for (const p of s.players.filter((x) => x.alive)) {
      s = applyAction(s, { type: 'speak', playerId: p.id, inner: 'i', performance: 'p', speech: 's' });
    }
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    const voters = s.players.filter((p) => p.alive && p.id !== hunter.id);
    for (const v of voters) s = applyAction(s, { type: 'day-vote', voterId: v.id, targetId: hunter.id });
    s = applyAction(s, { type: 'day-vote', voterId: hunter.id, targetId: null });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShoot!.hunterId).toBe(hunter.id);
    const wolf = s.players.find((p) => p.role === 'werewolf' && p.alive)!;
    s = applyAction(s, { type: 'hunter-shoot', targetId: wolf.id });
    expect(s.players.find((p) => p.id === wolf.id)!.alive).toBe(false);
    expect(s.pendingHunterShoot).toBeNull();
  });

  it('rejects out-of-phase day actions', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    expect(() => applyAction(s, { type: 'day-vote', voterId: 'p1', targetId: 'p2' })).toThrow(WerewolfPhaseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/apply-action-day.test.ts
```
Expected: FAIL — `speak`/`day-vote`/`hunter-shoot` branches still throw the Task 5 placeholder.

- [ ] **Step 3: Replace day-branch placeholders in `apply-action.ts`**

Open `packages/werewolf-engine/src/apply-action.ts`. Replace the `case 'speak': case 'day-vote': case 'hunter-shoot':` branch in `applyAction` with explicit dispatch:
```typescript
    case 'speak':
      return applySpeak(state, action);
    case 'day-vote':
      return applyDayVote(state, action);
    case 'hunter-shoot':
      return applyHunterShoot(state, action);
```

Add these helpers at the bottom of the file (still within the same module). Required imports at the top of `apply-action.ts` should now also include `startDayVote`, `startNextNight`, and `WEREWOLF_MAX_PK_ROUNDS`:

```typescript
import { startDayVote, startNextNight } from './phases.js';
import { WEREWOLF_MAX_PK_ROUNDS } from '@agent-poker/shared';
```

Append helpers:
```typescript
function applySpeak(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'speak' }>,
): WerewolfGameState {
  if (state.phase !== 'day-speeches') throw new WerewolfPhaseError(`cannot speak in phase ${state.phase}`);
  const speaker = findPlayer(state, action.playerId);
  if (!speaker.alive) throw new InvalidWerewolfActionError('dead players cannot speak');
  if (state.pendingDaySpeeches.some((r) => r.playerId === action.playerId)) {
    throw new InvalidWerewolfActionError('player already spoke this day');
  }
  const next: WerewolfGameState = {
    ...state,
    pendingDaySpeeches: [
      ...state.pendingDaySpeeches,
      { playerId: action.playerId, inner: action.inner, performance: action.performance, speech: action.speech },
    ],
    history: [
      ...state.history,
      { type: 'speech', day: state.dayNumber, record: { playerId: action.playerId, inner: action.inner, performance: action.performance, speech: action.speech } },
    ],
  };
  const aliveCountNow = next.players.filter((p) => p.alive).length;
  if (next.pendingDaySpeeches.length === aliveCountNow) {
    return startDayVote(next);
  }
  return next;
}

function applyDayVote(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'day-vote' }>,
): WerewolfGameState {
  if (state.phase !== 'day-vote' || !state.pendingDayVote) {
    throw new WerewolfPhaseError(`cannot day-vote in phase ${state.phase}`);
  }
  const voter = findPlayer(state, action.voterId);
  if (!voter.alive) throw new InvalidWerewolfActionError('dead players cannot vote');
  if (state.pendingDayVote.votes.some((v) => v.voterId === action.voterId)) {
    throw new InvalidWerewolfActionError('voter already cast a ballot this round');
  }
  if (action.targetId !== null) {
    const target = findPlayer(state, action.targetId);
    if (!target.alive) throw new InvalidWerewolfActionError('cannot banish a dead player');
    if (target.id === voter.id) throw new InvalidWerewolfActionError('cannot vote for self');
  }
  const updatedVotes = [...state.pendingDayVote.votes, { voterId: action.voterId, targetId: action.targetId }];
  const aliveIds = state.players.filter((p) => p.alive).map((p) => p.id);
  const everyoneVoted = updatedVotes.length === aliveIds.length;
  let next: WerewolfGameState = {
    ...state,
    pendingDayVote: { ...state.pendingDayVote, votes: updatedVotes },
  };
  if (!everyoneVoted) return next;

  // Tally
  const tally: Record<string, number> = {};
  for (const v of updatedVotes) {
    if (v.targetId) tally[v.targetId] = (tally[v.targetId] ?? 0) + 1;
  }
  let banished: string | null = null;
  let topCount = 0;
  let tied = false;
  for (const [t, c] of Object.entries(tally)) {
    if (c > topCount) { banished = t; topCount = c; tied = false; }
    else if (c === topCount) { tied = true; }
  }
  if (tied || banished === null) {
    if (state.pendingDayVote.pkRound >= WEREWOLF_MAX_PK_ROUNDS) {
      // hard tie ceiling reached → no banishment, advance straight to next night
      const finalRecord = { votes: updatedVotes, tally, banished: null, pkRound: state.pendingDayVote.pkRound + 1, tied: true };
      next = {
        ...next,
        phase: 'day-resolve',
        pendingDayVote: finalRecord,
        history: [...next.history, { type: 'vote', day: next.dayNumber, record: finalRecord }],
      };
      return advanceFromDayResolve(next);
    }
    // start another PK round
    const pkRecord = { votes: [], tally, banished: null, pkRound: state.pendingDayVote.pkRound + 1, tied: true };
    return {
      ...next,
      pendingDayVote: pkRecord,
      history: [...next.history, { type: 'vote', day: next.dayNumber, record: { votes: updatedVotes, tally, banished: null, pkRound: state.pendingDayVote.pkRound, tied: true } }],
    };
  }

  const finalRecord = { votes: updatedVotes, tally, banished, pkRound: state.pendingDayVote.pkRound, tied: false };
  next = {
    ...next,
    phase: 'day-resolve',
    pendingDayVote: finalRecord,
    history: [...next.history, { type: 'vote', day: next.dayNumber, record: finalRecord }],
  };
  return advanceFromDayResolve(next);
}

function advanceFromDayResolve(state: WerewolfGameState): WerewolfGameState {
  // Note: the resolved vote record was already appended to history by applyDayVote
  // before calling this helper. Do NOT push it again here.
  const banished = state.pendingDayVote?.banished ?? null;
  let players: WerewolfPlayer[] = state.players;
  let history = [...state.history];
  if (banished) {
    players = players.map((p) => (p.id === banished ? { ...p, alive: false } : p));
    history.push({ type: 'death', day: state.dayNumber, playerId: banished, cause: 'banishment' });
  }
  const banishedPlayer = banished ? state.players.find((p) => p.id === banished) ?? null : null;
  let next: WerewolfGameState = { ...state, players, history };
  if (banishedPlayer && banishedPlayer.role === 'hunter') {
    next = { ...next, phase: 'hunter-shoot', pendingHunterShoot: { hunterId: banishedPlayer.id, cause: 'banishment' } };
    return next;
  }
  // win check
  const winner = checkWinCondition({ ...next });
  if (winner) {
    return { ...next, phase: 'game-over', winner, history: [...next.history, { type: 'game-over', winner }] };
  }
  return startNextNight(next);
}

function applyHunterShoot(
  state: WerewolfGameState,
  action: Extract<WerewolfAction, { type: 'hunter-shoot' }>,
): WerewolfGameState {
  if (state.phase !== 'hunter-shoot' || !state.pendingHunterShoot) {
    throw new WerewolfPhaseError(`cannot hunter-shoot in phase ${state.phase}`);
  }
  const hunterId = state.pendingHunterShoot.hunterId;
  let players = state.players;
  let history = [...state.history];
  if (action.targetId !== null) {
    const target = findPlayer(state, action.targetId);
    if (!target.alive) throw new InvalidWerewolfActionError('cannot shoot a dead player');
    if (target.id === hunterId) throw new InvalidWerewolfActionError('hunter cannot shoot self');
    players = players.map((p) => (p.id === target.id ? { ...p, alive: false } : p));
    history.push({ type: 'death', day: state.dayNumber, playerId: target.id, cause: 'hunter-shoot' });
  }
  history.push({ type: 'hunter-shoot', shooterId: hunterId, targetId: action.targetId });
  let next: WerewolfGameState = { ...state, players, history, pendingHunterShoot: null };

  const winner = checkWinCondition(next);
  if (winner) {
    return { ...next, phase: 'game-over', winner, history: [...next.history, { type: 'game-over', winner }] };
  }
  // Decide where we resume: cause === 'wolf-kill' or 'witch-poison' means we were in night-resolve;
  // cause === 'banishment' means we were in day-resolve.
  if (state.pendingHunterShoot.cause === 'banishment') {
    return startNextNight(next);
  }
  // night-resolve → day-announce → day-speeches
  return { ...next, phase: 'day-speeches', pendingDaySpeeches: [] };
}
```

Also import `WerewolfPlayer` at the top of the file (already imported via the existing `findPlayer` signature — confirm it's listed in the import line).

Required final import block at top of `apply-action.ts`:
```typescript
import {
  type WerewolfAction,
  type WerewolfGameState,
  type WerewolfPlayer,
  WEREWOLF_MAX_PK_ROUNDS,
  InvalidWerewolfActionError,
  WerewolfPhaseError,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';
import {
  resolveNightAndAdvance,
  advanceToNightSeer,
  advanceToNightWitch,
  startDayVote,
  startNextNight,
} from './phases.js';
import { checkWinCondition } from './win-condition.js';
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all night + day tests PASS, prior tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-engine/src/apply-action.ts packages/werewolf-engine/src/__tests__/apply-action-day.test.ts
git commit -m "feat(werewolf-engine): applyAction day reducers (speak, vote, hunter-shoot)"
```

---

## Task 7: Hunter-shoot edge cases

**Files:**
- Create: `packages/werewolf-engine/src/__tests__/apply-action-hunter.test.ts`

The hunter logic is already implemented in Tasks 5 & 6. This task only adds focused tests on hunter-related edge cases.

- [ ] **Step 1: Write the focused tests**

Create `packages/werewolf-engine/src/__tests__/apply-action-hunter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { InvalidWerewolfActionError } from '@agent-poker/shared';

describe('hunter-shoot edge cases', () => {
  it('hunter killed at night by wolves triggers hunter-shoot before day-speeches', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    expect(s.pendingHunterShoot!.cause).toBe('wolf-kill');
  });

  it('hunter poisoned by witch does NOT trigger hunter-shoot (witch-poisoned hunter cannot shoot — house rule)', () => {
    // House rule for v1: poisoned hunter loses shot. If you prefer the rule that hunter still shoots when poisoned, change to 'witch-poison' allowed.
    // This test pins the v1 rule: poisoned hunter does NOT enter hunter-shoot phase.
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-B' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-poison', targetId: hunter.id });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.players.find((p) => p.id === hunter.id)!.alive).toBe(false);
    expect(s.phase).not.toBe('hunter-shoot');
  });

  it('hunter-shoot rejects shooting self', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    expect(() => applyAction(s, { type: 'hunter-shoot', targetId: hunter.id })).toThrow(InvalidWerewolfActionError);
  });

  it('hunter may decline to shoot (targetId=null)', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-Hunter-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const hunter = s.players.find((p) => p.role === 'hunter')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: hunter.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    expect(s.phase).toBe('hunter-shoot');
    s = applyAction(s, { type: 'hunter-shoot', targetId: null });
    expect(s.phase).not.toBe('hunter-shoot');
    expect(s.pendingHunterShoot).toBeNull();
  });
});
```

- [ ] **Step 2: Adjust apply-action so witch-poisoned hunter does not trigger hunter-shoot**

Open `packages/werewolf-engine/src/phases.ts`. In `resolveNightAndAdvance`, change the hunter-detour to only fire when `cause === 'wolf-kill'`:

```typescript
  const hunterDeath = deaths.find((d) =>
    d.cause === 'wolf-kill' && state.players.find((p) => p.id === d.id)?.role === 'hunter',
  );
```

(This is the v1 house rule pinned by the test in Step 1.)

- [ ] **Step 3: Run all tests**

```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/werewolf-engine/src/__tests__/apply-action-hunter.test.ts packages/werewolf-engine/src/phases.ts
git commit -m "feat(werewolf-engine): hunter edge cases (wolf-kill triggers shot, poison does not)"
```

---

## Task 8: Implement `checkWinCondition`

**Files:**
- Modify: `packages/werewolf-engine/src/win-condition.ts`
- Create: `packages/werewolf-engine/src/__tests__/win-condition.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/werewolf-engine/src/__tests__/win-condition.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { checkWinCondition } from '../win-condition.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function killAllWerewolves(s: WerewolfGameState): WerewolfGameState {
  return { ...s, players: s.players.map((p) => (p.role === 'werewolf' ? { ...p, alive: false } : p)) };
}

function killAllVillagers(s: WerewolfGameState): WerewolfGameState {
  return { ...s, players: s.players.map((p) => (p.role === 'villager' ? { ...p, alive: false } : p)) };
}

function killAllGods(s: WerewolfGameState): WerewolfGameState {
  return {
    ...s,
    players: s.players.map((p) => (p.role === 'seer' || p.role === 'witch' || p.role === 'hunter' ? { ...p, alive: false } : p)),
  };
}

function killWolvesUntilEqualGood(s: WerewolfGameState): WerewolfGameState {
  // Kill enough good players that wolvesAlive >= goodAlive (wolf parity rule).
  // 9 players: 3 wolves, 6 good. Kill 3 good → 3 wolves vs 3 good (equal) → wolves win.
  let killed = 0;
  return {
    ...s,
    players: s.players.map((p) => {
      if (killed >= 3 || p.role === 'werewolf') return p;
      killed++;
      return { ...p, alive: false };
    }),
  };
}

describe('checkWinCondition', () => {
  it('returns null at start of game', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    expect(checkWinCondition(s)).toBeNull();
  });

  it('returns "good" when all werewolves are dead', () => {
    const s = killAllWerewolves(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('good');
  });

  it('returns "werewolf" when all villagers are dead', () => {
    const s = killAllVillagers(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });

  it('returns "werewolf" when all gods (seer+witch+hunter) are dead', () => {
    const s = killAllGods(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });

  it('returns "werewolf" when wolves >= good (wolf parity)', () => {
    const s = killWolvesUntilEqualGood(createGame({ gameId: 'g1', seed: 'seed-A' }));
    expect(checkWinCondition(s)).toBe('werewolf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/win-condition.test.ts
```
Expected: FAIL — win-condition stub returns null in all cases.

- [ ] **Step 3: Implement `checkWinCondition`**

Replace `packages/werewolf-engine/src/win-condition.ts`:
```typescript
import type { WerewolfGameState, WerewolfSide } from '@agent-poker/shared';

export function checkWinCondition(state: WerewolfGameState): WerewolfSide | null {
  const alive = state.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === 'werewolf');
  const villagers = alive.filter((p) => p.role === 'villager');
  const gods = alive.filter((p) => p.role === 'seer' || p.role === 'witch' || p.role === 'hunter');
  const good = villagers.length + gods.length;

  if (wolves.length === 0) return 'good';
  if (villagers.length === 0) return 'werewolf';
  if (gods.length === 0) return 'werewolf';
  if (wolves.length >= good) return 'werewolf';
  return null;
}
```

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all win-condition tests PASS, prior tests still PASS (some prior tests like the rushToDaySpeeches helper now potentially produce `game-over` earlier — verify).

- [ ] **Step 5: Commit**

```bash
git add packages/werewolf-engine/src/win-condition.ts packages/werewolf-engine/src/__tests__/win-condition.test.ts
git commit -m "feat(werewolf-engine): checkWinCondition (good/wolves/parity/all-villagers/all-gods)"
```

---

## Task 9: Implement `getPublicState` and `getPrivateState`

**Files:**
- Create: `packages/werewolf-engine/src/public-state.ts`
- Create: `packages/werewolf-engine/src/private-state.ts`
- Create: `packages/werewolf-engine/src/__tests__/public-private-state.test.ts`
- Modify: `packages/werewolf-engine/src/index.ts`

- [ ] **Step 1: Write failing tests for public/private state**

Create `packages/werewolf-engine/src/__tests__/public-private-state.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getPublicState } from '../public-state.js';
import { getPrivateState } from '../private-state.js';

describe('getPublicState', () => {
  it('hides roles and role-assigned history at game start', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const pub = getPublicState(s);
    for (const p of pub.players) {
      expect(p.revealedRole).toBeNull();
    }
    expect(pub.history.find((e) => e.type === 'role-assigned')).toBeUndefined();
  });

  it('hides night-action history entries even after a night completes', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    const pub = getPublicState(s);
    expect(pub.history.find((e) => e.type === 'night-action')).toBeUndefined();
    // death is public
    expect(pub.history.some((e) => e.type === 'death' && e.playerId === villager.id)).toBe(true);
  });

  it('strips speech.inner from public history', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const t = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: t.id });
    s = applyAction(s, { type: 'witch-save', targetId: t.id });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const someoneElse = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: someoneElse.id });
    const speaker = s.players.find((p) => p.alive)!;
    s = applyAction(s, { type: 'speak', playerId: speaker.id, inner: 'SECRET-INNER', performance: 'pose', speech: 'public-speech' });
    const pub = getPublicState(s);
    const speech = pub.history.find((e) => e.type === 'speech');
    expect(speech).toBeDefined();
    if (speech?.type === 'speech') {
      expect(speech.record.inner).toBe('');
      expect(speech.record.speech).toBe('public-speech');
    }
  });

  it('reveals roles in players[].revealedRole at game-over', () => {
    // Force a game-over state by killing all wolves manually (bypass reducer).
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const ended = {
      ...s,
      phase: 'game-over' as const,
      winner: 'good' as const,
      players: s.players.map((p) => (p.role === 'werewolf' ? { ...p, alive: false } : p)),
    };
    const pub = getPublicState(ended);
    for (const p of pub.players) {
      expect(p.revealedRole).not.toBeNull();
    }
  });
});

describe('getPrivateState', () => {
  it('werewolf sees teammates in knownAllies', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    for (const w of wolves) {
      const priv = getPrivateState(s, w.id);
      expect(priv.selfRole).toBe('werewolf');
      expect(new Set(priv.knownAllies)).toEqual(new Set(wolves.filter((x) => x.id !== w.id).map((x) => x.id)));
    }
  });

  it('non-werewolves see empty knownAllies', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players.filter((x) => x.role !== 'werewolf')) {
      expect(getPrivateState(s, p.id).knownAllies).toEqual([]);
    }
  });

  it('seer accumulates seerKnowledge as they divine', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    s = applyAction(s, { type: 'witch-save', targetId: villager.id });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const target = wolves[0]!;
    s = applyAction(s, { type: 'seer-divine', targetId: target.id });
    const priv = getPrivateState(s, seer.id);
    expect(priv.seerKnowledge).toContainEqual({ targetId: target.id, side: 'werewolf' });
  });

  it('witch sees current night kill target only during night-witch phase', () => {
    let s = createGame({ gameId: 'g1', seed: 'seed-A' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const villager = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: villager.id });
    expect(s.phase).toBe('night-witch');
    const witch = s.players.find((p) => p.role === 'witch')!;
    const priv = getPrivateState(s, witch.id);
    expect(priv.witchView).not.toBeNull();
    expect(priv.witchView!.currentNightKillTarget).toBe(villager.id);
    expect(priv.witchView!.potions.hasSave).toBe(true);
  });

  it('non-witch sees witchView=null', () => {
    const s = createGame({ gameId: 'g1', seed: 'seed-A' });
    for (const p of s.players.filter((x) => x.role !== 'witch')) {
      expect(getPrivateState(s, p.id).witchView).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/public-private-state.test.ts
```
Expected: FAIL — modules `../public-state.js` and `../private-state.js` not found.

- [ ] **Step 3: Implement `public-state.ts`**

Create `packages/werewolf-engine/src/public-state.ts`:
```typescript
import type {
  WerewolfGameState,
  WerewolfHistoryEntry,
  WerewolfPublicState,
} from '@agent-poker/shared';

export function getPublicState(state: WerewolfGameState): WerewolfPublicState {
  const reveal = state.phase === 'game-over';
  return {
    gameId: state.gameId,
    phase: state.phase,
    nightNumber: state.nightNumber,
    dayNumber: state.dayNumber,
    players: state.players.map((p) => ({
      id: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      alive: p.alive,
      revealedRole: reveal ? p.role : null,
    })),
    history: state.history
      .filter((e) => e.type !== 'role-assigned' && e.type !== 'night-action')
      .map(redactSpeechInner),
    winner: state.winner,
  };
}

function redactSpeechInner(entry: WerewolfHistoryEntry): WerewolfHistoryEntry {
  if (entry.type === 'speech') {
    return { ...entry, record: { ...entry.record, inner: '' } };
  }
  return entry;
}
```

- [ ] **Step 4: Implement `private-state.ts`**

Create `packages/werewolf-engine/src/private-state.ts`:
```typescript
import type {
  WerewolfGameState,
  WerewolfPlayerId,
  WerewolfPrivateState,
} from '@agent-poker/shared';
import { computeWolfKillTarget } from './valid-actions.js';

export function getPrivateState(state: WerewolfGameState, playerId: WerewolfPlayerId): WerewolfPrivateState {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) {
    throw new Error(`unknown player ${playerId}`);
  }

  const knownAllies =
    self.role === 'werewolf'
      ? state.players.filter((p) => p.role === 'werewolf' && p.id !== self.id).map((p) => p.id)
      : [];

  const seerKnowledge =
    self.role === 'seer'
      ? state.history
          .filter((e): e is Extract<typeof e, { type: 'night-action' }> => e.type === 'night-action')
          .filter((e) => e.record.seerTarget !== null && e.record.seerResult !== null)
          .map((e) => ({ targetId: e.record.seerTarget!, side: e.record.seerResult! }))
      : [];

  const witchView =
    self.role === 'witch'
      ? {
          potions: state.witchPotions,
          currentNightKillTarget:
            state.phase === 'night-witch' ? computeWolfKillTarget(state.pendingNight.werewolfVotes) : null,
        }
      : null;

  const hunterCanShoot =
    self.role === 'hunter' &&
    state.phase === 'hunter-shoot' &&
    state.pendingHunterShoot?.hunterId === self.id;

  return {
    selfId: self.id,
    selfRole: self.role,
    selfSide: self.side,
    knownAllies,
    seerKnowledge,
    witchView,
    hunterCanShoot,
  };
}
```

- [ ] **Step 5: Wire exports and run tests**

Update `packages/werewolf-engine/src/index.ts`:
```typescript
export const ENGINE_VERSION = '0.1.0';
export { createGame } from './create-game.js';
export type { CreateGameInput } from './create-game.js';
export { createSeededRng, shuffle } from './prng.js';
export { getValidActions, computeWolfKillTarget } from './valid-actions.js';
export { applyAction } from './apply-action.js';
export {
  startFirstNight,
  advanceToNightWitch,
  advanceToNightSeer,
  resolveNightAndAdvance,
  dayAnnounceAndAdvance,
  startDayVote,
  startNextNight,
} from './phases.js';
export { checkWinCondition } from './win-condition.js';
export { getPublicState } from './public-state.js';
export { getPrivateState } from './private-state.js';
```

Run:
```bash
pnpm --filter @agent-poker/werewolf-engine run test
```
Expected: all public/private state tests PASS, prior tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/werewolf-engine/src/public-state.ts packages/werewolf-engine/src/private-state.ts packages/werewolf-engine/src/__tests__/public-private-state.test.ts packages/werewolf-engine/src/index.ts
git commit -m "feat(werewolf-engine): public/private state with information isolation"
```

---

## Task 10: Full-game replay test (deterministic 9-AI dummy strategy)

**Files:**
- Create: `packages/werewolf-engine/src/__tests__/full-game.test.ts`

This test drives a complete game using a deterministic strategy (lowest-id alive target). It exercises every phase end-to-end and pins overall behavior.

- [ ] **Step 1: Write the full-game test**

Create `packages/werewolf-engine/src/__tests__/full-game.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfAction, WerewolfGameState, WerewolfPlayerId } from '@agent-poker/shared';

function pickFirst(actions: WerewolfAction[]): WerewolfAction | null {
  return actions[0] ?? null;
}

function alivePlayers(s: WerewolfGameState) {
  return s.players.filter((p) => p.alive);
}

describe('full-game replay', () => {
  it('plays a complete 9-AI game to game-over within 200 actions', () => {
    let s = createGame({ gameId: 'g-full', seed: 'seed-Full-1' });
    s = startFirstNight(s);
    let steps = 0;
    while (s.phase !== 'game-over' && steps < 500) {
      let progressed = false;
      for (const p of alivePlayers(s)) {
        const acts = getValidActions(s, p.id);
        if (acts.length === 0) continue;
        const action = pickFirst(acts);
        if (!action) continue;
        s = applyAction(s, action);
        progressed = true;
        steps++;
        if (s.phase === 'game-over') break;
      }
      if (!progressed) break;
    }
    expect(s.phase).toBe('game-over');
    expect(['good', 'werewolf']).toContain(s.winner);
    expect(s.history[s.history.length - 1]).toMatchObject({ type: 'game-over' });
  });

  it('full game is reproducible from the same seed', () => {
    function play(seed: string): WerewolfGameState {
      let s = createGame({ gameId: 'g-rep', seed });
      s = startFirstNight(s);
      for (let steps = 0; steps < 500 && s.phase !== 'game-over'; steps++) {
        const players = alivePlayers(s);
        let progressed = false;
        for (const p of players) {
          const acts = getValidActions(s, p.id);
          if (acts.length === 0) continue;
          s = applyAction(s, acts[0]!);
          progressed = true;
          if (s.phase === 'game-over') break;
        }
        if (!progressed) break;
      }
      return s;
    }
    const a = play('seed-Repro-1');
    const b = play('seed-Repro-1');
    expect(a.winner).toBe(b.winner);
    expect(a.history.length).toBe(b.history.length);
    expect(a.players.map((p) => ({ id: p.id, role: p.role, name: p.name, alive: p.alive }))).toEqual(
      b.players.map((p) => ({ id: p.id, role: p.role, name: p.name, alive: p.alive })),
    );
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/full-game.test.ts
```
Expected: PASS — game terminates with a winner; replay determinism holds.

If the loop hits the 500-step bound without game-over, the strategy `pickFirst` may be cycling on a tie scenario; debug by logging `s.phase` and `s.pendingDayVote?.pkRound`. The PK ceiling (`WEREWOLF_MAX_PK_ROUNDS`) ensures votes always terminate.

- [ ] **Step 3: Commit**

```bash
git add packages/werewolf-engine/src/__tests__/full-game.test.ts
git commit -m "test(werewolf-engine): full-game replay & reproducibility under deterministic strategy"
```

---

## Task 11: Reproducibility regression test (cross-seed sweep)

**Files:**
- Create: `packages/werewolf-engine/src/__tests__/reproducibility.test.ts`

- [ ] **Step 1: Write the regression test**

Create `packages/werewolf-engine/src/__tests__/reproducibility.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { getValidActions } from '../valid-actions.js';
import type { WerewolfGameState } from '@agent-poker/shared';

function play(seed: string): WerewolfGameState {
  let s = createGame({ gameId: 'g', seed });
  s = startFirstNight(s);
  for (let i = 0; i < 500 && s.phase !== 'game-over'; i++) {
    let progressed = false;
    for (const p of s.players.filter((x) => x.alive)) {
      const acts = getValidActions(s, p.id);
      if (acts.length === 0) continue;
      s = applyAction(s, acts[0]!);
      progressed = true;
      if (s.phase === 'game-over') break;
    }
    if (!progressed) break;
  }
  return s;
}

describe('seed sweep', () => {
  const seeds = ['s-1','s-2','s-3','s-4','s-5','s-6','s-7','s-8'];
  it.each(seeds)('seed %s is byte-identical across runs', (seed) => {
    const a = play(seed);
    const b = play(seed);
    expect(a).toEqual(b);
  });

  it('different seeds produce at least 3 distinct outcomes (history.length variance)', () => {
    const lengths = new Set(seeds.map((s) => play(s).history.length));
    expect(lengths.size).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @agent-poker/werewolf-engine exec vitest run src/__tests__/reproducibility.test.ts
```
Expected: PASS.

- [ ] **Step 3: Run the full suite one final time**

```bash
pnpm --filter @agent-poker/werewolf-engine run test
pnpm --filter @agent-poker/werewolf-engine run build
```
Expected: all tests PASS, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/werewolf-engine/src/__tests__/reproducibility.test.ts
git commit -m "test(werewolf-engine): cross-seed reproducibility sweep"
```

---

## Task 12: Workspace integration verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full workspace build and test**

From repo root:
```bash
pnpm build
pnpm test
```
Expected: every package builds; every test passes; the new `@agent-poker/werewolf-engine` is included in the workspace report.

- [ ] **Step 2: Confirm no stray `Math.random()` or I/O snuck in**

```bash
grep -nR "Math.random" packages/werewolf-engine/src && echo "FAIL: Math.random found" || echo "ok: no Math.random"
grep -nR "console\." packages/werewolf-engine/src && echo "FAIL: console usage" || echo "ok: no console"
grep -nR "import .*from 'fs'\|require('fs')" packages/werewolf-engine/src && echo "FAIL: fs usage" || echo "ok: no fs"
```
Expected: all three lines print `ok: ...`.

- [ ] **Step 3: Confirm the spec invariants in CLAUDE.md still hold**

Open `CLAUDE.md` and re-read the "Information-isolation invariant" and "engine purity" rules. Cross-check:
- `getPublicState` strips `role-assigned` + `night-action` + `speech.inner`. ✓
- `getPrivateState` exposes `knownAllies` only for werewolves, `seerKnowledge` only for seer, `witchView` only for witch. ✓
- All randomness flows through `createSeededRng` (used only in `create-game.ts`). ✓
- No I/O / network / logging in engine code. ✓

- [ ] **Step 4: Final commit (if needed) and tag this plan as complete**

If any tweaks were needed in Step 2-3:
```bash
git add -A
git commit -m "chore(werewolf-engine): workspace verification fixes"
```

Otherwise, no commit needed; just mark Plan 1 as complete in your tracker. Plan 2 (`agent-protocol` werewolf schemas + `agent-runtime` `IAgent` generification) is the next planning task — invoke `superpowers:writing-plans` again with that scope.
