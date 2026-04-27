# Replay Artifact Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first replay-first milestone: a match-level artifact layer with manifest, summary, replay JSONL, index API, local simulation output, and a basic replay viewer.

**Architecture:** Keep the poker engine and hand runner unchanged. Add a match artifact layer above existing hand summaries and replay events, then expose those artifacts through API routes and a static-friendly web viewer. This milestone uses `tableId` as `matchId` for simulations so existing table orchestration can stay intact.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Fastify, React/Vite, existing `@agent-poker/*` packages.

---

## File Structure

- Modify `packages/shared/src/types.ts`
  - Add match artifact domain types shared by persistence, API, and web.
- Modify `packages/agent-protocol/src/schemas.ts`
  - Add Zod schemas for match artifact API payloads.
- Modify `packages/agent-protocol/src/types.ts`
  - Export inferred match artifact schema types.
- Create `packages/agent-protocol/src/__tests__/match-artifact-schema.test.ts`
  - Prove schemas accept valid artifacts and reject malformed manifests.
- Create `packages/persistence/src/match-artifact-store.ts`
  - Define `IMatchArtifactStore`, `MemoryMatchArtifactStore`, and `FileMatchArtifactStore`.
- Modify `packages/persistence/src/index.ts`
  - Export the new store.
- Create `packages/persistence/src/__tests__/match-artifact-store.test.ts`
  - Verify file layout, checksums, index updates, and memory store behavior.
- Modify `examples/local-simulation/run-simulation.ts`
  - Save a match artifact after simulation completes.
- Create `apps/api/src/routes/matches.ts`
  - Public read-only match artifact routes.
- Modify `apps/api/src/server.ts`
  - Construct/register the match artifact store and route.
- Modify `apps/api/src/routes/simulate.ts`
  - Save match artifacts after simulation and return `matchArtifact`.
- Create `apps/api/src/__tests__/matches.test.ts`
  - Verify public match routes and simulation artifact generation.
- Create `apps/web/src/pages/MatchesPage.tsx`
  - Public match index page.
- Create `apps/web/src/pages/MatchReplayPage.tsx`
  - Public match replay page backed by static artifacts through the API.
- Modify `apps/web/src/router.tsx`
  - Add public `/matches` and `/matches/:matchId` routes.
- Modify `apps/web/src/pages/LobbyPage.tsx`
  - Add a link to public match replays.
- Modify `README.md`
  - Document match artifacts and replay URLs.

---

## Task 1: Shared Match Artifact Types And Schemas

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/agent-protocol/src/schemas.ts`
- Modify: `packages/agent-protocol/src/types.ts`
- Create: `packages/agent-protocol/src/__tests__/match-artifact-schema.test.ts`

- [ ] **Step 1: Write schema tests first**

Create `packages/agent-protocol/src/__tests__/match-artifact-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MatchArtifactIndexEntrySchema,
  MatchArtifactManifestSchema,
  MatchArtifactRecordSchema,
  MatchSummarySchema,
} from '../schemas.js';

const now = 1_777_280_000_000;

const hand = {
  handId: 'hand-001-abc123',
  tableId: 'tbl-12345678',
  handNumber: 1,
  seed: 'seed-1',
  startedAt: now,
  completedAt: now + 1000,
  players: [],
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  communityCards: [],
  allActions: [],
  results: [],
  finalPots: [],
};

const fileRef = {
  path: 'summary.json',
  sha256: 'a'.repeat(64),
  bytes: 128,
  contentType: 'application/json',
};

describe('match artifact schemas', () => {
  it('accepts a valid match summary', () => {
    const parsed = MatchSummarySchema.parse({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-1',
      startedAt: now,
      completedAt: now + 1000,
      handIds: ['hand-001-abc123'],
      hands: [hand],
      finalStacks: { 'bot-a': 1050 },
      agentIds: ['bot-a'],
    });

    expect(parsed.matchId).toBe('tbl-12345678');
    expect(parsed.handIds).toEqual(['hand-001-abc123']);
  });

  it('accepts a valid manifest and index entry', () => {
    const manifest = MatchArtifactManifestSchema.parse({
      artifactVersion: 1,
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      createdAt: now,
      handIds: ['hand-001-abc123'],
      files: {
        summary: fileRef,
        replay: { ...fileRef, path: 'replay.jsonl', contentType: 'application/x-ndjson' },
      },
    });

    const entry = MatchArtifactIndexEntrySchema.parse({
      matchId: manifest.matchId,
      tableId: manifest.tableId,
      name: 'Daily Showcase',
      seed: 'seed-1',
      handCount: 1,
      agentIds: ['bot-a'],
      startedAt: now,
      completedAt: now + 1000,
      createdAt: now + 1200,
      artifactPath: 'matches/tbl-12345678/manifest.json',
    });

    expect(entry.artifactPath).toBe('matches/tbl-12345678/manifest.json');
  });

  it('accepts a complete artifact record', () => {
    const record = MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-001-abc123'],
        files: {
          summary: fileRef,
          replay: { ...fileRef, path: 'replay.jsonl', contentType: 'application/x-ndjson' },
        },
      },
      summary: {
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-001-abc123'],
        hands: [hand],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [],
    });

    expect(record.summary.hands).toHaveLength(1);
  });

  it('rejects an invalid checksum', () => {
    expect(() => MatchArtifactManifestSchema.parse({
      artifactVersion: 1,
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      createdAt: now,
      handIds: ['hand-001-abc123'],
      files: {
        summary: { ...fileRef, sha256: 'not-a-sha' },
        replay: { ...fileRef, path: 'replay.jsonl', contentType: 'application/x-ndjson' },
      },
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @agent-poker/agent-protocol run test -- src/__tests__/match-artifact-schema.test.ts
```

Expected: FAIL because `MatchArtifactIndexEntrySchema`, `MatchArtifactManifestSchema`, `MatchArtifactRecordSchema`, and `MatchSummarySchema` are not exported yet.

- [ ] **Step 3: Add shared domain types**

In `packages/shared/src/types.ts`, append this block after the existing `ReplayEvent` interface:

```ts
export interface MatchArtifactFileRef {
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface MatchSummary {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  startedAt: number;
  completedAt: number;
  handIds: string[];
  hands: HandSummary[];
  finalStacks: Record<string, number>;
  agentIds: string[];
}

export interface MatchArtifactManifest {
  artifactVersion: 1;
  matchId: string;
  tableId: string;
  createdAt: number;
  handIds: string[];
  files: {
    summary: MatchArtifactFileRef;
    replay: MatchArtifactFileRef;
  };
}

export interface MatchArtifactIndexEntry {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  handCount: number;
  agentIds: string[];
  startedAt: number;
  completedAt: number;
  createdAt: number;
  artifactPath: string;
}

export interface MatchArtifactRecord {
  manifest: MatchArtifactManifest;
  summary: MatchSummary;
  replayEvents: ReplayEvent[];
}
```

- [ ] **Step 4: Add protocol schemas**

In `packages/agent-protocol/src/schemas.ts`, append this block after `ReplayEventSchema`:

```ts
export const MatchArtifactFileRefSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

export const MatchSummarySchema = z.object({
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  name: z.string().min(1),
  seed: z.string().min(1),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  handIds: z.array(z.string().min(1)),
  hands: z.array(HandSummarySchema),
  finalStacks: z.record(z.number().int()),
  agentIds: z.array(z.string().min(1)),
});

export const MatchArtifactManifestSchema = z.object({
  artifactVersion: z.literal(1),
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  createdAt: z.number().int().positive(),
  handIds: z.array(z.string().min(1)),
  files: z.object({
    summary: MatchArtifactFileRefSchema,
    replay: MatchArtifactFileRefSchema,
  }),
});

export const MatchArtifactIndexEntrySchema = z.object({
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  name: z.string().min(1),
  seed: z.string().min(1),
  handCount: z.number().int().nonnegative(),
  agentIds: z.array(z.string().min(1)),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  artifactPath: z.string().min(1),
});

export const MatchArtifactRecordSchema = z.object({
  manifest: MatchArtifactManifestSchema,
  summary: MatchSummarySchema,
  replayEvents: z.array(ReplayEventSchema),
});
```

- [ ] **Step 5: Export inferred schema types**

In `packages/agent-protocol/src/types.ts`, extend the import list with:

```ts
  MatchArtifactFileRefSchema,
  MatchSummarySchema,
  MatchArtifactManifestSchema,
  MatchArtifactIndexEntrySchema,
  MatchArtifactRecordSchema,
```

Then append these exports at the end of the file:

```ts
export type MatchArtifactFileRefZod = z.infer<typeof MatchArtifactFileRefSchema>;
export type MatchSummaryZod = z.infer<typeof MatchSummarySchema>;
export type MatchArtifactManifestZod = z.infer<typeof MatchArtifactManifestSchema>;
export type MatchArtifactIndexEntryZod = z.infer<typeof MatchArtifactIndexEntrySchema>;
export type MatchArtifactRecordZod = z.infer<typeof MatchArtifactRecordSchema>;
```

- [ ] **Step 6: Run the protocol test and build**

Run:

```bash
pnpm --filter @agent-poker/agent-protocol run test -- src/__tests__/match-artifact-schema.test.ts
pnpm --filter @agent-poker/agent-protocol run build
```

Expected: PASS for the test file and build exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/shared/src/types.ts packages/agent-protocol/src/schemas.ts packages/agent-protocol/src/types.ts packages/agent-protocol/src/__tests__/match-artifact-schema.test.ts
git commit -m "Add match artifact schemas"
```

Expected in a git repository: commit succeeds. In the current workspace, `git status` shows there is no `.git`; record that fact and continue without a commit.

---

## Task 2: Match Artifact Persistence Store

**Files:**
- Create: `packages/persistence/src/match-artifact-store.ts`
- Modify: `packages/persistence/src/index.ts`
- Create: `packages/persistence/src/__tests__/match-artifact-store.test.ts`

- [ ] **Step 1: Write persistence tests first**

Create `packages/persistence/src/__tests__/match-artifact-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { HandSummary, ReplayEvent } from '@agent-poker/shared';
import {
  FileMatchArtifactStore,
  MemoryMatchArtifactStore,
} from '../match-artifact-store.js';

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `poker-match-artifact-${randomUUID()}`);
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function makeHand(handNumber: number, stackAfter: number): HandSummary {
  return {
    handId: `hand-${String(handNumber).padStart(3, '0')}-abc123`,
    tableId: 'tbl-12345678',
    handNumber,
    seed: `seed-${handNumber}`,
    startedAt: 1_777_280_000_000 + handNumber,
    completedAt: 1_777_280_001_000 + handNumber,
    players: [{
      playerId: 'player-bot-a',
      agentId: 'bot-a',
      seatIndex: 0,
      stackBefore: 1000,
      stackAfter,
      holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }],
    }],
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    communityCards: [],
    allActions: [],
    results: [],
    finalPots: [],
  };
}

function makeEvent(handId: string, sequence: number): ReplayEvent {
  return {
    eventId: `evt-${handId}-${sequence}`,
    handId,
    tableId: 'tbl-12345678',
    sequence,
    eventType: 'test.event',
    timestamp: 1_777_280_002_000 + sequence,
    data: { sequence },
  };
}

describe('MatchArtifactStore', () => {
  it('FileMatchArtifactStore writes manifest, summary, replay JSONL, and index', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });

    expect(record.manifest.files.summary.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.summary.finalStacks).toEqual({ 'bot-a': 1050 });
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'summary.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'replay.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'index.json'))).toBe(true);
  });

  it('FileMatchArtifactStore loads a saved artifact', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
    });

    const loaded = await store.getMatchArtifact('tbl-12345678');
    expect(loaded?.summary.matchId).toBe('tbl-12345678');
    expect(loaded?.replayEvents).toHaveLength(2);
  });

  it('FileMatchArtifactStore lists newest index entries first', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    await store.saveMatchArtifact({
      matchId: 'match-a',
      tableId: 'tbl-a',
      name: 'A',
      seed: 'seed-a',
      hands: [makeHand(1, 1000)],
      replayEvents: [],
    });
    await store.saveMatchArtifact({
      matchId: 'match-b',
      tableId: 'tbl-b',
      name: 'B',
      seed: 'seed-b',
      hands: [makeHand(2, 1100)],
      replayEvents: [],
    });

    const entries = await store.listMatchArtifacts();
    expect(entries.map(e => e.matchId)).toEqual(['match-b', 'match-a']);
  });

  it('MemoryMatchArtifactStore stores and loads records', async () => {
    const store = new MemoryMatchArtifactStore();
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });

    const entries = await store.listMatchArtifacts();
    const loaded = await store.getMatchArtifact('tbl-12345678');
    expect(entries).toHaveLength(1);
    expect(loaded?.summary.agentIds).toEqual(['bot-a']);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
```

Expected: FAIL because `../match-artifact-store.js` does not exist.

- [ ] **Step 3: Add the store implementation**

Create `packages/persistence/src/match-artifact-store.ts`:

```ts
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  HandSummary,
  MatchArtifactFileRef,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchArtifactRecord,
  MatchSummary,
  ReplayEvent,
} from '@agent-poker/shared';

export interface SaveMatchArtifactInput {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  hands: HandSummary[];
  replayEvents: ReplayEvent[];
}

export interface IMatchArtifactStore {
  saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord>;
  getMatchArtifact(matchId: string): Promise<MatchArtifactRecord | null>;
  listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]>;
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function fileRef(filePath: string, raw: string, contentType: string): MatchArtifactFileRef {
  return {
    path: filePath,
    sha256: sha256(raw),
    bytes: Buffer.byteLength(raw, 'utf-8'),
    contentType,
  };
}

function buildSummary(input: SaveMatchArtifactInput): MatchSummary {
  const hands = [...input.hands].sort((a, b) => a.handNumber - b.handNumber);
  const first = hands[0];
  const last = hands[hands.length - 1];
  const finalStacks: Record<string, number> = {};
  for (const player of last?.players || []) {
    finalStacks[player.agentId] = player.stackAfter;
  }
  const agentIds = Array.from(
    new Set(hands.flatMap(hand => hand.players.map(player => player.agentId))),
  ).sort();

  return {
    matchId: input.matchId,
    tableId: input.tableId,
    name: input.name,
    seed: input.seed,
    startedAt: first ? first.startedAt : Date.now(),
    completedAt: last ? last.completedAt : Date.now(),
    handIds: hands.map(hand => hand.handId),
    hands,
    finalStacks,
    agentIds,
  };
}

function sortReplayEvents(summary: MatchSummary, events: ReplayEvent[]): ReplayEvent[] {
  const handOrder = new Map(summary.handIds.map((handId, index) => [handId, index]));
  return [...events].sort((a, b) => {
    const aOrder = handOrder.get(a.handId);
    const bOrder = handOrder.get(b.handId);
    const handDelta = (aOrder !== undefined ? aOrder : Number.MAX_SAFE_INTEGER) -
      (bOrder !== undefined ? bOrder : Number.MAX_SAFE_INTEGER);
    if (handDelta !== 0) return handDelta;
    return a.sequence - b.sequence;
  });
}

function buildRecord(input: SaveMatchArtifactInput, createdAt = Date.now()): MatchArtifactRecord {
  const summary = buildSummary(input);
  const replayEvents = sortReplayEvents(summary, input.replayEvents);
  const summaryRaw = `${JSON.stringify(summary, null, 2)}\n`;
  const replayRaw = replayEvents.map(event => JSON.stringify(event)).join('\n') +
    (replayEvents.length > 0 ? '\n' : '');

  const manifest: MatchArtifactManifest = {
    artifactVersion: 1,
    matchId: input.matchId,
    tableId: input.tableId,
    createdAt,
    handIds: summary.handIds,
    files: {
      summary: fileRef('summary.json', summaryRaw, 'application/json'),
      replay: fileRef('replay.jsonl', replayRaw, 'application/x-ndjson'),
    },
  };

  return { manifest, summary, replayEvents };
}

function toIndexEntry(record: MatchArtifactRecord): MatchArtifactIndexEntry {
  return {
    matchId: record.manifest.matchId,
    tableId: record.manifest.tableId,
    name: record.summary.name,
    seed: record.summary.seed,
    handCount: record.summary.handIds.length,
    agentIds: record.summary.agentIds,
    startedAt: record.summary.startedAt,
    completedAt: record.summary.completedAt,
    createdAt: record.manifest.createdAt,
    artifactPath: `matches/${record.manifest.matchId}/manifest.json`,
  };
}

export class MemoryMatchArtifactStore implements IMatchArtifactStore {
  private records = new Map<string, MatchArtifactRecord>();

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    const record = buildRecord(input);
    this.records.set(record.manifest.matchId, record);
    return record;
  }

  async getMatchArtifact(matchId: string): Promise<MatchArtifactRecord | null> {
    return this.records.get(matchId) || null;
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    return [...this.records.values()]
      .map(toIndexEntry)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

export class FileMatchArtifactStore implements IMatchArtifactStore {
  constructor(private readonly baseDir: string) {}

  private rootDir(): string {
    return path.join(this.baseDir, 'matches');
  }

  private matchDir(matchId: string): string {
    return path.join(this.rootDir(), matchId);
  }

  private indexFile(): string {
    return path.join(this.rootDir(), 'index.json');
  }

  private ensureMatchDir(matchId: string): void {
    fs.mkdirSync(this.matchDir(matchId), { recursive: true });
  }

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    const record = buildRecord(input);
    this.ensureMatchDir(record.manifest.matchId);

    const dir = this.matchDir(record.manifest.matchId);
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      `${JSON.stringify(record.summary, null, 2)}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(dir, 'replay.jsonl'),
      record.replayEvents.map(event => JSON.stringify(event)).join('\n') +
        (record.replayEvents.length > 0 ? '\n' : ''),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify(record.manifest, null, 2)}\n`,
      'utf-8',
    );

    await this.upsertIndex(toIndexEntry(record));
    return record;
  }

  async getMatchArtifact(matchId: string): Promise<MatchArtifactRecord | null> {
    const dir = this.matchDir(matchId);
    const manifestFile = path.join(dir, 'manifest.json');
    const summaryFile = path.join(dir, 'summary.json');
    const replayFile = path.join(dir, 'replay.jsonl');
    if (!fs.existsSync(manifestFile) || !fs.existsSync(summaryFile) || !fs.existsSync(replayFile)) {
      return null;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as MatchArtifactManifest;
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8')) as MatchSummary;
    const rawReplay = fs.readFileSync(replayFile, 'utf-8');
    const replayEvents = rawReplay
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as ReplayEvent);

    return { manifest, summary, replayEvents };
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    if (!fs.existsSync(this.indexFile())) return [];
    const raw = fs.readFileSync(this.indexFile(), 'utf-8');
    const entries = JSON.parse(raw) as MatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  private async upsertIndex(entry: MatchArtifactIndexEntry): Promise<void> {
    fs.mkdirSync(this.rootDir(), { recursive: true });
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter(existing => existing.matchId !== entry.matchId),
    ].sort((a, b) => b.createdAt - a.createdAt);
    fs.writeFileSync(this.indexFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }
}
```

- [ ] **Step 4: Export the store**

In `packages/persistence/src/index.ts`, add:

```ts
export * from './match-artifact-store.js';
```

- [ ] **Step 5: Run persistence tests and build**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
pnpm --filter @agent-poker/persistence run build
```

Expected: PASS for the test file and build exit 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/persistence/src/match-artifact-store.ts packages/persistence/src/index.ts packages/persistence/src/__tests__/match-artifact-store.test.ts
git commit -m "Add match artifact persistence"
```

Expected in a git repository: commit succeeds. In the current workspace, record the missing `.git` state and continue.

---

## Task 3: Local Simulation Emits Match Artifacts

**Files:**
- Modify: `examples/local-simulation/run-simulation.ts`

- [ ] **Step 1: Run the demo before the change**

Run:

```bash
pnpm --filter local-simulation start -- 2 artifact-plan-seed
```

Expected: command exits 0 and writes per-hand files under `examples/local-simulation/output/{tableId}/`, but no `examples/local-simulation/output/matches/{tableId}/manifest.json` exists for the new run.

- [ ] **Step 2: Modify imports**

In `examples/local-simulation/run-simulation.ts`, replace the persistence import with:

```ts
import {
  MemoryTableStore,
  MemoryHandStore,
  FileHandStore,
  FileMatchArtifactStore,
} from '@agent-poker/persistence';
```

- [ ] **Step 3: Instantiate the artifact store**

After `const fileHandStore = new FileHandStore(OUTPUT_DIR);`, add:

```ts
  const matchArtifactStore = new FileMatchArtifactStore(OUTPUT_DIR);
```

- [ ] **Step 4: Save the match artifact after final stacks**

After the final stack loop and before the replay path logging block, add:

```ts
  const replayEvents = (
    await Promise.all(summaries.map(summary => memHandStore.getReplayEvents(summary.handId)))
  ).flat();

  const artifact = await matchArtifactStore.saveMatchArtifact({
    matchId: table.tableId,
    tableId: table.tableId,
    name: table.config.name,
    seed: table.config.seed || seed,
    hands: summaries,
    replayEvents,
  });
```

- [ ] **Step 5: Print artifact paths**

In the existing output section, after the line that prints `Last hand replay`, add:

```ts
  console.log(`Match artifact: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/manifest.json`);
  console.log(`Match summary: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/summary.json`);
  console.log(`Match replay: ${OUTPUT_DIR}/matches/${artifact.manifest.matchId}/replay.jsonl`);
```

- [ ] **Step 6: Run the demo and verify artifact files**

Run:

```bash
pnpm --filter local-simulation start -- 2 artifact-plan-seed
```

Expected: command exits 0 and prints `Match artifact: .../matches/{matchId}/manifest.json`.

Run:

```bash
find examples/local-simulation/output/matches -maxdepth 2 -type f
```

Expected: includes `manifest.json`, `summary.json`, `replay.jsonl`, and `index.json`.

- [ ] **Step 7: Commit**

Run:

```bash
git add examples/local-simulation/run-simulation.ts
git commit -m "Emit match artifacts from local simulation"
```

Expected in a git repository: commit succeeds. In the current workspace, record the missing `.git` state and continue.

---

## Task 4: Public Match Artifact API

**Files:**
- Create: `apps/api/src/routes/matches.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/simulate.ts`
- Create: `apps/api/src/__tests__/matches.test.ts`

- [ ] **Step 1: Write API tests first**

Create `apps/api/src/__tests__/matches.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;
let userCounter = 0;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  userCounter += 1;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({
      email: `match${userCounter}@x.test`,
      password: 'hunter22pw',
      displayName: `MatchUser${userCounter}`,
    }),
  });
  const setCookie = reg.headers['set-cookie'];
  const sid = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie || '').match(/apk_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`register did not set apk_sid: ${reg.body}`);
  cookie = sid;
});

afterEach(async () => {
  await app.close();
});

async function injectPost(path: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify(body),
  });
}

describe('match artifact API', () => {
  it('GET /api/v1/matches is public and starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/matches' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toEqual([]);
  });

  it('POST /simulate creates a match artifact visible through public routes', async () => {
    const sim = await injectPost('/api/v1/simulate', {
      name: 'Artifact Sim',
      maxSeats: 6,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'artifact-api-seed',
      defaultTimeoutMs: 1000,
      agents: [
        { name: 'B1', strategy: 'always-call', buyIn: 1000 },
        { name: 'B2', strategy: 'always-call', buyIn: 1000 },
      ],
      numHands: 1,
    });
    expect(sim.statusCode).toBe(200);
    const simBody = JSON.parse(sim.payload);
    const matchId = simBody.data.matchArtifact.matchId;
    expect(matchId).toBe(simBody.data.tableId);

    const list = await app.inject({ method: 'GET', url: '/api/v1/matches' });
    expect(list.statusCode).toBe(200);
    const listBody = JSON.parse(list.payload);
    expect(listBody.data.map((entry: { matchId: string }) => entry.matchId)).toContain(matchId);

    const record = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}` });
    expect(record.statusCode).toBe(200);
    const recordBody = JSON.parse(record.payload);
    expect(recordBody.data.summary.hands).toHaveLength(1);
    expect(recordBody.data.manifest.files.summary.sha256).toMatch(/^[a-f0-9]{64}$/);

    const replay = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}/replay` });
    expect(replay.statusCode).toBe(200);
    const replayBody = JSON.parse(replay.payload);
    expect(Array.isArray(replayBody.data)).toBe(true);
    expect(replayBody.data.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/matches/:matchId returns 404 for an unknown match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/matches/no-such-match' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the API test and verify it fails**

Run:

```bash
pnpm --filter api run test -- src/__tests__/matches.test.ts
```

Expected: FAIL because `/api/v1/matches` is not registered.

- [ ] **Step 3: Add match routes**

Create `apps/api/src/routes/matches.ts`:

```ts
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { IMatchArtifactStore } from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';

interface MatchesPluginOptions extends FastifyPluginOptions {
  matchArtifactStore: IMatchArtifactStore;
}

export async function matchesRoutes(app: FastifyInstance, opts: MatchesPluginOptions) {
  const { matchArtifactStore } = opts;

  app.get('/matches', async (_req, reply) => {
    const entries = await matchArtifactStore.listMatchArtifacts();
    reply.send({ data: entries });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId', async (req, reply) => {
    const record = await matchArtifactStore.getMatchArtifact(req.params.matchId);
    if (!record) {
      throw new AppError('MATCH_NOT_FOUND', `Match ${req.params.matchId} not found`);
    }
    reply.send({ data: record });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId/replay', async (req, reply) => {
    const record = await matchArtifactStore.getMatchArtifact(req.params.matchId);
    if (!record) {
      throw new AppError('MATCH_NOT_FOUND', `Match ${req.params.matchId} not found`);
    }
    reply.send({ data: record.replayEvents });
  });
}
```

- [ ] **Step 4: Wire the route into the server**

In `apps/api/src/server.ts`, update imports:

```ts
import {
  MemoryTableStore,
  MemoryHandStore,
  MemoryMatchArtifactStore,
  openDatabase,
  SqliteUserStore,
  SqliteSessionStore,
  SqliteUserAgentConfigStore,
} from '@agent-poker/persistence';
import type {
  IUserStore,
  ISessionStore,
  IUserAgentConfigStore,
  IMatchArtifactStore,
  SqliteDb,
} from '@agent-poker/persistence';
```

Add the route import:

```ts
import { matchesRoutes } from './routes/matches.js';
```

Add this field to `BuildServerOptions`:

```ts
  matchArtifactStore?: IMatchArtifactStore;
```

After the line that initializes `hs` from `opts.handStore`, add:

```ts
  const matchArtifactStore = opts.matchArtifactStore || new MemoryMatchArtifactStore();
```

Inside the route registration scope, replace the simulate registration and add matches:

```ts
    await scope.register(tablesRoutes, { prefix: '/api/v1', orchestrator: orch, handStore: hs, agentConfigStore });
    await scope.register(simulateRoutes, {
      prefix: '/api/v1',
      orchestrator: orch,
      handStore: hs,
      matchArtifactStore,
    });
    await scope.register(matchesRoutes, { prefix: '/api/v1', matchArtifactStore });
```

In the error `statusMap`, add:

```ts
        MATCH_NOT_FOUND: 404,
```

- [ ] **Step 5: Save artifacts in simulate route**

In `apps/api/src/routes/simulate.ts`, update imports:

```ts
import type { IHandStore, IMatchArtifactStore } from '@agent-poker/persistence';
```

Update `SimulatePluginOptions`:

```ts
interface SimulatePluginOptions extends FastifyPluginOptions {
  orchestrator: TableOrchestrator;
  handStore: IHandStore;
  matchArtifactStore: IMatchArtifactStore;
}
```

Replace `const { orchestrator } = opts;` with:

```ts
  const { orchestrator, handStore, matchArtifactStore } = opts;
```

After final stacks are computed and before `reply.send`, add:

```ts
      const replayEvents = (
        await Promise.all(hands.map(hand => handStore.getReplayEvents(hand.handId)))
      ).flat();

      const matchArtifact = await matchArtifactStore.saveMatchArtifact({
        matchId: table.tableId,
        tableId: table.tableId,
        name: body.name,
        seed: table.config.seed || body.seed || table.tableId,
        hands,
        replayEvents,
      });
```

Then add `matchArtifact` to the response data:

```ts
          matchArtifact: {
            matchId: matchArtifact.manifest.matchId,
            manifest: matchArtifact.manifest,
          },
```

- [ ] **Step 6: Run API tests and build**

Run:

```bash
pnpm --filter api run test -- src/__tests__/matches.test.ts
pnpm --filter api run test -- src/__tests__/api.integration.test.ts
pnpm --filter api run build
```

Expected: all listed tests PASS and build exits 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/api/src/routes/matches.ts apps/api/src/server.ts apps/api/src/routes/simulate.ts apps/api/src/__tests__/matches.test.ts
git commit -m "Expose match artifact API"
```

Expected in a git repository: commit succeeds. In the current workspace, record the missing `.git` state and continue.

---

## Task 5: Basic Public Replay Viewer

**Files:**
- Create: `apps/web/src/pages/MatchesPage.tsx`
- Create: `apps/web/src/pages/MatchReplayPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/LobbyPage.tsx`

- [ ] **Step 1: Run web build before the change**

Run:

```bash
pnpm --filter web run build
```

Expected: build exits 0 before the new routes are added.

- [ ] **Step 2: Add the match index page**

Create `apps/web/src/pages/MatchesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

interface MatchArtifactIndexEntry {
  matchId: string;
  tableId: string;
  name: string;
  seed: string;
  handCount: number;
  agentIds: string[];
  startedAt: number;
  completedAt: number;
  createdAt: number;
  artifactPath: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function MatchesPage() {
  const [matches, setMatches] = useState<MatchArtifactIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<MatchArtifactIndexEntry[]>('/matches')
      .then(data => {
        if (!alive) return;
        setMatches(data);
        setError(null);
      })
      .catch(e => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load matches');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Match Replays</h1>
        <Link to="/lobby">Lobby</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Hands</th>
            <th style={{ padding: 8 }}>Agents</th>
            <th style={{ padding: 8 }}>Completed</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {matches.map(match => (
            <tr key={match.matchId} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{match.name}</td>
              <td style={{ padding: 8 }}>{match.handCount}</td>
              <td style={{ padding: 8 }}>{match.agentIds.join(', ') || 'none'}</td>
              <td style={{ padding: 8 }}>{formatTime(match.completedAt)}</td>
              <td style={{ padding: 8 }}>
                <Link to={`/matches/${match.matchId}`}>Open replay</Link>
              </td>
            </tr>
          ))}
          {!loading && matches.length === 0 && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                No match artifacts have been published yet.
              </td>
            </tr>
          )}
          {loading && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Loading...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Add the match replay page**

Create `apps/web/src/pages/MatchReplayPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
type Suit = 'c' | 'd' | 'h' | 's';
interface Card { rank: Rank; suit: Suit }

interface ReplayEvent {
  eventId: string;
  handId: string;
  tableId: string;
  sequence: number;
  eventType: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface HandSummary {
  handId: string;
  handNumber: number;
  seed: string;
  communityCards: Card[];
  allActions: Array<{ playerId: string; actionType: string; amount: number }>;
  results: Array<{ playerId: string; winAmount: number; netChange: number }>;
}

interface MatchArtifactRecord {
  manifest: {
    matchId: string;
    tableId: string;
    createdAt: number;
    files: {
      summary: { sha256: string; bytes: number };
      replay: { sha256: string; bytes: number };
    };
  };
  summary: {
    matchId: string;
    tableId: string;
    name: string;
    seed: string;
    startedAt: number;
    completedAt: number;
    handIds: string[];
    hands: HandSummary[];
    finalStacks: Record<string, number>;
    agentIds: string[];
  };
  replayEvents: ReplayEvent[];
}

const SUIT_GLYPH: Record<Suit, string> = { s: 'S', h: 'H', d: 'D', c: 'C' };

function formatCard(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function MatchReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const [record, setRecord] = useState<MatchArtifactRecord | null>(null);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    api.get<MatchArtifactRecord>(`/matches/${matchId}`)
      .then(data => {
        if (!alive) return;
        setRecord(data);
        setSelectedHandId(data.summary.handIds[0] || null);
        setError(null);
      })
      .catch(e => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load match');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [matchId]);

  const selectedHand = useMemo(() => {
    if (!record || !selectedHandId) return null;
    return record.summary.hands.find(hand => hand.handId === selectedHandId) || null;
  }, [record, selectedHandId]);

  const selectedEvents = useMemo(() => {
    if (!record || !selectedHandId) return [];
    return record.replayEvents.filter(event => event.handId === selectedHandId);
  }, [record, selectedHandId]);

  if (!matchId) return <div className="page">Missing match id.</div>;
  if (loading) return <div className="page">Loading match...</div>;
  if (error) {
    return (
      <div className="page">
        <div className="error">{error}</div>
        <Link to="/matches">Back to matches</Link>
      </div>
    );
  }
  if (!record) return <div className="page">Match not found.</div>;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{record.summary.name}</h1>
        <div className="row">
          <Link to="/matches">Match replays</Link>
          <Link to="/lobby">Lobby</Link>
        </div>
      </div>

      <p className="muted">
        match {record.summary.matchId}
        {' · '}seed {record.summary.seed}
        {' · '}completed {formatTime(record.summary.completedAt)}
      </p>

      <section style={{ marginTop: 16 }}>
        <h2>Final Stacks</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(record.summary.finalStacks).map(([agentId, stack]) => (
            <span key={agentId} style={{ border: '1px solid #ccc', borderRadius: 4, padding: '6px 8px' }}>
              {agentId}: {stack}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Hands</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {record.summary.hands.map(hand => (
            <button
              key={hand.handId}
              onClick={() => setSelectedHandId(hand.handId)}
              style={{
                border: hand.handId === selectedHandId ? '2px solid #222' : '1px solid #bbb',
              }}
            >
              Hand {hand.handNumber}
            </button>
          ))}
        </div>
      </section>

      {selectedHand && (
        <section style={{ marginTop: 16 }}>
          <h2>Hand {selectedHand.handNumber}</h2>
          <p className="muted">seed {selectedHand.seed}</p>
          <div>
            Community:{' '}
            {selectedHand.communityCards.length === 0
              ? 'none'
              : selectedHand.communityCards.map(formatCard).join(' ')}
          </div>
          <h3>Actions</h3>
          <ol>
            {selectedHand.allActions.map((action, index) => (
              <li key={index}>
                {action.playerId} {action.actionType}
                {action.amount > 0 ? ` ${action.amount}` : ''}
              </li>
            ))}
          </ol>
          <h3>Results</h3>
          <ul>
            {selectedHand.results.map((result, index) => (
              <li key={index}>
                {result.playerId}: win {result.winAmount}, net {result.netChange}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <h2>Replay Events</h2>
        <ol
          style={{
            maxHeight: 360,
            overflowY: 'auto',
            background: '#fafafa',
            border: '1px solid #ddd',
            padding: '8px 24px',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          {selectedEvents.map(event => (
            <li key={event.eventId}>
              #{event.sequence} {event.eventType}
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>Artifact</h2>
        <p className="muted">
          summary sha256 {record.manifest.files.summary.sha256}
          <br />
          replay sha256 {record.manifest.files.replay.sha256}
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Register public routes**

In `apps/web/src/router.tsx`, add imports:

```ts
import { MatchesPage } from './pages/MatchesPage.js';
import { MatchReplayPage } from './pages/MatchReplayPage.js';
```

Add these route entries before the protected routes:

```tsx
  { path: '/matches', element: <MatchesPage /> },
  { path: '/matches/:matchId', element: <MatchReplayPage /> },
```

- [ ] **Step 5: Link from lobby**

In `apps/web/src/pages/LobbyPage.tsx`, in the top-right row that already contains `Agents`, add:

```tsx
          <Link to="/matches">Replays</Link>
```

- [ ] **Step 6: Run web build**

Run:

```bash
pnpm --filter web run build
```

Expected: build exits 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/src/pages/MatchesPage.tsx apps/web/src/pages/MatchReplayPage.tsx apps/web/src/router.tsx apps/web/src/pages/LobbyPage.tsx
git commit -m "Add public match replay pages"
```

Expected in a git repository: commit succeeds. In the current workspace, record the missing `.git` state and continue.

---

## Task 6: README Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update demo output documentation**

In `README.md`, replace the "Demo output" list with:

```md
Demo output:
- Per-hand summaries: `examples/local-simulation/output/{tableId}/{handId}.summary.json`
- Per-hand replay events: `examples/local-simulation/output/{tableId}/{handId}.replay.jsonl`
- Match artifact manifest: `examples/local-simulation/output/matches/{matchId}/manifest.json`
- Match summary: `examples/local-simulation/output/matches/{matchId}/summary.json`
- Match replay events: `examples/local-simulation/output/matches/{matchId}/replay.jsonl`
```

- [ ] **Step 2: Add match replay API examples**

In `README.md`, after the existing simulate API example, add:

````md
## Replay Artifact API

Match replay artifacts are public read-only resources:

```bash
# List match artifacts
curl http://localhost:3000/api/v1/matches

# Read one match artifact
curl http://localhost:3000/api/v1/matches/{matchId}

# Read replay events only
curl http://localhost:3000/api/v1/matches/{matchId}/replay
```

The web client exposes the same artifact at:

```text
http://localhost:5173/matches
http://localhost:5173/matches/{matchId}
```
````

- [ ] **Step 3: Run a documentation grep**

Run:

```bash
rg -n "match artifact|Replay Artifact API|/matches" README.md
```

Expected: output includes the new demo paths and `/matches` API URLs.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md
git commit -m "Document replay artifacts"
```

Expected in a git repository: commit succeeds. In the current workspace, record the missing `.git` state and continue.

---

## Task 7: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @agent-poker/agent-protocol run test -- src/__tests__/match-artifact-schema.test.ts
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
pnpm --filter api run test -- src/__tests__/matches.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run impacted existing tests**

Run:

```bash
pnpm --filter api run test -- src/__tests__/api.integration.test.ts
pnpm --filter @agent-poker/persistence run test -- src/__tests__/file-store.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 3: Run builds**

Run:

```bash
pnpm --filter @agent-poker/agent-protocol run build
pnpm --filter @agent-poker/persistence run build
pnpm --filter api run build
pnpm --filter web run build
```

Expected: each build exits 0.

- [ ] **Step 4: Run local simulation artifact verification**

Run:

```bash
pnpm --filter local-simulation start -- 2 artifact-final-seed
find examples/local-simulation/output/matches -maxdepth 2 -type f
```

Expected: simulation exits 0, and `find` prints at least one `manifest.json`, one `summary.json`, one `replay.jsonl`, and `index.json`.

- [ ] **Step 5: Run full workspace tests**

Run:

```bash
pnpm test
```

Expected: all workspace tests PASS.

- [ ] **Step 6: Check for unfinished markers in the implementation**

Run:

```bash
node -e "const { spawnSync } = require('node:child_process'); const pat = ['TB' + 'D', 'TO' + 'DO', 'FIX' + 'ME', 'Open ' + 'Decisions', '\\\\?' + '\\\\?'].join('|'); const r = spawnSync('rg', ['-n', pat, 'packages', 'apps', 'examples', 'README.md'], { stdio: 'inherit' }); if (r.status !== 0 && r.status !== 1) process.exit(r.status || 1);"
```

Expected: no output from files changed for this milestone. Existing unrelated hits outside the changed files should be noted separately and left untouched.

- [ ] **Step 7: Summarize completion evidence**

Record:

```text
Focused tests:
- agent-protocol match-artifact-schema: PASS
- persistence match-artifact-store: PASS
- api matches: PASS

Builds:
- agent-protocol: PASS
- persistence: PASS
- api: PASS
- web: PASS

Simulation:
- local-simulation emitted match manifest, summary, replay, and index: PASS

Full tests:
- pnpm test: PASS
```

If any command fails, stop and fix that failure before reporting completion.
