# Serverless Artifact Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral object storage for durable public replay artifacts and a local scheduled match runner boundary.

**Architecture:** Keep `IMatchArtifactStore` as the app-facing contract. Add `IObjectStore` as an infrastructure contract, then implement `ObjectMatchArtifactStore` on top of it while reusing the existing public-safe artifact serialization path. Keep platform-specific storage SDKs out of this milestone.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Fastify, existing `@agent-poker/*` packages.

---

## File Structure

- Create `packages/persistence/src/object-store.ts`
  - Defines `IObjectStore`, `MemoryObjectStore`, and `FileObjectStore`.
- Create `packages/persistence/src/__tests__/object-store.test.ts`
  - Covers memory store behavior and file key safety.
- Create `packages/persistence/src/match-artifact-serialization.ts`
  - Moves public-safe artifact construction, checksums, serialization, index-entry creation, and safe match ID validation out of `match-artifact-store.ts`.
- Modify `packages/persistence/src/match-artifact-store.ts`
  - Uses serialization helpers and exports `ObjectMatchArtifactStore`.
- Modify `packages/persistence/src/__tests__/match-artifact-store.test.ts`
  - Adds object-backed artifact store coverage and cost-limit coverage.
- Modify `packages/shared/src/errors.ts`
  - Adds `ArtifactLimitExceededError`.
- Modify `apps/api/src/server.ts`
  - Maps `ARTIFACT_LIMIT_EXCEEDED` to HTTP 413.
- Create `apps/api/src/match-artifact-store-factory.ts`
  - Builds match artifact stores from explicit mode/config.
- Create `apps/api/src/__tests__/match-artifact-store-factory.test.ts`
  - Covers memory, file/object, and invalid config modes.
- Create `packages/table-orchestrator/src/scheduled-match-runner.ts`
  - Adds local scheduled match runner boundary.
- Create `packages/table-orchestrator/src/__tests__/scheduled-match-runner.test.ts`
  - Proves scheduled runner creates artifacts through `IMatchArtifactStore`.
- Modify `packages/table-orchestrator/src/index.ts`
  - Exports scheduled runner types and implementation.
- Modify `README.md`
  - Documents provider-neutral artifact storage and local scheduled runner boundary.

---

## Task 1: Object Store Abstraction

**Files:**
- Create: `packages/persistence/src/object-store.ts`
- Create: `packages/persistence/src/__tests__/object-store.test.ts`
- Modify: `packages/persistence/src/index.ts`

- [ ] **Step 1: Write failing object store tests**

Create `packages/persistence/src/__tests__/object-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileObjectStore, MemoryObjectStore } from '../object-store.js';

const dirs: string[] = [];

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `poker-object-store-${randomUUID()}`);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe('MemoryObjectStore', () => {
  it('stores, reads, checks existence, lists by prefix, and deletes text objects', async () => {
    const store = new MemoryObjectStore();
    await store.putText({ key: 'matches/a/summary.json', body: '{"a":1}', contentType: 'application/json' });
    await store.putText({ key: 'matches/a/replay.jsonl', body: '{}\n', contentType: 'application/x-ndjson' });
    await store.putText({ key: 'other/key.txt', body: 'x', contentType: 'text/plain' });

    expect(await store.getText('matches/a/summary.json')).toBe('{"a":1}');
    expect(await store.exists('matches/a/replay.jsonl')).toBe(true);
    expect((await store.list({ prefix: 'matches/a/' })).map(object => object.key)).toEqual([
      'matches/a/replay.jsonl',
      'matches/a/summary.json',
    ]);

    await store.delete('matches/a/summary.json');
    expect(await store.getText('matches/a/summary.json')).toBeNull();
  });

  it('applies list limits after prefix filtering', async () => {
    const store = new MemoryObjectStore();
    await store.putText({ key: 'matches/c.json', body: 'c', contentType: 'application/json' });
    await store.putText({ key: 'matches/a.json', body: 'a', contentType: 'application/json' });
    await store.putText({ key: 'matches/b.json', body: 'b', contentType: 'application/json' });

    expect((await store.list({ prefix: 'matches/', limit: 2 })).map(object => object.key)).toEqual([
      'matches/a.json',
      'matches/b.json',
    ]);
  });
});

describe('FileObjectStore', () => {
  it('stores object keys under the configured base directory', async () => {
    const dir = makeTmpDir();
    const store = new FileObjectStore(dir);

    await store.putText({ key: 'matches/a/summary.json', body: '{"ok":true}', contentType: 'application/json' });

    expect(await store.getText('matches/a/summary.json')).toBe('{"ok":true}');
    expect(fs.readFileSync(path.join(dir, 'matches', 'a', 'summary.json'), 'utf-8')).toBe('{"ok":true}');
  });

  it('rejects traversal and absolute object keys', async () => {
    const dir = makeTmpDir();
    const store = new FileObjectStore(dir);

    await expect(store.putText({ key: '../secret.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    await expect(store.putText({ key: '/absolute.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    await expect(store.putText({ key: 'matches\\bad.json', body: '{}', contentType: 'application/json' }))
      .rejects.toThrow('Invalid object key');
    expect(fs.existsSync(path.join(path.dirname(dir), 'secret.json'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the object store test and verify it fails**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/object-store.test.ts
```

Expected: FAIL because `../object-store.js` does not exist.

- [ ] **Step 3: Implement object stores**

Create `packages/persistence/src/object-store.ts`:

```ts
import fs from 'fs';
import path from 'path';

export interface ObjectStorePutTextInput {
  key: string;
  body: string;
  contentType: string;
}

export interface ObjectStoreListOptions {
  prefix?: string;
  limit?: number;
}

export interface ObjectStoreObjectInfo {
  key: string;
  bytes: number;
  contentType?: string;
  updatedAt?: number;
}

export interface IObjectStore {
  putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo>;
  getText(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  list(options?: ObjectStoreListOptions): Promise<ObjectStoreObjectInfo[]>;
  delete?(key: string): Promise<void>;
}

interface MemoryObjectRecord {
  body: string;
  contentType: string;
  updatedAt: number;
}

function validateObjectKey(key: string): string {
  const segments = key.split('/');
  if (
    key.length === 0 ||
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    key.includes('\\') ||
    segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return key;
}

function objectInfo(key: string, body: string, contentType: string | undefined, updatedAt: number): ObjectStoreObjectInfo {
  return {
    key,
    bytes: Buffer.byteLength(body, 'utf-8'),
    contentType,
    updatedAt,
  };
}

export class MemoryObjectStore implements IObjectStore {
  private records = new Map<string, MemoryObjectRecord>();

  async putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo> {
    const key = validateObjectKey(input.key);
    const updatedAt = Date.now();
    this.records.set(key, {
      body: input.body,
      contentType: input.contentType,
      updatedAt,
    });
    return objectInfo(key, input.body, input.contentType, updatedAt);
  }

  async getText(key: string): Promise<string | null> {
    return this.records.get(validateObjectKey(key))?.body ?? null;
  }

  async exists(key: string): Promise<boolean> {
    return this.records.has(validateObjectKey(key));
  }

  async list(options: ObjectStoreListOptions = {}): Promise<ObjectStoreObjectInfo[]> {
    const prefix = options.prefix ?? '';
    if (prefix.length > 0) validateObjectKey(`${prefix}placeholder`);
    const all = [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, record]) => objectInfo(key, record.body, record.contentType, record.updatedAt));
    return options.limit !== undefined ? all.slice(0, options.limit) : all;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(validateObjectKey(key));
  }
}

export class FileObjectStore implements IObjectStore {
  constructor(private readonly baseDir: string) {}

  async putText(input: ObjectStorePutTextInput): Promise<ObjectStoreObjectInfo> {
    const key = validateObjectKey(input.key);
    const file = this.filePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, input.body, 'utf-8');
    return objectInfo(key, input.body, input.contentType, Date.now());
  }

  async getText(key: string): Promise<string | null> {
    const file = this.filePath(validateObjectKey(key));
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.filePath(validateObjectKey(key)));
  }

  async list(options: ObjectStoreListOptions = {}): Promise<ObjectStoreObjectInfo[]> {
    const prefix = options.prefix ?? '';
    if (prefix.length > 0) validateObjectKey(`${prefix}placeholder`);
    if (!fs.existsSync(this.baseDir)) return [];

    const keys = this.walk(this.baseDir)
      .map(file => path.relative(this.baseDir, file).split(path.sep).join('/'))
      .filter(key => key.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));

    const entries = keys.map(key => {
      const file = this.filePath(key);
      const body = fs.readFileSync(file, 'utf-8');
      return objectInfo(key, body, undefined, fs.statSync(file).mtimeMs);
    });

    return options.limit !== undefined ? entries.slice(0, options.limit) : entries;
  }

  async delete(key: string): Promise<void> {
    const file = this.filePath(validateObjectKey(key));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  private filePath(key: string): string {
    return path.join(this.baseDir, ...validateObjectKey(key).split('/'));
  }

  private walk(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
      const next = path.join(dir, entry.name);
      return entry.isDirectory() ? this.walk(next) : [next];
    });
  }
}
```

- [ ] **Step 4: Export object store classes**

Modify `packages/persistence/src/index.ts`:

```ts
export * from './store-interface.js';
export * from './memory-store.js';
export * from './file-store.js';
export * from './object-store.js';
export * from './match-artifact-store.js';
export * from './sqlite/index.js';
```

- [ ] **Step 5: Run object store tests and commit**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/object-store.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/persistence/src/object-store.ts packages/persistence/src/__tests__/object-store.test.ts packages/persistence/src/index.ts
git commit -m "Add provider-neutral object store"
```

---

## Task 2: Extract Match Artifact Serialization

**Files:**
- Create: `packages/persistence/src/match-artifact-serialization.ts`
- Modify: `packages/persistence/src/match-artifact-store.ts`
- Modify: `packages/persistence/src/__tests__/match-artifact-store.test.ts`

- [ ] **Step 1: Run existing match artifact tests as the safety baseline**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
```

Expected: PASS before refactor.

- [ ] **Step 2: Extract serialization helpers**

Create `packages/persistence/src/match-artifact-serialization.ts` by moving the current helper logic from `match-artifact-store.ts`:

```ts
import { createHash } from 'crypto';
import path from 'path';
import type {
  HandSummary,
  MatchArtifactFileRef,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchArtifactRecord,
  MatchSummary,
  PublicHandSummary,
  ReplayEvent,
} from '@agent-poker/shared';
import type { SaveMatchArtifactInput } from './match-artifact-store.js';

export interface SerializedMatchArtifact {
  record: MatchArtifactRecord;
  summaryRaw: string;
  replayRaw: string;
  manifestRaw: string;
}

export function safePathSegment(matchId: string): string {
  if (
    matchId === '' ||
    matchId === '.' ||
    matchId === '..' ||
    path.isAbsolute(matchId) ||
    path.win32.isAbsolute(matchId) ||
    matchId.includes('/') ||
    matchId.includes('\\')
  ) {
    throw new Error(`Invalid matchId path segment: ${matchId}`);
  }
  return matchId;
}

export function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeReplayEvents(replayEvents: ReplayEvent[]): string {
  return replayEvents.map(event => JSON.stringify(event)).join('\n') +
    (replayEvents.length > 0 ? '\n' : '');
}

export function fileRef(filePath: string, raw: string, contentType: string): MatchArtifactFileRef {
  return {
    path: filePath,
    sha256: sha256(raw),
    bytes: Buffer.byteLength(raw, 'utf-8'),
    contentType,
  };
}

export function toIndexEntry(record: MatchArtifactRecord): MatchArtifactIndexEntry {
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

export function buildArtifact(input: SaveMatchArtifactInput, createdAt = Date.now()): SerializedMatchArtifact {
  const summary = buildSummary(input);
  const replayEvents = toPublicReplayEvents(sortReplayEvents(summary, input.replayEvents));
  const summaryRaw = serializeJson(summary);
  const replayRaw = serializeReplayEvents(replayEvents);
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

  const record = { manifest, summary, replayEvents };
  return { record, summaryRaw, replayRaw, manifestRaw: serializeJson(manifest) };
}

function toPublicHandSummary(hand: HandSummary): PublicHandSummary {
  return {
    ...hand,
    players: hand.players.map(player => {
      const { holeCards: _holeCards, handEvaluation: _handEvaluation, ...publicPlayer } = player;
      return publicPlayer;
    }),
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
    hands: hands.map(toPublicHandSummary),
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

function toPublicReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
  return events
    .map(event => replayEventToPublicArtifact(event))
    .filter((event): event is ReplayEvent => event !== null);
}

function replayEventToPublicArtifact(event: ReplayEvent): ReplayEvent | null {
  if (event.eventType === 'hole_cards.dealt') return null;
  if (containsPrivateCards(event.data)) {
    return { ...event, data: stripPrivateCards(event.data) as Record<string, unknown> };
  }
  return event;
}

function containsPrivateCards(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsPrivateCards);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'holeCards') return true;
    if (containsPrivateCards(child)) return true;
  }
  return false;
}

function stripPrivateCards(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripPrivateCards);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'holeCards') continue;
    output[key] = stripPrivateCards(child);
  }
  return output;
}
```

- [ ] **Step 3: Simplify `match-artifact-store.ts` imports and remove duplicated helpers**

Modify `packages/persistence/src/match-artifact-store.ts` so it imports:

```ts
import {
  buildArtifact,
  safePathSegment,
  toIndexEntry,
} from './match-artifact-serialization.js';
```

Remove the now-duplicated helper functions from `match-artifact-store.ts`. Keep only:

- `SaveMatchArtifactInput`
- `GetMatchArtifactOptions`
- `IMatchArtifactStore`
- `SequencedMatchArtifactRecord`
- `MemoryMatchArtifactStore`
- `FileMatchArtifactStore`

- [ ] **Step 4: Run match artifact tests and commit**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
```

Expected: PASS with the same 54 tests.

Commit:

```bash
git add packages/persistence/src/match-artifact-store.ts packages/persistence/src/match-artifact-serialization.ts
git commit -m "Extract match artifact serialization"
```

---

## Task 3: Object-Backed Match Artifact Store With Cost Limits

**Files:**
- Modify: `packages/persistence/src/match-artifact-store.ts`
- Modify: `packages/persistence/src/__tests__/match-artifact-store.test.ts`
- Modify: `packages/shared/src/errors.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing object artifact store tests**

Append to `packages/persistence/src/__tests__/match-artifact-store.test.ts`:

```ts
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
```

Add tests inside `describe('MatchArtifactStore', () => { ... })`:

```ts
  it('ObjectMatchArtifactStore writes manifest, summary, replay JSONL, and index objects', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore);
    const hand = makeHand(1, 1050);

    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });

    expect(record.manifest.matchId).toBe('tbl-12345678');
    expect(await objectStore.exists('matches/tbl-12345678/manifest.json')).toBe(true);
    expect(await objectStore.exists('matches/tbl-12345678/summary.json')).toBe(true);
    expect(await objectStore.exists('matches/tbl-12345678/replay.jsonl')).toBe(true);
    expect(await objectStore.exists('matches/index.json')).toBe(true);
  });

  it('ObjectMatchArtifactStore loads metadata without reading replay JSONL', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });
    await objectStore.delete?.('matches/tbl-12345678/replay.jsonl');

    const loaded = await store.getMatchArtifact('tbl-12345678', { includeReplayEvents: false });
    expect(loaded?.summary.matchId).toBe('tbl-12345678');
    expect(loaded?.replayEvents).toEqual([]);
  });

  it('ObjectMatchArtifactStore rejects oversized replay artifacts', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore, {
      maxReplayBytes: 10,
      maxSummaryBytes: 256 * 1024,
      maxIndexEntries: 100,
    });
    const hand = makeHand(1, 1050);

    await expect(store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    })).rejects.toBeInstanceOf(ArtifactLimitExceededError);
  });

  it('ObjectMatchArtifactStore truncates index entries to the configured cap', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore, {
      maxReplayBytes: 1024 * 1024,
      maxSummaryBytes: 256 * 1024,
      maxIndexEntries: 2,
    });

    await store.saveMatchArtifact({ matchId: 'match-a', tableId: 'tbl-a', name: 'A', seed: 'a', hands: [makeHand(1, 1000)], replayEvents: [] });
    await store.saveMatchArtifact({ matchId: 'match-b', tableId: 'tbl-b', name: 'B', seed: 'b', hands: [makeHand(2, 1100)], replayEvents: [] });
    await store.saveMatchArtifact({ matchId: 'match-c', tableId: 'tbl-c', name: 'C', seed: 'c', hands: [makeHand(3, 1200)], replayEvents: [] });

    const entries = await store.listMatchArtifacts();
    expect(entries.map(entry => entry.matchId)).toEqual(['match-c', 'match-b']);
  });
```

Also update the existing import list from `../match-artifact-store.js` to include `ObjectMatchArtifactStore`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
```

Expected: FAIL because `ObjectMatchArtifactStore` and `ArtifactLimitExceededError` do not exist.

- [ ] **Step 3: Add artifact limit error**

Modify `packages/shared/src/errors.ts`:

```ts
export class ArtifactLimitExceededError extends AppError {
  constructor(reason: string) { super('ARTIFACT_LIMIT_EXCEEDED', reason); }
}
```

Modify `apps/api/src/server.ts` status map:

```ts
ARTIFACT_LIMIT_EXCEEDED: 413,
```

- [ ] **Step 4: Implement `ObjectMatchArtifactStore`**

Append to `packages/persistence/src/match-artifact-store.ts`:

```ts
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import type { IObjectStore } from './object-store.js';
```

Add:

```ts
export interface MatchArtifactCostLimits {
  maxReplayBytes: number;
  maxSummaryBytes: number;
  maxIndexEntries: number;
}

const DEFAULT_MATCH_ARTIFACT_COST_LIMITS: MatchArtifactCostLimits = {
  maxReplayBytes: 1024 * 1024,
  maxSummaryBytes: 256 * 1024,
  maxIndexEntries: 100,
};

export class ObjectMatchArtifactStore implements IMatchArtifactStore {
  private readonly limits: MatchArtifactCostLimits;

  constructor(
    private readonly objectStore: IObjectStore,
    limits: Partial<MatchArtifactCostLimits> = {},
  ) {
    this.limits = { ...DEFAULT_MATCH_ARTIFACT_COST_LIMITS, ...limits };
  }

  async saveMatchArtifact(input: SaveMatchArtifactInput): Promise<MatchArtifactRecord> {
    safePathSegment(input.matchId);
    const { record, summaryRaw, replayRaw, manifestRaw } = buildArtifact(input);
    this.assertWithinLimits(summaryRaw, replayRaw);
    const matchPrefix = `matches/${record.manifest.matchId}`;

    await this.objectStore.putText({
      key: `${matchPrefix}/summary.json`,
      body: summaryRaw,
      contentType: 'application/json',
    });
    await this.objectStore.putText({
      key: `${matchPrefix}/replay.jsonl`,
      body: replayRaw,
      contentType: 'application/x-ndjson',
    });
    await this.objectStore.putText({
      key: `${matchPrefix}/manifest.json`,
      body: manifestRaw,
      contentType: 'application/json',
    });
    await this.upsertIndex(toIndexEntry(record));
    return record;
  }

  async getMatchArtifact(
    matchId: string,
    options: GetMatchArtifactOptions = {},
  ): Promise<MatchArtifactRecord | null> {
    const safeMatchId = safePathSegment(matchId);
    const matchPrefix = `matches/${safeMatchId}`;
    const manifestRaw = await this.objectStore.getText(`${matchPrefix}/manifest.json`);
    const summaryRaw = await this.objectStore.getText(`${matchPrefix}/summary.json`);
    if (!manifestRaw || !summaryRaw) return null;

    const manifest = JSON.parse(manifestRaw) as MatchArtifactManifest;
    const summary = JSON.parse(summaryRaw) as MatchSummary;
    if (options.includeReplayEvents === false) {
      return { manifest, summary, replayEvents: [] };
    }

    const replayRaw = await this.objectStore.getText(`${matchPrefix}/replay.jsonl`);
    if (!replayRaw) return null;
    const replayEvents = replayRaw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as ReplayEvent);

    return { manifest, summary, replayEvents };
  }

  async listMatchArtifacts(): Promise<MatchArtifactIndexEntry[]> {
    const raw = await this.objectStore.getText('matches/index.json');
    if (!raw) return [];
    const entries = JSON.parse(raw) as MatchArtifactIndexEntry[];
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  private assertWithinLimits(summaryRaw: string, replayRaw: string): void {
    const summaryBytes = Buffer.byteLength(summaryRaw, 'utf-8');
    const replayBytes = Buffer.byteLength(replayRaw, 'utf-8');
    if (summaryBytes > this.limits.maxSummaryBytes) {
      throw new ArtifactLimitExceededError(
        `Match summary is ${summaryBytes} bytes; limit is ${this.limits.maxSummaryBytes}`,
      );
    }
    if (replayBytes > this.limits.maxReplayBytes) {
      throw new ArtifactLimitExceededError(
        `Match replay is ${replayBytes} bytes; limit is ${this.limits.maxReplayBytes}`,
      );
    }
  }

  private async upsertIndex(entry: MatchArtifactIndexEntry): Promise<void> {
    const entries = await this.listMatchArtifacts();
    const next = [
      entry,
      ...entries.filter(existing => existing.matchId !== entry.matchId),
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

- [ ] **Step 5: Run persistence tests and commit**

Run:

```bash
pnpm --filter @agent-poker/persistence run test -- src/__tests__/match-artifact-store.test.ts
pnpm --filter @agent-poker/persistence run build
```

Expected: PASS.

Commit:

```bash
git add packages/persistence/src/match-artifact-store.ts packages/persistence/src/__tests__/match-artifact-store.test.ts packages/shared/src/errors.ts apps/api/src/server.ts
git commit -m "Add object-backed match artifact store"
```

---

## Task 4: API Store Factory

**Files:**
- Create: `apps/api/src/match-artifact-store-factory.ts`
- Create: `apps/api/src/__tests__/match-artifact-store-factory.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing factory tests**

Create `apps/api/src/__tests__/match-artifact-store-factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FileObjectStore,
  MemoryMatchArtifactStore,
  ObjectMatchArtifactStore,
} from '@agent-poker/persistence';
import { createMatchArtifactStore } from '../match-artifact-store-factory.js';

describe('createMatchArtifactStore', () => {
  it('returns memory store by default', () => {
    const store = createMatchArtifactStore({});
    expect(store).toBeInstanceOf(MemoryMatchArtifactStore);
  });

  it('returns object-backed file store when mode=file and base dir is provided', () => {
    const store = createMatchArtifactStore({
      MATCH_ARTIFACT_STORE: 'file',
      MATCH_ARTIFACT_BASE_DIR: '/tmp/poker-artifacts',
    });
    expect(store).toBeInstanceOf(ObjectMatchArtifactStore);
  });

  it('rejects file mode without a base dir', () => {
    expect(() => createMatchArtifactStore({ MATCH_ARTIFACT_STORE: 'file' }))
      .toThrow('MATCH_ARTIFACT_BASE_DIR is required when MATCH_ARTIFACT_STORE=file');
  });

  it('rejects object mode without an injected object store', () => {
    expect(() => createMatchArtifactStore({ MATCH_ARTIFACT_STORE: 'object' }))
      .toThrow('object mode requires an injected IObjectStore');
  });
});
```

- [ ] **Step 2: Run the factory test and verify it fails**

Run:

```bash
pnpm --filter api exec vitest run src/__tests__/match-artifact-store-factory.test.ts
```

Expected: FAIL because `match-artifact-store-factory.js` does not exist.

- [ ] **Step 3: Implement the factory**

Create `apps/api/src/match-artifact-store-factory.ts`:

```ts
import {
  FileObjectStore,
  MemoryMatchArtifactStore,
  ObjectMatchArtifactStore,
} from '@agent-poker/persistence';
import type { IMatchArtifactStore, IObjectStore } from '@agent-poker/persistence';

export interface MatchArtifactStoreEnv {
  MATCH_ARTIFACT_STORE?: string;
  MATCH_ARTIFACT_BASE_DIR?: string;
}

export interface MatchArtifactStoreFactoryOptions {
  objectStore?: IObjectStore;
}

export function createMatchArtifactStore(
  env: MatchArtifactStoreEnv = process.env,
  options: MatchArtifactStoreFactoryOptions = {},
): IMatchArtifactStore {
  const mode = env.MATCH_ARTIFACT_STORE ?? 'memory';

  if (mode === 'memory') return new MemoryMatchArtifactStore();

  if (mode === 'file') {
    const baseDir = env.MATCH_ARTIFACT_BASE_DIR;
    if (!baseDir) {
      throw new Error('MATCH_ARTIFACT_BASE_DIR is required when MATCH_ARTIFACT_STORE=file');
    }
    return new ObjectMatchArtifactStore(new FileObjectStore(baseDir));
  }

  if (mode === 'object') {
    if (!options.objectStore) {
      throw new Error('object mode requires an injected IObjectStore');
    }
    return new ObjectMatchArtifactStore(options.objectStore);
  }

  throw new Error(`Unsupported MATCH_ARTIFACT_STORE mode: ${mode}`);
}
```

- [ ] **Step 4: Wire server default construction through the factory**

Modify `apps/api/src/server.ts` imports:

```ts
import { createMatchArtifactStore } from './match-artifact-store-factory.js';
```

Replace:

```ts
const matchArtifactStore = opts.matchArtifactStore || new MemoryMatchArtifactStore();
```

with:

```ts
const matchArtifactStore = opts.matchArtifactStore || createMatchArtifactStore();
```

Remove `MemoryMatchArtifactStore` from the persistence import list if unused.

- [ ] **Step 5: Run API tests and commit**

Run:

```bash
pnpm --filter api exec vitest run src/__tests__/match-artifact-store-factory.test.ts src/__tests__/matches.test.ts
pnpm --filter api run build
```

Expected: PASS.

Commit:

```bash
git add apps/api/src/match-artifact-store-factory.ts apps/api/src/__tests__/match-artifact-store-factory.test.ts apps/api/src/server.ts
git commit -m "Add match artifact store factory"
```

---

## Task 5: Scheduled Match Runner Boundary

**Files:**
- Create: `packages/table-orchestrator/src/scheduled-match-runner.ts`
- Create: `packages/table-orchestrator/src/__tests__/scheduled-match-runner.test.ts`
- Modify: `packages/table-orchestrator/src/index.ts`
- Verify: `packages/table-orchestrator/package.json`
- Verify: `packages/table-orchestrator/tsconfig.json`

- [ ] **Step 1: Write failing scheduled runner test**

Create `packages/table-orchestrator/src/__tests__/scheduled-match-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryMatchArtifactStore, MemoryHandStore, MemoryTableStore } from '@agent-poker/persistence';
import { ScheduledMatchRunner } from '../scheduled-match-runner.js';

describe('ScheduledMatchRunner', () => {
  it('runs a bounded mock-agent match and saves a match artifact', async () => {
    const handStore = new MemoryHandStore();
    const tableStore = new MemoryTableStore();
    const matchArtifactStore = new MemoryMatchArtifactStore();
    const runner = new ScheduledMatchRunner(tableStore, handStore, matchArtifactStore);

    const result = await runner.run({
      name: 'Daily Mock Match',
      seed: 'daily-seed',
      numHands: 2,
      agents: [
        { name: 'Caller', strategy: 'always-call', buyIn: 1000 },
        { name: 'Folder', strategy: 'always-fold', buyIn: 1000 },
      ],
    });

    expect(result.handCount).toBeGreaterThan(0);
    expect(result.handCount).toBeLessThanOrEqual(2);
    const artifact = await matchArtifactStore.getMatchArtifact(result.matchId, { includeReplayEvents: false });
    expect(artifact?.summary.name).toBe('Daily Mock Match');
  });

  it('rejects scheduled matches above the 20-hand cap', async () => {
    const runner = new ScheduledMatchRunner(
      new MemoryTableStore(),
      new MemoryHandStore(),
      new MemoryMatchArtifactStore(),
    );

    await expect(runner.run({
      name: 'Too Large',
      seed: 'too-large',
      numHands: 21,
      agents: [
        { name: 'Caller', strategy: 'always-call', buyIn: 1000 },
        { name: 'Folder', strategy: 'always-fold', buyIn: 1000 },
      ],
    })).rejects.toThrow('numHands must be between 1 and 20');
  });
});
```

- [ ] **Step 2: Run the scheduled runner test and verify it fails**

Run:

```bash
pnpm --filter @agent-poker/table-orchestrator run test -- src/__tests__/scheduled-match-runner.test.ts
```

Expected: FAIL because `scheduled-match-runner.js` does not exist.

- [ ] **Step 3: Verify package dependency and tsconfig path**

Confirm `packages/table-orchestrator/package.json` dependencies include:

```json
"@agent-poker/persistence": "workspace:*"
```

Confirm `packages/table-orchestrator/tsconfig.json` paths and references include:

```json
"@agent-poker/persistence": ["../persistence/src/index.ts"]
```

and:

```json
{ "path": "../persistence" }
```

In the current baseline both entries already exist. If either entry is missing in the execution workspace, add it before implementing the runner.

- [ ] **Step 4: Implement scheduled runner**

Create `packages/table-orchestrator/src/scheduled-match-runner.ts`:

```ts
import { randomUUID } from 'crypto';
import type { IHandStore, IMatchArtifactStore, ITableStore } from '@agent-poker/persistence';
import {
  AggressiveAgent,
  AlwaysCallAgent,
  AlwaysFoldAgent,
  RandomMockAgent,
} from '@agent-poker/agent-runtime';
import { TableOrchestrator } from './orchestrator.js';

export type ScheduledMatchStrategy = 'random' | 'always-call' | 'always-fold' | 'aggressive';

export interface ScheduledMatchDefinition {
  name: string;
  seed: string;
  numHands: number;
  agents: Array<{
    name: string;
    strategy: ScheduledMatchStrategy;
    buyIn: number;
  }>;
}

export interface ScheduledMatchResult {
  matchId: string;
  handCount: number;
}

export class ScheduledMatchRunner {
  constructor(
    private readonly tableStore: ITableStore,
    private readonly handStore: IHandStore,
    private readonly matchArtifactStore: IMatchArtifactStore,
  ) {}

  async run(definition: ScheduledMatchDefinition): Promise<ScheduledMatchResult> {
    if (definition.numHands < 1 || definition.numHands > 20) {
      throw new Error('numHands must be between 1 and 20');
    }
    if (definition.agents.length < 2) {
      throw new Error('scheduled match requires at least 2 agents');
    }

    const orchestrator = new TableOrchestrator(this.tableStore, this.handStore);
    const table = await orchestrator.createTable({
      name: definition.name,
      maxSeats: Math.max(2, Math.min(9, definition.agents.length)),
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: definition.seed,
      defaultTimeoutMs: 5000,
    });

    for (const agentSpec of definition.agents) {
      const agentId = `scheduled-${randomUUID().slice(0, 8)}`;
      await orchestrator.addAgent(
        table.tableId,
        { agentId, name: agentSpec.name, adapterType: 'mock' },
        this.createAgent(agentSpec.strategy, agentId, agentSpec.name),
        agentSpec.buyIn,
        { ownerUserId: `scheduled-${agentId}`, adapterType: 'mock' },
      );
    }

    const hands = await orchestrator.runSimulation(table.tableId, definition.numHands);
    const replayEvents = (
      await Promise.all(hands.map(hand => this.handStore.getReplayEvents(hand.handId)))
    ).flat();

    const artifact = await this.matchArtifactStore.saveMatchArtifact({
      matchId: table.tableId,
      tableId: table.tableId,
      name: definition.name,
      seed: definition.seed,
      hands,
      replayEvents,
    });

    return {
      matchId: artifact.manifest.matchId,
      handCount: hands.length,
    };
  }

  private createAgent(strategy: ScheduledMatchStrategy, agentId: string, name: string) {
    switch (strategy) {
      case 'always-call': return new AlwaysCallAgent(agentId, name);
      case 'always-fold': return new AlwaysFoldAgent(agentId, name);
      case 'aggressive': return new AggressiveAgent(agentId, name);
      default: return new RandomMockAgent(agentId, name);
    }
  }
}
```

- [ ] **Step 5: Export scheduled runner**

Modify `packages/table-orchestrator/src/index.ts`:

```ts
export * from './orchestrator.js';
export * from './hand-runner.js';
export * from './scheduled-match-runner.js';
```

Preserve any existing exports already in the file.

- [ ] **Step 6: Run table orchestrator tests and commit**

Run:

```bash
pnpm --filter @agent-poker/table-orchestrator run test -- src/__tests__/scheduled-match-runner.test.ts
pnpm --filter @agent-poker/table-orchestrator run build
```

Expected: PASS.

Commit:

```bash
git add packages/table-orchestrator/package.json packages/table-orchestrator/tsconfig.json packages/table-orchestrator/src/scheduled-match-runner.ts packages/table-orchestrator/src/__tests__/scheduled-match-runner.test.ts packages/table-orchestrator/src/index.ts
git commit -m "Add scheduled match runner"
```

---

## Task 6: Documentation And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README provider-neutral storage notes**

Add a section under `Replay Artifact API`:

```md
### Serverless Artifact Storage

The replay artifact layer is provider-neutral. API routes depend on
`IMatchArtifactStore`, and durable object storage is accessed through
`IObjectStore`.

Current storage modes:

- `memory`: default for tests and local API startup; artifacts reset on restart.
- `file`: local filesystem-backed object store for durable local development.
- `object`: object-store backed match artifact store for injected serverless adapters.

Environment variables:

- `MATCH_ARTIFACT_STORE=memory|file`
- `MATCH_ARTIFACT_BASE_DIR=./artifact-data` when `MATCH_ARTIFACT_STORE=file`

No Cloudflare, Vercel, or S3 SDK is required for this milestone. Future provider
adapters should implement `IObjectStore`.
```

Add a section under current limitations:

```md
- Hosted serverless bindings are not implemented yet; this milestone provides
  the provider-neutral persistence boundary and local object-store adapter.
- Scheduled matches have a local runner boundary but no hosted cron integration yet.
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @agent-poker/persistence run test
pnpm --filter @agent-poker/table-orchestrator run test -- src/__tests__/scheduled-match-runner.test.ts
pnpm --filter api exec vitest run src/__tests__/match-artifact-store-factory.test.ts src/__tests__/matches.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm lint
pnpm build
pnpm test
```

Expected:

- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- `pnpm test`: PASS. In the Codex sandbox, loopback HTTP/WebSocket tests may require elevated execution because they bind local sockets.

- [ ] **Step 4: Scan for placeholders and stale docs**

Run:

```bash
rg -n 'TB[D]|TO[D]O|FIXM[E]' packages apps examples README.md docs/superpowers -g '!**/dist/**'
rg -n 'Cloudflare R2 is require[d]|Vercel Blob is require[d]|24/7 liv[e]' README.md docs/superpowers -g '!**/dist/**'
```

Expected: no unfinished placeholders and no provider-locking claims.

- [ ] **Step 5: Commit docs and verification fixes**

Commit:

```bash
git add README.md
git commit -m "Document provider-neutral artifact storage"
```

If verification requires small fixes, include only the files changed for those fixes in the commit and use:

```bash
git commit -m "Finish serverless artifact store baseline"
```

---

## Self-Review Checklist

- Spec coverage:
  - `IObjectStore`: Task 1.
  - Memory and file object stores: Task 1.
  - `ObjectMatchArtifactStore`: Task 3.
  - Cost limits: Task 3.
  - API store construction: Task 4.
  - Scheduled match runner boundary: Task 5.
  - README provider-neutral deployment notes: Task 6.
- No vendor SDK is introduced.
- `IMatchArtifactStore` remains the app-facing contract.
- Public-safe artifact guarantees remain in persistence tests.
- Full verification commands are listed with expected results.
