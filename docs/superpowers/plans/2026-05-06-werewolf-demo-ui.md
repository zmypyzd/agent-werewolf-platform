# Werewolf Demo UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a demo-level frontend + thin lifecycle API for the existing 9-player werewolf platform: user creates a game, fills it with NPC agents, starts it, watches the match unfold live, sees a final banner.

**Architecture:** All new code lands in two layers (`apps/api/src/routes/werewolf-games.ts` + `apps/web/src/{pages,werewolf-room}/`). The existing `WerewolfOrchestrator`, `attachWerewolfHub`, and artifact-store wiring in `apps/api/src/server.ts` are reused unchanged; the new route plugin receives them as plugin options. An in-memory `WerewolfLobbyRegistry` keeps UI-presentation metadata (seat occupancy, status, winner) that the engine/orchestrator does not own.

**Tech Stack:** TypeScript 5.5 (strict, NodeNext), Fastify 4 + Zod (server), React 18 + Vite 5 + react-router-dom (web), Vitest 2, the existing `WerewolfRandomMockAgent` from `@agent-poker/agent-runtime`.

**Reference spec:** `docs/superpowers/specs/2026-05-06-werewolf-demo-ui-design.md`

---

## File Structure

**Server (new):**
- `apps/api/src/werewolf-lobby-registry.ts` — `WerewolfLobbyRegistry` class
- `apps/api/src/routes/werewolf-games.ts` — Fastify plugin
- `apps/api/src/__tests__/werewolf-games.test.ts` — lifecycle tests
- `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts` — invariant pins

**Server (modify):**
- `packages/shared/src/werewolf-errors.ts` — add 4 error codes
- `apps/api/src/server.ts` — register the new plugin, extend status map

**Web (new):**
- `apps/web/src/werewolf-room/werewolfRoomTypes.ts`
- `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts`
- `apps/web/src/werewolf-room/werewolfRoomReducer.ts`
- `apps/web/src/werewolf-room/WerewolfPhaseIndicator.tsx`
- `apps/web/src/werewolf-room/WerewolfTableSurface.tsx`
- `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx`
- `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`
- `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`
- `apps/web/src/pages/WerewolfLobbyPage.tsx`
- `apps/web/src/pages/WerewolfRoomPage.tsx`
- `apps/web/src/__tests__/werewolf-lobby-page.test.tsx`
- `apps/web/src/__tests__/werewolf-room-page.test.tsx`

**Web (modify):**
- `apps/web/src/router.tsx` — add 2 routes
- `apps/web/src/components/AppShell.tsx` — add nav entry

---

## Naming and Type Conventions Used Throughout

These names are used in multiple tasks. Lock them in here so later tasks stay consistent.

```ts
// Lobby occupancy (server + web wire shape)
export interface WerewolfSeatInfo {
  seatIndex: number;        // 0..8
  playerId: string;         // 'p1'..'p9'  (canonical, derived seatIndex + 1)
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string };
}

export type WerewolfLobbyStatus =
  | 'waiting'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

// Full record returned by GET /werewolf-games/:id and POST /werewolf-games
export interface WerewolfLobbyEntry {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seats: WerewolfSeatInfo[];        // length 9, ordered by seatIndex
  createdAt: number;                // epoch ms
  startedAt?: number;
  completedAt?: number;
  winner?: 'good' | 'werewolf';
  failureReason?: string;
  // After completion the registry copies WerewolfFinalPlayer entries here so
  // the UI can reveal roles in the final banner without a second fetch.
  finalPlayers?: ReadonlyArray<{
    id: string;
    seatIndex: number;
    name: string;
    role: string;
    side: 'good' | 'werewolf';
    alive: boolean;
  }>;
}

// GET /werewolf-games list summary
export interface WerewolfLobbySummary {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seatedCount: number;
  createdAt: number;
}
```

---

## Task 1: Add new error codes

**Files:**
- Modify: `packages/shared/src/werewolf-errors.ts`
- Modify: `apps/api/src/server.ts` (status-code map)
- Test: covered by Task 3 lifecycle tests (no standalone test needed — error codes are pure data)

- [ ] **Step 1: Add error classes**

Append to `packages/shared/src/werewolf-errors.ts`:

```ts
export class WerewolfGameNotFoundError extends AppError {
  constructor(gameId: string) {
    super('WEREWOLF_GAME_NOT_FOUND', `Werewolf game ${gameId} not found`);
  }
}

export class WerewolfSeatOccupiedError extends AppError {
  constructor(gameId: string, seatIndex: number) {
    super(
      'WEREWOLF_SEAT_OCCUPIED',
      `Seat ${seatIndex} in game ${gameId} is already occupied`,
    );
  }
}

export class WerewolfGameNotReadyError extends AppError {
  constructor(gameId: string, currentStatus: string) {
    super(
      'WEREWOLF_GAME_NOT_READY',
      `Game ${gameId} is in status '${currentStatus}'; cannot start`,
    );
  }
}

export class WerewolfGameAlreadyStartedError extends AppError {
  constructor(gameId: string) {
    super(
      'WEREWOLF_GAME_ALREADY_STARTED',
      `Game ${gameId} has already been started`,
    );
  }
}
```

- [ ] **Step 2: Export from shared package barrel**

Verify the new classes are reachable via `@agent-poker/shared`. Open `packages/shared/src/index.ts` and confirm `werewolf-errors.js` is re-exported (it should already be — the existing `InvalidWerewolfActionError` is exported there). If it isn't, add `export * from './werewolf-errors.js';`.

- [ ] **Step 3: Add status codes to the API error handler**

Edit the `statusMap` literal in `apps/api/src/server.ts` (currently around line 128). Add four new entries alongside the existing ones:

```ts
WEREWOLF_GAME_NOT_FOUND: 404,
WEREWOLF_SEAT_OCCUPIED: 409,
WEREWOLF_GAME_NOT_READY: 409,
WEREWOLF_GAME_ALREADY_STARTED: 409,
```

- [ ] **Step 4: Build to verify types compile**

Run: `pnpm build`
Expected: `tsc -b` succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/werewolf-errors.ts apps/api/src/server.ts
# include packages/shared/src/index.ts only if Step 2 modified it
git commit -m "feat(shared,api): add werewolf-game lifecycle error codes"
```

---

## Task 2: Build `WerewolfLobbyRegistry` (TDD)

**Files:**
- Create: `apps/api/src/werewolf-lobby-registry.ts`
- Test: `apps/api/src/__tests__/werewolf-lobby-registry.test.ts`

The registry owns all UI-facing lobby metadata: seats, status, winner, final-players. It does NOT own engine/orchestrator state — it composes with the orchestrator. It also does NOT serialize `seed`: the seed enters via `create()` and never leaves.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/__tests__/werewolf-lobby-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WerewolfOrchestrator,
} from '@agent-poker/werewolf-orchestrator';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

describe('WerewolfLobbyRegistry', () => {
  let orch: WerewolfOrchestrator;
  let registry: WerewolfLobbyRegistry;

  beforeEach(() => {
    orch = new WerewolfOrchestrator();
    registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
    });
  });

  it('creates a game with 9 empty seats and waiting status', () => {
    const entry = registry.create({ name: 'demo' });
    expect(entry.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.name).toBe('demo');
    expect(entry.status).toBe('waiting');
    expect(entry.seats).toHaveLength(9);
    expect(entry.seats.every((s, i) => s.seatIndex === i && s.playerId === `p${i + 1}`)).toBe(true);
    expect(entry.seats.every(s => s.occupant.kind === 'empty')).toBe(true);
  });

  it('never exposes seed in the returned entry', () => {
    const entry = registry.create({ name: 'demo', seed: 'top-secret' });
    expect(JSON.stringify(entry)).not.toContain('top-secret');
    expect(JSON.stringify(entry)).not.toContain('seed');
  });

  it('inviteNpc fills exactly one seat and registers an agent with the orchestrator', () => {
    const entry = registry.create({ name: 'demo', seed: 'fixed' });
    const updated = registry.inviteNpc(entry.gameId, 0);
    const seat = updated.seats[0]!;
    expect(seat.occupant.kind).toBe('npc');
    if (seat.occupant.kind === 'npc') {
      expect(seat.occupant.agentId).toBe('agent-p1');
      expect(typeof seat.occupant.displayName).toBe('string');
    }
    // Other 8 seats stay empty
    expect(updated.seats.slice(1).every(s => s.occupant.kind === 'empty')).toBe(true);
    // status transitions to 'ready' only when 9/9 filled
    expect(updated.status).toBe('waiting');
  });

  it('inviteNpc rejects an occupied seat', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 3);
    expect(() => registry.inviteNpc(gameId, 3)).toThrowError(/SEAT_OCCUPIED/);
  });

  it('inviteNpc rejects an unknown game', () => {
    expect(() => registry.inviteNpc('nope', 0)).toThrowError(/GAME_NOT_FOUND/);
  });

  it('fillWithNpcs fills any remaining empty seats and flips to ready', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 4);
    const updated = registry.fillWithNpcs(gameId);
    expect(updated.status).toBe('ready');
    expect(updated.seats.every(s => s.occupant.kind === 'npc')).toBe(true);
  });

  it('fillWithNpcs is idempotent on a full table', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.fillWithNpcs(gameId);
    const second = registry.fillWithNpcs(gameId);
    expect(second.status).toBe('ready');
  });

  it('start rejects when not ready', () => {
    const { gameId } = registry.create({ name: 'demo' });
    expect(() => registry.start(gameId)).toThrowError(/NOT_READY/);
  });

  it('start flips status to running and calls attachMatch', async () => {
    const attachMatch = vi.fn();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: new WerewolfOrchestrator(),
      attachMatch,
      detachMatch: vi.fn(),
    });
    const { gameId } = reg.create({ name: 'demo', seed: 'fixed' });
    reg.fillWithNpcs(gameId);
    reg.start(gameId);
    const after = reg.get(gameId)!;
    expect(after.status).toBe('running');
    expect(attachMatch).toHaveBeenCalledWith(gameId, []);
  });

  it('list returns summaries (no seats[]) sorted recent-first', async () => {
    registry.create({ name: 'a' });
    await new Promise(r => setTimeout(r, 1));
    registry.create({ name: 'b' });
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('b');
    // SeatedCount derived
    expect(list[0]!.seatedCount).toBe(0);
    expect((list[0] as Record<string, unknown>).seats).toBeUndefined();
  });

  it('records winner + finalPlayers when the orchestrator completes', async () => {
    // Real orchestrator + real random NPCs run a full match deterministically.
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
    });
    const { gameId } = reg.create({ name: 'real', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gameId);
    const promise = reg.start(gameId);
    await promise;                              // start() returns the run-promise for tests
    const after = reg.get(gameId)!;
    expect(after.status).toBe('completed');
    expect(after.winner).toMatch(/good|werewolf/);
    expect(after.finalPlayers).toHaveLength(9);
    expect(after.completedAt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-lobby-registry.test.ts`
Expected: FAIL — `WerewolfLobbyRegistry` cannot be imported.

- [ ] **Step 3: Implement the registry**

Create `apps/api/src/werewolf-lobby-registry.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import {
  WerewolfGameNotFoundError,
  WerewolfSeatOccupiedError,
  WerewolfGameNotReadyError,
  WerewolfGameAlreadyStartedError,
} from '@agent-poker/shared';
import type { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';

export type WerewolfLobbyStatus =
  | 'waiting'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

export interface WerewolfSeatInfo {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string };
}

export interface WerewolfFinalPlayerView {
  id: string;
  seatIndex: number;
  name: string;
  role: string;
  side: 'good' | 'werewolf';
  alive: boolean;
}

export interface WerewolfLobbyEntry {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seats: WerewolfSeatInfo[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: 'good' | 'werewolf';
  failureReason?: string;
  finalPlayers?: ReadonlyArray<WerewolfFinalPlayerView>;
}

export interface WerewolfLobbySummary {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seatedCount: number;
  createdAt: number;
}

export interface WerewolfLobbyRegistryOptions {
  orchestrator: WerewolfOrchestrator;
  attachMatch: (gameId: string, ownership: ReadonlyArray<{ playerId: string; userId: string }>) => void;
  detachMatch: (gameId: string) => void;
}

interface InternalEntry extends WerewolfLobbyEntry {
  seed: string;          // private; never serialized to clients
}

const TOTAL_SEATS = 9;

function emptySeats(): WerewolfSeatInfo[] {
  return Array.from({ length: TOTAL_SEATS }, (_, i) => ({
    seatIndex: i,
    playerId: `p${i + 1}`,
    occupant: { kind: 'empty' as const },
  }));
}

function publicEntry(entry: InternalEntry): WerewolfLobbyEntry {
  // Defense-in-depth: explicit destructure-and-omit prevents future fields like
  // `seed` from leaking via spread.
  const { seed: _seed, ...rest } = entry;
  return rest;
}

export class WerewolfLobbyRegistry {
  private readonly entries = new Map<string, InternalEntry>();
  private readonly runPromises = new Map<string, Promise<void>>();

  constructor(private readonly options: WerewolfLobbyRegistryOptions) {}

  create(input: { name?: string; seed?: string }): WerewolfLobbyEntry {
    const gameId = randomUUID();
    const seed = input.seed ?? randomUUID();
    const name = input.name && input.name.trim().length > 0 ? input.name : `Game ${gameId.slice(0, 8)}`;
    this.options.orchestrator.createMatch({ gameId, seed });
    const entry: InternalEntry = {
      gameId,
      name,
      status: 'waiting',
      seats: emptySeats(),
      createdAt: Date.now(),
      seed,
    };
    this.entries.set(gameId, entry);
    return publicEntry(entry);
  }

  get(gameId: string): WerewolfLobbyEntry | undefined {
    const entry = this.entries.get(gameId);
    return entry ? publicEntry(entry) : undefined;
  }

  list(): WerewolfLobbySummary[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map(e => ({
        gameId: e.gameId,
        name: e.name,
        status: e.status,
        seatedCount: e.seats.filter(s => s.occupant.kind === 'npc').length,
        createdAt: e.createdAt,
      }));
  }

  inviteNpc(gameId: string, seatIndex: number, displayName?: string): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    const seat = entry.seats[seatIndex];
    if (!seat) {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    if (seat.occupant.kind !== 'empty') {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    const playerId = seat.playerId;
    const agentId = `agent-${playerId}`;
    const finalDisplayName = displayName?.trim() || `Bot ${seatIndex + 1}`;
    const agent = new WerewolfRandomMockAgent(agentId, finalDisplayName, { seed: entry.seed });
    this.options.orchestrator.registerAgent(gameId, playerId, agent);
    entry.seats[seatIndex] = {
      seatIndex,
      playerId,
      occupant: { kind: 'npc', agentId, displayName: finalDisplayName },
    };
    if (entry.seats.every(s => s.occupant.kind === 'npc')) {
      entry.status = 'ready';
    }
    return publicEntry(entry);
  }

  fillWithNpcs(gameId: string): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    if (entry.status === 'ready') return publicEntry(entry);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    for (let i = 0; i < TOTAL_SEATS; i++) {
      if (entry.seats[i]!.occupant.kind === 'empty') {
        this.inviteNpc(gameId, i);
      }
    }
    return publicEntry(entry);
  }

  start(gameId: string): Promise<void> {
    const entry = this.requireEntry(gameId);
    if (entry.status === 'running' || entry.status === 'completed') {
      throw new WerewolfGameAlreadyStartedError(gameId);
    }
    if (entry.status !== 'ready') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    entry.status = 'running';
    entry.startedAt = Date.now();
    this.options.attachMatch(gameId, []);
    const promise = this.options.orchestrator.runMatch(gameId).then(
      summary => {
        entry.status = 'completed';
        entry.completedAt = summary.completedAt;
        entry.winner = summary.winner;
        entry.finalPlayers = summary.finalPlayers.map(p => ({
          id: p.id,
          seatIndex: p.seatIndex,
          name: p.name,
          role: p.role,
          side: p.side,
          alive: p.alive,
        }));
        this.options.detachMatch(gameId);
      },
      err => {
        entry.status = 'failed';
        entry.completedAt = Date.now();
        entry.failureReason = err instanceof Error ? err.message : String(err);
        this.options.detachMatch(gameId);
      },
    );
    this.runPromises.set(gameId, promise);
    return promise;
  }

  private requireEntry(gameId: string): InternalEntry {
    const entry = this.entries.get(gameId);
    if (!entry) throw new WerewolfGameNotFoundError(gameId);
    return entry;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-lobby-registry.test.ts`
Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/werewolf-lobby-registry.ts apps/api/src/__tests__/werewolf-lobby-registry.test.ts
git commit -m "feat(api): add WerewolfLobbyRegistry for demo lobby state"
```

---

## Task 3: Build `werewolf-games` Fastify plugin (TDD)

**Files:**
- Create: `apps/api/src/routes/werewolf-games.ts`
- Test: `apps/api/src/__tests__/werewolf-games.test.ts`

This plugin exposes the 6 lifecycle endpoints. Public (no `requireAuth`); mutating routes use `requireCsrf`.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/__tests__/werewolf-games.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function inject(method: string, url: string, body?: unknown) {
    return app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      ...(body !== undefined ? { payload: body } : {}),
    });
  }

  it('POST /werewolf-games creates a waiting game with 9 empty seats', async () => {
    const res = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe('waiting');
    expect(data.seats).toHaveLength(9);
    expect(data.seats.every((s: { occupant: { kind: string } }) => s.occupant.kind === 'empty')).toBe(true);
  });

  it('GET /werewolf-games lists created games', async () => {
    await inject('POST', '/api/v1/werewolf-games', { name: 'a' });
    await inject('POST', '/api/v1/werewolf-games', { name: 'b' });
    const res = await inject('GET', '/api/v1/werewolf-games');
    const { data } = res.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('b');           // sorted recent-first
    expect(data[0].seatedCount).toBe(0);
    expect(data[0].seats).toBeUndefined();    // summary, not full entry
  });

  it('GET /werewolf-games/:id returns full lobby entry', async () => {
    const created = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = created.json().data as { gameId: string };
    const res = await inject('GET', `/api/v1/werewolf-games/${gameId}`);
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.gameId).toBe(gameId);
    expect(data.seats).toHaveLength(9);
  });

  it('GET /werewolf-games/:id 404s for unknown ids', async () => {
    const res = await inject('GET', '/api/v1/werewolf-games/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('WEREWOLF_GAME_NOT_FOUND');
  });

  it('POST /seats/:i/invite-npc occupies one seat', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`, {});
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.seats[0].occupant.kind).toBe('npc');
    expect(data.seats.slice(1).every((s: { occupant: { kind: string } }) => s.occupant.kind === 'empty')).toBe(true);
    expect(data.status).toBe('waiting');
  });

  it('POST invite-npc on occupied seat returns 409', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    await inject('POST', `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`, {});
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WEREWOLF_SEAT_OCCUPIED');
  });

  it('POST /fill-with-npcs flips status to ready', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    const { data } = res.json();
    expect(data.status).toBe('ready');
    expect(data.seats.every((s: { occupant: { kind: string } }) => s.occupant.kind === 'npc')).toBe(true);
  });

  it('POST /start before ready returns 409', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/start`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WEREWOLF_GAME_NOT_READY');
  });

  it('POST /start after fill returns 202 and flips to running', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo', seed: 'werewolf-seed-001' });
    const { gameId } = c.json().data;
    await inject('POST', `/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/start`, {});
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe('running');
  });

  it('POST without X-Requested-With header is rejected by CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/werewolf-games',
      headers: { 'Content-Type': 'application/json' },
      payload: { name: 'demo' },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-games.test.ts`
Expected: FAIL — endpoints not yet registered (404s on every call).

- [ ] **Step 3: Implement the route plugin**

Create `apps/api/src/routes/werewolf-games.ts`:

```ts
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z, ZodError } from 'zod';
import { SchemaValidationError } from '@agent-poker/shared';
import type { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

interface WerewolfGamesPluginOptions extends FastifyPluginOptions {
  registry: WerewolfLobbyRegistry;
}

const CreateGameBody = z.object({
  name: z.string().max(100).optional(),
  seed: z.string().max(100).optional(),
});

const InviteNpcBody = z
  .object({
    displayName: z.string().min(1).max(50).optional(),
  })
  .strict();

const SeatParams = z.object({
  gameId: z.string().min(1),
  seatIndex: z.coerce.number().int().min(0).max(8),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body ?? {});
  } catch (e) {
    if (e instanceof ZodError) throw new SchemaValidationError(e.message);
    throw e;
  }
}

export async function werewolfGamesRoutes(
  app: FastifyInstance,
  opts: WerewolfGamesPluginOptions,
) {
  const { registry } = opts;

  // POST /werewolf-games
  app.post('/werewolf-games', { preHandler: [app.requireCsrf] }, async (req, reply) => {
    const body = parseBody(CreateGameBody, req.body);
    const entry = registry.create(body);
    reply.status(201).send({ data: entry });
  });

  // GET /werewolf-games
  app.get('/werewolf-games', async (_req, reply) => {
    reply.send({ data: registry.list() });
  });

  // GET /werewolf-games/:gameId
  app.get<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId',
    async (req, reply) => {
      const entry = registry.get(req.params.gameId);
      if (!entry) {
        // Throw the typed error so the global handler maps it to 404.
        const { WerewolfGameNotFoundError } = await import('@agent-poker/shared');
        throw new WerewolfGameNotFoundError(req.params.gameId);
      }
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/seats/:seatIndex/invite-npc
  app.post<{ Params: { gameId: string; seatIndex: string } }>(
    '/werewolf-games/:gameId/seats/:seatIndex/invite-npc',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      const { gameId, seatIndex } = parseBody(SeatParams, req.params);
      const body = parseBody(InviteNpcBody, req.body);
      const entry = registry.inviteNpc(gameId, seatIndex, body.displayName);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/fill-with-npcs
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/fill-with-npcs',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      const entry = registry.fillWithNpcs(req.params.gameId);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/start
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/start',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      // start() returns the run-promise; we deliberately do NOT await it —
      // the route returns 202 immediately and the match drives WS events.
      // Errors during run land in the registry's internal handler and flip
      // status to 'failed'. We do attach a no-op catch so unhandled rejection
      // warnings don't fire if no test awaits the promise.
      const promise = registry.start(req.params.gameId);
      promise.catch(() => { /* recorded in registry */ });
      const entry = registry.get(req.params.gameId)!;
      reply.status(202).send({ data: entry });
    },
  );
}
```

- [ ] **Step 4: Wire the plugin in `server.ts`**

Edit `apps/api/src/server.ts`. After the `werewolfHubAttachment` is created (around line 178) and before the `await scope.register(...)` block:

```ts
import { WerewolfLobbyRegistry } from './werewolf-lobby-registry.js';
import { werewolfGamesRoutes } from './routes/werewolf-games.js';
```

Construct the registry alongside the existing wiring. Place this immediately after the `werewolfHubAttachment` assignment and before the `app.addHook('onClose', ...)` call:

```ts
const werewolfLobbyRegistry =
  opts.werewolfLobbyRegistry ??
  new WerewolfLobbyRegistry({
    orchestrator: werewolfOrch,
    attachMatch: (gameId, ownership) => werewolfHubAttachment.attachMatch(gameId, ownership),
    detachMatch: (gameId) => werewolfHubAttachment.detachMatch(gameId),
  });
```

Add an `opts` field for test injection. Locate the `BuildServerOptions` interface (around line 49) and add:

```ts
werewolfLobbyRegistry?: WerewolfLobbyRegistry;
```

Inside the `app.register(async (scope) => { ... })` block, register the new plugin alongside `werewolfMatchesRoutes`:

```ts
await scope.register(werewolfGamesRoutes, {
  prefix: '/api/v1',
  registry: werewolfLobbyRegistry,
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-games.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 6: Run the full API test suite to confirm no regression**

Run: `pnpm --filter api run test`
Expected: PASS, no regressions in existing werewolf-matches / matches / tables / etc tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/werewolf-games.ts apps/api/src/server.ts apps/api/src/__tests__/werewolf-games.test.ts
git commit -m "feat(api): werewolf-games lifecycle endpoints"
```

---

## Task 4: Info-isolation pin tests

**Files:**
- Test: `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`

Pin the two protected outputs: `seed` never appears, role/side never appears in pre-completion seat metadata.

- [ ] **Step 1: Write the tests**

Create `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games info isolation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function post(url: string, body: unknown) {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      payload: body,
    });
  }

  async function get(url: string) {
    return app.inject({ method: 'GET', url });
  }

  it('POST /werewolf-games never echoes seed even when supplied', async () => {
    const res = await post('/api/v1/werewolf-games', { name: 'iso', seed: 'leak-me' });
    const text = res.body;
    expect(text).not.toContain('leak-me');
    expect(text).not.toContain('"seed"');
  });

  it('GET /werewolf-games/:id never includes seed', async () => {
    const created = await post('/api/v1/werewolf-games', { name: 'iso', seed: 'leak-me' });
    const { gameId } = created.json().data;
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    expect(res.body).not.toContain('leak-me');
    expect(res.body).not.toContain('"seed"');
  });

  it('seat info never carries role or side fields before completion', async () => {
    const created = await post('/api/v1/werewolf-games', { name: 'iso' });
    const { gameId } = created.json().data;
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    const { data } = res.json();
    for (const seat of data.seats) {
      expect(seat).not.toHaveProperty('role');
      expect(seat).not.toHaveProperty('side');
      expect(seat.occupant).not.toHaveProperty('role');
      expect(seat.occupant).not.toHaveProperty('side');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter api exec vitest run src/__tests__/werewolf-games-info-isolation.test.ts`
Expected: all 3 tests PASS (the registry's destructure-omit already does the work).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/werewolf-games-info-isolation.test.ts
git commit -m "test(api): pin werewolf-games seed/role info isolation"
```

---

## Task 5: Web `werewolf-room` types

**Files:**
- Create: `apps/web/src/werewolf-room/werewolfRoomTypes.ts`

Define the types used by the reducer, normalizer, and components. No tests yet — pure type declarations.

- [ ] **Step 1: Create the types file**

```ts
import type { WerewolfPhase, WerewolfRole, WerewolfSide } from '@agent-poker/shared';

// Mirrors the server's `WerewolfSeatInfo` shape.
export interface SeatVM {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string };
  alive: boolean;                    // always true during running; reflects finalPlayers post-completion
  revealedRole?: WerewolfRole;       // populated only when game is over
  revealedSide?: WerewolfSide;
}

export type WerewolfTimelineLineKind =
  | 'system'
  | 'phase-day'
  | 'phase-night'
  | 'speak'
  | 'vote'
  | 'system-night-fold'   // collapsed "🌙 夜 N · 行动中…" line
  | 'completion';

export interface WerewolfTimelineLine {
  id: string;                        // stable key for React (use eventId where possible)
  kind: WerewolfTimelineLineKind;
  text: string;                      // human-readable label
  timestamp: number;                 // ms
}

export interface WerewolfRoomState {
  gameId: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: SeatVM[];                   // length 9
  currentPhase: WerewolfPhase | 'pre-match' | 'completed';
  dayNumber: number;
  nightNumber: number;
  currentActor?: string;             // playerId; ONLY set during day-* phases (info isolation)
  timeline: WerewolfTimelineLine[];
  winner?: WerewolfSide;
  failureReason?: string;
}

export function emptyRoomState(gameId: string): WerewolfRoomState {
  return {
    gameId,
    status: 'waiting',
    seats: Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'empty' as const },
      alive: true,
    })),
    currentPhase: 'pre-match',
    dayNumber: 0,
    nightNumber: 0,
    timeline: [],
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter web run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/werewolf-room/werewolfRoomTypes.ts
git commit -m "feat(web): werewolf-room types"
```

---

## Task 6: `normalizeWerewolfReplayEvent` (TDD)

**Files:**
- Create: `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts`
- Test: `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`

Pure function: takes a `WerewolfReplayEvent` plus the current per-seat name index, returns a `WerewolfTimelineLine` describing it. The reducer (Task 7) calls this for each event.

The night-actor info-isolation invariant is structurally guaranteed: `werewolfReplayEventToPublic` already strips `playerId`/`agentId` from `agent.action_*` events in night phases before they reach the WS, so for those events `data.playerId` is undefined and we cannot accidentally name a night actor.

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeWerewolfReplayEvent } from '../normalizeWerewolfReplayEvent.js';
import type { WerewolfReplayEvent } from '@agent-poker/shared';

const NAME_INDEX: Record<string, string> = {
  p1: 'Bot 1', p2: 'Bot 2', p3: 'Bot 3', p4: 'Bot 4',
  p5: 'Bot 5', p6: 'Bot 6', p7: 'Bot 7', p8: 'Bot 8', p9: 'Bot 9',
};

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: 'eid',
    gameId: 'g',
    sequence: 0,
    eventType: 'engine.action_applied',
    timestamp: 0,
    data: {},
    ...partial,
  } as WerewolfReplayEvent;
}

describe('normalizeWerewolfReplayEvent', () => {
  it('match.started → "对局开始"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({ eventType: 'match.started', timestamp: 100 }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('system');
    expect(line?.text).toBe('对局开始');
  });

  it('phase.changed to night-* → "🌙 夜 N"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 2 },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('phase-night');
    expect(line?.text).toContain('夜 2');
  });

  it('phase.changed to day-* → "☀️ 天 N"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-speeches', dayNumber: 1 },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('phase-day');
    expect(line?.text).toContain('天 1');
  });

  it('agent.action_received vote → "<name> 投 <target>"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-vote',
          playerId: 'p3',
          action: { type: 'vote', targetId: 'p7' },
        },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('vote');
    expect(line?.text).toBe('Bot 3 投 Bot 7');
  });

  it('agent.action_received speak → "<name> 发言"', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'day-speeches',
          playerId: 'p2',
          action: { type: 'speak', text: 'hi' },
        },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('speak');
    expect(line?.text).toBe('Bot 2 发言');
  });

  it('agent.action_received in night-* phase has no playerId (already stripped) → null/system fold', () => {
    // Realistic shape: the public projection already removed playerId/agentId.
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'agent.action_received',
        data: {
          phase: 'night-werewolf-vote',
          action: { type: 'werewolf-vote', targetId: 'p5' },
        },
      }),
      NAME_INDEX,
    );
    // The normalizer returns `null` for night actor events; the reducer
    // collapses them into a single system-night-fold line.
    expect(line).toBeNull();
  });

  it('match.completed → completion line with winner', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'match.completed',
        data: { winner: 'good' },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('completion');
    expect(line?.text).toContain('好人胜');
  });

  it('engine.action_applied (non-speak/vote) → "system" line', () => {
    const line = normalizeWerewolfReplayEvent(
      makeEvent({
        eventType: 'engine.action_applied',
        data: { phase: 'day-resolve', action: { type: 'resolve' } },
      }),
      NAME_INDEX,
    );
    expect(line?.kind).toBe('system');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`
Expected: FAIL — module not yet implemented.

- [ ] **Step 3: Implement the normalizer**

Create `apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts`:

```ts
import type { WerewolfReplayEvent } from '@agent-poker/shared';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

const NIGHT_PHASE_PREFIX = 'night-';
const DAY_PHASE_PREFIX = 'day-';

export type NameIndex = Readonly<Record<string, string>>;

function nameOf(playerId: unknown, names: NameIndex): string {
  if (typeof playerId !== 'string') return '???';
  return names[playerId] ?? playerId;
}

function phaseOf(event: WerewolfReplayEvent): string | undefined {
  const v = event.data['phase'];
  return typeof v === 'string' ? v : undefined;
}

export function normalizeWerewolfReplayEvent(
  event: WerewolfReplayEvent,
  names: NameIndex,
): WerewolfTimelineLine | null {
  const id = event.eventId;
  const ts = event.timestamp;

  if (event.eventType === 'match.started') {
    return { id, timestamp: ts, kind: 'system', text: '对局开始' };
  }

  if (event.eventType === 'phase.changed') {
    const phase = phaseOf(event);
    if (typeof phase === 'string') {
      if (phase.startsWith(NIGHT_PHASE_PREFIX)) {
        const n = Number(event.data['nightNumber'] ?? 0);
        return { id, timestamp: ts, kind: 'phase-night', text: `🌙 夜 ${n}` };
      }
      if (phase.startsWith(DAY_PHASE_PREFIX)) {
        const d = Number(event.data['dayNumber'] ?? 0);
        return { id, timestamp: ts, kind: 'phase-day', text: `☀️ 天 ${d}` };
      }
      if (phase === 'game-over') {
        return { id, timestamp: ts, kind: 'system', text: '游戏结束' };
      }
    }
    return null;
  }

  if (event.eventType === 'agent.action_received') {
    const phase = phaseOf(event);
    if (typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX)) {
      // Night actor identity already stripped by werewolfReplayEventToPublic.
      // Reducer folds these into a single system-night-fold line.
      return null;
    }
    const action = event.data['action'] as { type?: string; targetId?: string } | undefined;
    const playerId = event.data['playerId'];
    if (action?.type === 'speak') {
      return { id, timestamp: ts, kind: 'speak', text: `${nameOf(playerId, names)} 发言` };
    }
    if (action?.type === 'vote') {
      return {
        id,
        timestamp: ts,
        kind: 'vote',
        text: `${nameOf(playerId, names)} 投 ${nameOf(action.targetId, names)}`,
      };
    }
    return { id, timestamp: ts, kind: 'system', text: `${nameOf(playerId, names)} 行动` };
  }

  if (event.eventType === 'match.completed') {
    const winner = event.data['winner'];
    const text = winner === 'good' ? '🏁 终局：好人胜' : winner === 'werewolf' ? '🏁 终局：狼人胜' : '🏁 终局';
    return { id, timestamp: ts, kind: 'completion', text };
  }

  // engine.action_applied, agent.action_requested, agent.timeout, agent.invalid_action
  // All collapse to a generic system line.
  return { id, timestamp: ts, kind: 'system', text: `[${event.eventType}]` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/werewolf-room/normalizeWerewolfReplayEvent.ts apps/web/src/werewolf-room/__tests__/normalizeWerewolfReplayEvent.test.ts
git commit -m "feat(web): werewolf replay event normalizer"
```

---

## Task 7: `werewolfRoomReducer` (TDD)

**Files:**
- Create: `apps/web/src/werewolf-room/werewolfRoomReducer.ts`
- Test: `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`

The reducer reduces `WerewolfReplayEvent`s onto `WerewolfRoomState`. It also accepts two non-event actions: `lobby-sync` (server-truth pre-start state) and `match-completed` (server-truth post-game state with `finalPlayers`).

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  werewolfRoomReducer,
  type WerewolfRoomAction,
} from '../werewolfRoomReducer.js';
import { emptyRoomState } from '../werewolfRoomTypes.js';
import type { WerewolfReplayEvent } from '@agent-poker/shared';

function makeEvent(partial: Partial<WerewolfReplayEvent>): WerewolfReplayEvent {
  return {
    eventId: `eid-${Math.random()}`,
    gameId: 'g1',
    sequence: 0,
    eventType: 'engine.action_applied',
    timestamp: 1,
    data: {},
    ...partial,
  } as WerewolfReplayEvent;
}

const SEEDED_LOBBY = {
  type: 'lobby-sync' as const,
  entry: {
    gameId: 'g1',
    name: 'demo',
    status: 'running' as const,
    createdAt: 0,
    startedAt: 1,
    seats: Array.from({ length: 9 }, (_, i) => ({
      seatIndex: i,
      playerId: `p${i + 1}`,
      occupant: { kind: 'npc' as const, agentId: `agent-p${i + 1}`, displayName: `Bot ${i + 1}` },
    })),
  },
};

describe('werewolfRoomReducer', () => {
  it('lobby-sync overrides the existing room state', () => {
    const after = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    expect(after.status).toBe('running');
    expect(after.seats[0]!.occupant.kind).toBe('npc');
  });

  it('phase.changed (night-werewolf-vote) sets currentPhase + nightNumber, leaves currentActor unset', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    expect(after.currentPhase).toBe('night-werewolf-vote');
    expect(after.nightNumber).toBe(1);
    expect(after.currentActor).toBeUndefined();
  });

  it('agent.action_requested in DAY phase populates currentActor', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredDay = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'day-vote', dayNumber: 1 },
      }),
    });
    const after = werewolfRoomReducer(enteredDay, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'day-vote', playerId: 'p3' },
      }),
    });
    expect(after.currentActor).toBe('p3');
  });

  it('agent.action_requested in NIGHT phase NEVER populates currentActor (info isolation)', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredNight = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    // Even if a (theoretically impossible) public event ever included a playerId
    // during a night phase, the reducer must still refuse to highlight it.
    const after = werewolfRoomReducer(enteredNight, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'agent.action_requested',
        data: { phase: 'night-werewolf-vote', playerId: 'p4' },
      }),
    });
    expect(after.currentActor).toBeUndefined();
  });

  it('consecutive werewolf-vote events fold into a single system-night-fold line', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const enteredNight = werewolfRoomReducer(seeded, {
      type: 'replay-event',
      event: makeEvent({
        eventType: 'phase.changed',
        data: { phase: 'night-werewolf-vote', nightNumber: 1 },
      }),
    });
    let state = enteredNight;
    for (let i = 0; i < 5; i++) {
      state = werewolfRoomReducer(state, {
        type: 'replay-event',
        event: makeEvent({
          eventType: 'agent.action_received',
          data: { phase: 'night-werewolf-vote', action: { type: 'werewolf-vote' } },
        }),
      });
    }
    const fold = state.timeline.filter(l => l.kind === 'system-night-fold');
    expect(fold).toHaveLength(1);
    expect(fold[0]!.text).toContain('夜 1');
  });

  it('match-completed populates winner + revealed roles + per-seat alive', () => {
    const seeded = werewolfRoomReducer(emptyRoomState('g1'), SEEDED_LOBBY);
    const after = werewolfRoomReducer(seeded, {
      type: 'match-completed',
      winner: 'good',
      finalPlayers: [
        { id: 'p1', seatIndex: 0, name: 'Bot 1', role: 'werewolf', side: 'werewolf', alive: false },
        { id: 'p2', seatIndex: 1, name: 'Bot 2', role: 'seer', side: 'good', alive: true },
        { id: 'p3', seatIndex: 2, name: 'Bot 3', role: 'witch', side: 'good', alive: true },
        { id: 'p4', seatIndex: 3, name: 'Bot 4', role: 'hunter', side: 'good', alive: false },
        { id: 'p5', seatIndex: 4, name: 'Bot 5', role: 'villager', side: 'good', alive: true },
        { id: 'p6', seatIndex: 5, name: 'Bot 6', role: 'villager', side: 'good', alive: false },
        { id: 'p7', seatIndex: 6, name: 'Bot 7', role: 'villager', side: 'good', alive: true },
        { id: 'p8', seatIndex: 7, name: 'Bot 8', role: 'werewolf', side: 'werewolf', alive: false },
        { id: 'p9', seatIndex: 8, name: 'Bot 9', role: 'werewolf', side: 'werewolf', alive: false },
      ],
    });
    expect(after.status).toBe('completed');
    expect(after.winner).toBe('good');
    expect(after.seats[0]!.revealedRole).toBe('werewolf');
    expect(after.seats[0]!.alive).toBe(false);
    expect(after.seats[1]!.alive).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`
Expected: FAIL — reducer not yet implemented.

- [ ] **Step 3: Implement the reducer**

Create `apps/web/src/werewolf-room/werewolfRoomReducer.ts`:

```ts
import type { WerewolfPhase, WerewolfReplayEvent, WerewolfRole, WerewolfSide } from '@agent-poker/shared';
import {
  type WerewolfRoomState,
  type SeatVM,
  type WerewolfTimelineLine,
} from './werewolfRoomTypes.js';
import { normalizeWerewolfReplayEvent, type NameIndex } from './normalizeWerewolfReplayEvent.js';

interface ServerLobbyEntry {
  gameId: string;
  name: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seats: Array<{
    seatIndex: number;
    playerId: string;
    occupant:
      | { kind: 'empty' }
      | { kind: 'npc'; agentId: string; displayName: string };
  }>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: WerewolfSide;
  failureReason?: string;
  finalPlayers?: ReadonlyArray<{
    id: string;
    seatIndex: number;
    name: string;
    role: string;
    side: 'good' | 'werewolf';
    alive: boolean;
  }>;
}

export type WerewolfRoomAction =
  | { type: 'lobby-sync'; entry: ServerLobbyEntry }
  | { type: 'replay-event'; event: WerewolfReplayEvent }
  | {
      type: 'match-completed';
      winner: WerewolfSide;
      finalPlayers: ReadonlyArray<{
        id: string;
        seatIndex: number;
        name: string;
        role: string;
        side: 'good' | 'werewolf';
        alive: boolean;
      }>;
    }
  | { type: 'match-failed'; reason: string };

const NIGHT_PHASE_PREFIX = 'night-';

function isNightPhase(phase: string | WerewolfPhase | undefined): boolean {
  return typeof phase === 'string' && phase.startsWith(NIGHT_PHASE_PREFIX);
}

function nameIndexFromSeats(seats: SeatVM[]): NameIndex {
  const out: Record<string, string> = {};
  for (const s of seats) {
    if (s.occupant.kind === 'npc') out[s.playerId] = s.occupant.displayName;
    else out[s.playerId] = s.playerId;
  }
  return out;
}

export function werewolfRoomReducer(
  state: WerewolfRoomState,
  action: WerewolfRoomAction,
): WerewolfRoomState {
  if (action.type === 'lobby-sync') {
    const seats: SeatVM[] = action.entry.seats.map(s => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      occupant: s.occupant,
      alive: true,
    }));
    return {
      ...state,
      gameId: action.entry.gameId,
      status: action.entry.status,
      seats,
      // Don't reset timeline on re-sync; preserve any events received already.
      ...(action.entry.failureReason ? { failureReason: action.entry.failureReason } : {}),
    };
  }

  if (action.type === 'match-completed') {
    const seats = state.seats.map(s => {
      const fp = action.finalPlayers.find(p => p.seatIndex === s.seatIndex);
      if (!fp) return s;
      return {
        ...s,
        alive: fp.alive,
        revealedRole: fp.role as WerewolfRole,
        revealedSide: fp.side,
      };
    });
    return {
      ...state,
      status: 'completed',
      winner: action.winner,
      currentPhase: 'completed',
      currentActor: undefined,
      seats,
    };
  }

  if (action.type === 'match-failed') {
    return { ...state, status: 'failed', failureReason: action.reason };
  }

  // replay-event
  const event = action.event;
  const names = nameIndexFromSeats(state.seats);
  const phase = (event.data['phase'] as string | undefined) ?? state.currentPhase;
  let next: WerewolfRoomState = state;

  // Phase tracking
  if (event.eventType === 'phase.changed') {
    const newPhase = event.data['phase'] as WerewolfPhase | undefined;
    if (newPhase) {
      next = {
        ...next,
        currentPhase: newPhase,
        nightNumber:
          typeof event.data['nightNumber'] === 'number' ? (event.data['nightNumber'] as number) : next.nightNumber,
        dayNumber:
          typeof event.data['dayNumber'] === 'number' ? (event.data['dayNumber'] as number) : next.dayNumber,
        currentActor: undefined,            // clear actor on every phase change
      };
    }
  }

  // Actor highlight, gated by phase: NEVER set currentActor in night-* phases.
  if (event.eventType === 'agent.action_requested') {
    if (!isNightPhase(phase)) {
      const pid = event.data['playerId'];
      if (typeof pid === 'string') next = { ...next, currentActor: pid };
    }
  }

  // match.completed handler — advances status; finalPlayers come via match-completed action
  if (event.eventType === 'match.completed') {
    const w = event.data['winner'];
    if (w === 'good' || w === 'werewolf') {
      next = { ...next, status: 'completed', currentPhase: 'completed', currentActor: undefined, winner: w };
    }
  }

  // Timeline line generation
  const line = normalizeWerewolfReplayEvent(event, names);

  if (line === null) {
    // Night-actor event: fold into a single system-night-fold line per night.
    if (isNightPhase(phase)) {
      const last = next.timeline[next.timeline.length - 1];
      if (last && last.kind === 'system-night-fold' && last.text.includes(`夜 ${next.nightNumber}`)) {
        // Already folded this night; nothing to append.
        return next;
      }
      const fold: WerewolfTimelineLine = {
        id: `night-fold-${next.nightNumber}-${event.eventId}`,
        kind: 'system-night-fold',
        text: `🌙 夜 ${next.nightNumber} · 行动中…`,
        timestamp: event.timestamp,
      };
      return { ...next, timeline: [...next.timeline, fold] };
    }
    return next;
  }

  return { ...next, timeline: [...next.timeline, line] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/werewolf-room/werewolfRoomReducer.ts apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts
git commit -m "feat(web): werewolf-room reducer with night-actor invariant"
```

---

## Task 8: Presentational components

**Files:**
- Create: `apps/web/src/werewolf-room/WerewolfPhaseIndicator.tsx`
- Create: `apps/web/src/werewolf-room/WerewolfTableSurface.tsx`
- Create: `apps/web/src/werewolf-room/WerewolfEventTimeline.tsx`

Plain presentational React components. No tests yet (smoke-tested in Task 11).

- [ ] **Step 1: Create `WerewolfPhaseIndicator.tsx`**

```tsx
import type { WerewolfRoomState } from './werewolfRoomTypes.js';

export interface WerewolfPhaseIndicatorProps {
  state: WerewolfRoomState;
}

export function WerewolfPhaseIndicator({ state }: WerewolfPhaseIndicatorProps) {
  const { currentPhase, dayNumber, nightNumber, status } = state;
  let label = '准备中';
  if (status === 'completed') label = '已结束';
  else if (status === 'failed') label = '异常终止';
  else if (typeof currentPhase === 'string' && currentPhase.startsWith('night-')) {
    label = `🌙 夜 ${nightNumber}`;
  } else if (typeof currentPhase === 'string' && currentPhase.startsWith('day-')) {
    label = `☀️ 天 ${dayNumber}`;
  } else if (currentPhase === 'pre-match') {
    label = '等待开局';
  }
  return (
    <div className="werewolf-phase">
      <span className="werewolf-phase-label">{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `WerewolfTableSurface.tsx`**

```tsx
import type { WerewolfRoomState, SeatVM } from './werewolfRoomTypes.js';

export interface WerewolfTableSurfaceProps {
  state: WerewolfRoomState;
  onInvite?: (seatIndex: number) => void;
  onFillAll?: () => void;
}

const SEAT_LABELS: Record<string, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

function SeatCard({
  seat,
  highlighted,
  revealRoles,
  onInvite,
}: {
  seat: SeatVM;
  highlighted: boolean;
  revealRoles: boolean;
  onInvite?: (seatIndex: number) => void;
}) {
  const isEmpty = seat.occupant.kind === 'empty';
  const dead = !seat.alive;
  const className = [
    'werewolf-seat',
    isEmpty ? 'werewolf-seat-empty' : 'werewolf-seat-occupied',
    dead ? 'werewolf-seat-dead' : '',
    highlighted ? 'werewolf-seat-active' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={className} data-seat-index={seat.seatIndex}>
      <div className="werewolf-seat-id">P{seat.seatIndex + 1}</div>
      {isEmpty ? (
        <button
          className="werewolf-seat-invite"
          onClick={() => onInvite?.(seat.seatIndex)}
          disabled={!onInvite}
        >
          邀请 NPC
        </button>
      ) : (
        <>
          <div className="werewolf-seat-name">
            {seat.occupant.kind === 'npc' ? seat.occupant.displayName : '???'}
          </div>
          {revealRoles && seat.revealedRole ? (
            <div className="werewolf-seat-role">{SEAT_LABELS[seat.revealedRole] ?? seat.revealedRole}</div>
          ) : null}
          {dead ? <div className="werewolf-seat-status">已淘汰</div> : null}
        </>
      )}
    </div>
  );
}

export function WerewolfTableSurface({ state, onInvite, onFillAll }: WerewolfTableSurfaceProps) {
  const revealRoles = state.status === 'completed';
  const showFillAll = state.status === 'waiting' && state.seats.some(s => s.occupant.kind === 'empty');
  return (
    <div className="werewolf-table">
      {showFillAll && onFillAll ? (
        <button className="werewolf-fill-all" onClick={onFillAll}>
          一键填满 9 个 NPC
        </button>
      ) : null}
      <div className="werewolf-seats">
        {state.seats.map(seat => (
          <SeatCard
            key={seat.seatIndex}
            seat={seat}
            highlighted={state.currentActor === seat.playerId}
            revealRoles={revealRoles}
            {...(onInvite ? { onInvite } : {})}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `WerewolfEventTimeline.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { WerewolfTimelineLine } from './werewolfRoomTypes.js';

export interface WerewolfEventTimelineProps {
  lines: WerewolfTimelineLine[];
}

export function WerewolfEventTimeline({ lines }: WerewolfEventTimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div className="werewolf-timeline" ref={ref} aria-live="polite">
      {lines.length === 0 ? (
        <div className="werewolf-timeline-empty">暂无事件</div>
      ) : (
        lines.map(line => (
          <div key={line.id} className={`werewolf-timeline-line werewolf-timeline-${line.kind}`}>
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run lint to verify types**

Run: `pnpm --filter web run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/werewolf-room/WerewolfPhaseIndicator.tsx apps/web/src/werewolf-room/WerewolfTableSurface.tsx apps/web/src/werewolf-room/WerewolfEventTimeline.tsx
git commit -m "feat(web): werewolf-room presentational components"
```

---

## Task 9: `WerewolfLobbyPage`

**Files:**
- Create: `apps/web/src/pages/WerewolfLobbyPage.tsx`

List + create. Uses `api.get` / `api.post`.

- [ ] **Step 1: Create the page**

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';

export interface WerewolfLobbySummary {
  gameId: string;
  name: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seatedCount: number;
  createdAt: number;
}

export interface WerewolfLobbyEntryWire {
  gameId: string;
}

export function WerewolfLobbyPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<WerewolfLobbySummary[]>([]);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<WerewolfLobbySummary[]>('/werewolf-games');
      setGames(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load werewolf games');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const body: { name?: string; seed?: string } = {};
      if (name.trim()) body.name = name.trim();
      if (seed.trim()) body.seed = seed.trim();
      const entry = await api.post<WerewolfLobbyEntryWire>('/werewolf-games', body);
      navigate(`/werewolf/${entry.gameId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="werewolf-lobby">
      <h1>Werewolf · 大厅</h1>
      <form onSubmit={onCreate} className="werewolf-create">
        <input
          placeholder="局名称（可选）"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
        />
        <input
          placeholder="seed（可选，用于复现）"
          value={seed}
          onChange={e => setSeed(e.target.value)}
          maxLength={100}
        />
        <button type="submit" disabled={creating}>建局</button>
      </form>
      {error ? <div className="werewolf-error">{error}</div> : null}
      <h2>当前游戏</h2>
      {games.length === 0 ? (
        <p>还没有任何狼人杀对局，先建一个看看。</p>
      ) : (
        <ul className="werewolf-game-list">
          {games.map(g => (
            <li key={g.gameId} className="werewolf-game-row">
              <Link to={`/werewolf/${g.gameId}`}>
                <span className="werewolf-game-name">{g.name}</span>
                <span className="werewolf-game-status">{g.status}</span>
                <span className="werewolf-game-seated">{g.seatedCount}/9</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run lint**

Run: `pnpm --filter web run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/WerewolfLobbyPage.tsx
git commit -m "feat(web): werewolf lobby page"
```

---

## Task 10: `WerewolfRoomPage`

**Files:**
- Create: `apps/web/src/pages/WerewolfRoomPage.tsx`

The page that orchestrates the room: initial fetch, polling, WS subscription, transitions between three views.

- [ ] **Step 1: Create the page**

```tsx
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { WsClient, type WsMessage } from '../lib/ws.js';
import { emptyRoomState } from '../werewolf-room/werewolfRoomTypes.js';
import {
  werewolfRoomReducer,
  type WerewolfRoomAction,
} from '../werewolf-room/werewolfRoomReducer.js';
import { WerewolfTableSurface } from '../werewolf-room/WerewolfTableSurface.js';
import { WerewolfPhaseIndicator } from '../werewolf-room/WerewolfPhaseIndicator.js';
import { WerewolfEventTimeline } from '../werewolf-room/WerewolfEventTimeline.js';
import type { WerewolfReplayEvent } from '@agent-poker/shared';

type ServerLobbyEntry = Parameters<typeof werewolfRoomReducer>[1] extends {
  type: 'lobby-sync';
  entry: infer E;
}
  ? E
  : never;

const POLL_WAITING_MS = 2000;
const POLL_RUNNING_MS = 5000;

export function WerewolfRoomPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(werewolfRoomReducer, gameId, emptyRoomState);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WsClient | null>(null);

  const fetchEntry = useCallback(async () => {
    try {
      const entry = await api.get<ServerLobbyEntry>(`/werewolf-games/${encodeURIComponent(gameId)}`);
      dispatch({ type: 'lobby-sync', entry });
      if (entry.status === 'completed' && entry.winner && entry.finalPlayers) {
        dispatch({
          type: 'match-completed',
          winner: entry.winner,
          finalPlayers: entry.finalPlayers,
        });
      }
      if (entry.status === 'failed' && entry.failureReason) {
        dispatch({ type: 'match-failed', reason: entry.failureReason });
      }
      return entry;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load room');
      return null;
    }
  }, [gameId]);

  useEffect(() => {
    void fetchEntry();
  }, [fetchEntry]);

  // Adaptive polling driven by status
  useEffect(() => {
    const ms = state.status === 'running' ? POLL_RUNNING_MS : POLL_WAITING_MS;
    if (state.status === 'completed' || state.status === 'failed') return;
    const id = setInterval(() => { void fetchEntry(); }, ms);
    return () => clearInterval(id);
  }, [state.status, fetchEntry]);

  // WS subscription only while running
  useEffect(() => {
    if (state.status !== 'running') return;
    const ws = new WsClient();
    wsRef.current = ws;
    ws.connect();
    const topic = `match:${gameId}`;
    ws.subscribe(topic);
    const off = ws.on((m: WsMessage) => {
      if (m.topic !== topic) return;
      // Server publishes the public-projected replay event under payload + type.
      const event: WerewolfReplayEvent = {
        eventId: (m.payload['eventId'] as string) ?? `evt-${Date.now()}`,
        gameId,
        sequence: (m.payload['sequence'] as number) ?? 0,
        eventType: m.type as WerewolfReplayEvent['eventType'],
        timestamp: (m.payload['timestamp'] as number) ?? Date.now(),
        data: m.payload,
      };
      dispatch({ type: 'replay-event', event });
    });
    return () => {
      off();
      ws.unsubscribe(topic);
      ws.close?.();
      wsRef.current = null;
    };
  }, [state.status, gameId]);

  async function inviteNpc(seatIndex: number) {
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/seats/${seatIndex}/invite-npc`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Invite failed');
    }
  }

  async function fillAll() {
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/fill-with-npcs`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fill failed');
    }
  }

  async function startMatch() {
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/start`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Start failed');
    }
  }

  return (
    <div className="werewolf-room">
      <header className="werewolf-room-header">
        <h1>狼人杀房间 · {state.gameId.slice(0, 8)}</h1>
        <button onClick={() => navigate('/werewolf')} className="werewolf-back">返回大厅</button>
      </header>
      <WerewolfPhaseIndicator state={state} />
      {error ? <div className="werewolf-error">{error}</div> : null}

      {state.status === 'waiting' || state.status === 'ready' ? (
        <>
          <WerewolfTableSurface state={state} onInvite={inviteNpc} onFillAll={fillAll} />
          {state.status === 'ready' ? (
            <button className="werewolf-start" onClick={startMatch}>开始对局</button>
          ) : null}
        </>
      ) : (
        <div className="werewolf-room-live">
          <WerewolfTableSurface state={state} />
          <WerewolfEventTimeline lines={state.timeline} />
        </div>
      )}

      {state.status === 'completed' ? (
        <div className="werewolf-banner">
          🏁 终局：{state.winner === 'good' ? '好人胜' : '狼人胜'}
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div className="werewolf-banner werewolf-banner-error">
          异常终止：{state.failureReason ?? '未知错误'}
        </div>
      ) : null}
    </div>
  );
}
```

Note: `WsClient.close` might not exist on the existing class. Check `apps/web/src/lib/ws.ts` for the disposal API. If the class only exposes `unsubscribe`, drop the `ws.close?.()` call (the optional chaining already makes it safe at the call site, but if TS complains about the optional-call typing, just remove that line — `unsubscribe` + GC is sufficient for the demo).

- [ ] **Step 2: Run lint**

Run: `pnpm --filter web run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/WerewolfRoomPage.tsx
git commit -m "feat(web): werewolf room page (lobby + spectator)"
```

---

## Task 11: Wire router and AppShell nav

**Files:**
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Add the routes**

Edit `apps/web/src/router.tsx`. Add imports near the top:

```ts
import { WerewolfLobbyPage } from './pages/WerewolfLobbyPage.js';
import { WerewolfRoomPage } from './pages/WerewolfRoomPage.js';
```

Insert two new entries into the `routes` array, before the catch-all `'*'`:

```ts
{ path: '/werewolf', element: <AppShellRoute><WerewolfLobbyPage /></AppShellRoute> },
{ path: '/werewolf/:gameId', element: <AppShellRoute><WerewolfRoomPage /></AppShellRoute> },
```

(No `ProtectedRoute` wrapper — werewolf is public per the spec.)

- [ ] **Step 2: Add the nav entry**

Edit `apps/web/src/components/AppShell.tsx`. Append a new entry to `baseNavItems`:

```ts
{ label: 'Werewolf', href: '/werewolf', match: path => path.startsWith('/werewolf') },
```

- [ ] **Step 3: Build to verify**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/router.tsx apps/web/src/components/AppShell.tsx
git commit -m "feat(web): route + nav entry for werewolf demo"
```

---

## Task 12: Page smoke tests

**Files:**
- Test: `apps/web/src/__tests__/werewolf-lobby-page.test.tsx`
- Test: `apps/web/src/__tests__/werewolf-room-page.test.tsx`

Mock `api` and `WsClient`. Verify each status renders the expected view.

- [ ] **Step 1: Write the lobby page test**

Create `apps/web/src/__tests__/werewolf-lobby-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WerewolfLobbyPage } from '../pages/WerewolfLobbyPage.js';

vi.mock('../lib/api.js', () => {
  return {
    ApiError: class ApiError extends Error { constructor(public code: string, msg: string, public statusCode: number) { super(msg); } },
    api: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

import { api } from '../lib/api.js';

describe('WerewolfLobbyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when no games exist', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<MemoryRouter><WerewolfLobbyPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/还没有任何狼人杀对局/)).toBeInTheDocument());
  });

  it('lists existing games', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      { gameId: 'g1', name: 'demo-1', status: 'waiting', seatedCount: 3, createdAt: 0 },
      { gameId: 'g2', name: 'demo-2', status: 'running', seatedCount: 9, createdAt: 1 },
    ]);
    render(<MemoryRouter><WerewolfLobbyPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('demo-1')).toBeInTheDocument();
      expect(screen.getByText('demo-2')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Write the room page test**

Create `apps/web/src/__tests__/werewolf-room-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WerewolfRoomPage } from '../pages/WerewolfRoomPage.js';

vi.mock('../lib/api.js', () => ({
  ApiError: class ApiError extends Error { constructor(public code: string, msg: string, public statusCode: number) { super(msg); } },
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../lib/ws.js', () => ({
  WsClient: class { connect() {} subscribe() {} unsubscribe() {} on() { return () => {}; } },
}));

import { api } from '../lib/api.js';

function renderRoom(gameId: string) {
  return render(
    <MemoryRouter initialEntries={[`/werewolf/${gameId}`]}>
      <Routes>
        <Route path="/werewolf/:gameId" element={<WerewolfRoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WerewolfRoomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows invite buttons in waiting state', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      gameId: 'g1', name: 'demo', status: 'waiting', createdAt: 0,
      seats: Array.from({ length: 9 }, (_, i) => ({
        seatIndex: i, playerId: `p${i + 1}`, occupant: { kind: 'empty' },
      })),
    });
    renderRoom('g1');
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: '邀请 NPC' });
      expect(buttons).toHaveLength(9);
    });
  });

  it('shows start button when ready', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      gameId: 'g1', name: 'demo', status: 'ready', createdAt: 0,
      seats: Array.from({ length: 9 }, (_, i) => ({
        seatIndex: i, playerId: `p${i + 1}`,
        occupant: { kind: 'npc', agentId: `agent-p${i + 1}`, displayName: `Bot ${i + 1}` },
      })),
    });
    renderRoom('g1');
    await waitFor(() => expect(screen.getByRole('button', { name: '开始对局' })).toBeInTheDocument());
  });

  it('shows banner on completed', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      gameId: 'g1', name: 'demo', status: 'completed', createdAt: 0,
      winner: 'good',
      seats: Array.from({ length: 9 }, (_, i) => ({
        seatIndex: i, playerId: `p${i + 1}`,
        occupant: { kind: 'npc', agentId: `agent-p${i + 1}`, displayName: `Bot ${i + 1}` },
      })),
      finalPlayers: Array.from({ length: 9 }, (_, i) => ({
        id: `p${i + 1}`, seatIndex: i, name: `Bot ${i + 1}`,
        role: 'villager', side: 'good' as const, alive: true,
      })),
    });
    renderRoom('g1');
    await waitFor(() => expect(screen.getByText(/好人胜/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter web exec vitest run src/__tests__/werewolf-lobby-page.test.tsx src/__tests__/werewolf-room-page.test.tsx`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/__tests__/werewolf-lobby-page.test.tsx apps/web/src/__tests__/werewolf-room-page.test.tsx
git commit -m "test(web): smoke tests for werewolf lobby + room pages"
```

---

## Task 13: Final verification + manual run-through

**Files:**
- No code changes; verification + a brief README addendum.

- [ ] **Step 1: Run the full workspace test suite**

Run: `pnpm test`
Expected: PASS — including the existing werewolf integration tests, the new lifecycle/info-isolation tests, and the new web tests.

- [ ] **Step 2: Run the existing local simulation to confirm no regression**

Run: `pnpm demo:werewolf`
Expected: completes successfully and writes to `examples/werewolf-local-simulation/output/matches/<gameId>/`.

- [ ] **Step 3: Manual smoke test via dev servers**

Two terminals:

```bash
# terminal 1
pnpm dev:api

# terminal 2
pnpm --filter web dev
```

Walk through, verifying each step:

1. Open `http://localhost:5173/werewolf`. The lobby page renders.
2. Click "建局". Redirects to `/werewolf/<gameId>`. Nine empty seats with "邀请 NPC" buttons.
3. Click "一键填满 9 个 NPC". All seats become occupied (`Bot 1` … `Bot 9`); "开始对局" button appears.
4. Click "开始对局". Phase indicator updates as the match progresses; timeline scrolls; consecutive werewolf-vote events are visibly folded.
5. Match ends within ~1s for random NPCs. Banner reads "🏁 终局：好人胜" or "🏁 终局：狼人胜". All seats now show their roles (狼人 / 村民 / 预言家 / 女巫 / 猎人) and dead seats display "已淘汰".
6. Click "返回大厅". The lobby list shows the completed game.

- [ ] **Step 4: Update the platform overview to reference the new UI**

Append a brief paragraph to `docs/agent-poker-werewolf-platform-overview.md` (under a new `## Demo UI` heading near the bottom, immediately above the existing "Out of scope" section). One paragraph is enough — refer the reader back to this plan and the spec.

```md
## Demo UI

A demo-level frontend lives at `/werewolf` (no auth). It lets a user create
a game, fill it with `WerewolfRandomMockAgent` instances via the new
`POST /api/v1/werewolf-games/...` lifecycle endpoints, start the match,
and watch it stream over the existing `match:<gameId>` WS topic. See
`docs/superpowers/specs/2026-05-06-werewolf-demo-ui-design.md` for the
spec and `docs/superpowers/plans/2026-05-06-werewolf-demo-ui.md` for the
implementation plan. Information-isolation invariants (seed never echoed,
roles only revealed after game-over, night actor never highlighted) are
pinned by tests in `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts`
and `apps/web/src/werewolf-room/__tests__/werewolfRoomReducer.test.ts`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/agent-poker-werewolf-platform-overview.md
git commit -m "docs(werewolf): document the demo UI surface"
```

---

## Self-Review Checklist (post-write)

**Spec coverage:**
- ✅ "邀请 agent 入场，但是暂时先用自己的 npc agent 代替" — Tasks 2, 3, 9, 10
- ✅ "进去能看到狼人杀对局并观战" — Tasks 7, 8, 10
- ✅ B (一键填满 + 单座位邀请) — Task 8 (UI), Task 3 (routes)
- ✅ A (最小可看观战视图) — Tasks 7, 8, 10
- ✅ Public no-auth — Task 3 omits `requireAuth`; Task 11 routes have no `ProtectedRoute`
- ✅ Banner + reveal-all-on-game-over + 返回大厅 — Tasks 7 (`match-completed` action), 8 (`WerewolfTableSurface` revealRoles), 10 (banner JSX)
- ✅ `WerewolfLobbyRegistry` in routes layer — Task 2
- ✅ Routes split (`/werewolf-games` vs `/werewolf-matches`) — Task 3 keeps a separate plugin
- ✅ Noise folding — Task 7 (reducer collapse), Task 6 (normalizer returns null in night)
- ✅ Info-isolation invariants (seed, role, night-actor) — Tasks 2, 4, 7

**Placeholder scan:** None. Every task has concrete code.

**Type consistency:**
- `WerewolfSeatInfo`, `WerewolfLobbyEntry`, `WerewolfLobbyStatus` are defined in Task 2 and the same shape is mirrored on the web side in Task 5 (`SeatVM`, `WerewolfRoomState`).
- `WerewolfRoomAction` defined in Task 7 and consumed in Task 10 via `Parameters` inference — no signature drift.
- Server returns `data: <entry>`; web `api.get<T>` extracts `data` automatically — confirmed by reading `apps/web/src/lib/api.ts:call`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-werewolf-demo-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
