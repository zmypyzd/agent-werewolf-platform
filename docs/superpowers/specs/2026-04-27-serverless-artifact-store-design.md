# Serverless Artifact Store Design

## Goal

Make replay-first match artifacts durable and portable across serverless platforms without binding the project to Cloudflare, Vercel, AWS, or any single storage SDK. The next milestone keeps the existing public API and web replay experience stable while moving artifact persistence behind a provider-neutral object storage boundary.

## Non-Goals

- Do not add real-money gambling, deposits, betting odds, or financial transaction behavior.
- Do not integrate a vendor SDK in this milestone.
- Do not build the public submission ladder yet.
- Do not make always-on live streaming a dependency of the architecture.

## Recommended Approach

Add a small `IObjectStore` abstraction and implement `ObjectMatchArtifactStore` on top of it.

This gives the codebase one stable contract for serverless storage:

- local development can use a filesystem-backed object store;
- tests can use an in-memory object store;
- future deployments can add Cloudflare R2, S3, Vercel Blob, or another adapter without changing API routes, web routes, or match artifact semantics.

The existing `IMatchArtifactStore` remains the application-level contract. The new object store is an infrastructure-level contract used by a new match artifact store implementation.

## Components

### `IObjectStore`

Package: `packages/persistence`

Responsibilities:

- Store and retrieve UTF-8 text objects by key.
- List objects by prefix for provider-neutral index maintenance and diagnostics.
- Avoid path semantics in the public interface. Keys use `/` separators but are logical object keys, not filesystem paths.
- Preserve content type metadata where possible, while not requiring providers to support rich metadata.

Proposed shape:

```ts
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
```

### Object Store Implementations

`MemoryObjectStore`:

- Used in tests and default in-memory API mode.
- Deterministic list ordering.
- No network, no filesystem.

`FileObjectStore`:

- Used for local development and demos.
- Maps object keys under a configured base directory.
- Rejects unsafe keys: empty segments, `.`/`..`, absolute paths, backslashes, and traversal.
- Writes content atomically enough for local dev by writing the full object body per key.

No vendor-backed object store ships in this milestone. A future `R2ObjectStore`, `S3ObjectStore`, or `VercelBlobObjectStore` should implement `IObjectStore` only.

### `ObjectMatchArtifactStore`

Package: `packages/persistence`

Responsibilities:

- Save the same public-safe artifact files already produced today:
  - `matches/{matchId}/manifest.json`
  - `matches/{matchId}/summary.json`
  - `matches/{matchId}/replay.jsonl`
  - `matches/index.json`
- Keep manifest checksums based on the public-safe summary and public-safe replay files.
- Support `getMatchArtifact(matchId, { includeReplayEvents: false })` without reading `replay.jsonl`.
- Maintain newest-first index ordering.
- Enforce storage-level cost guards before writing.

This store should reuse shared artifact construction logic rather than duplicating privacy filtering, checksums, and serialization.

## Cost Controls

Cost controls are part of the storage write path, not just API validation.

Initial config:

```ts
export interface MatchArtifactCostLimits {
  maxReplayBytes: number;
  maxSummaryBytes: number;
  maxIndexEntries: number;
}
```

Recommended defaults:

- `maxReplayBytes`: 1 MiB per match
- `maxSummaryBytes`: 256 KiB per match
- `maxIndexEntries`: 100

Behavior:

- If `summary.json` or `replay.jsonl` exceeds its cap, reject the save with `ARTIFACT_LIMIT_EXCEEDED`.
- When writing `matches/index.json`, keep only the newest `maxIndexEntries`.
- API match detail continues to read manifest and summary only.
- Replay loading remains a separate endpoint.
- Existing `/simulate` hand cap of 20 remains in protocol validation and local demo behavior.

## Data Flow

### Save Match Artifact

1. Simulation or scheduled runner produces `HandSummary[]` and internal `ReplayEvent[]`.
2. `ObjectMatchArtifactStore.saveMatchArtifact()` builds the public-safe artifact:
   - strips private player card fields from summaries;
   - drops `hole_cards.dealt`;
   - strips nested `holeCards` defensively from replay payloads.
3. Store calculates checksums and byte sizes for public-safe files.
4. Store applies cost limits.
5. Store writes `summary.json`, `replay.jsonl`, and `manifest.json` to the object store.
6. Store upserts `matches/index.json`, preserving newest-first order and truncating to `maxIndexEntries`.

### Read Match Detail

1. API route calls `getMatchArtifact(matchId, { includeReplayEvents: false })`.
2. Store reads `manifest.json` and `summary.json`.
3. Store does not read `replay.jsonl`.
4. API returns `{ manifest, summary }`.

### Read Match Replay

1. API route calls `getMatchArtifact(matchId)`.
2. Store reads `manifest.json`, `summary.json`, and `replay.jsonl`.
3. API returns replay events.

## Configuration

Add a small factory for API construction:

```ts
type MatchArtifactStoreMode = 'memory' | 'file' | 'object';
```

Initial behavior:

- `memory`: existing `MemoryMatchArtifactStore`.
- `file`: existing file behavior can be preserved or routed through `FileObjectStore + ObjectMatchArtifactStore`.
- `object`: `ObjectMatchArtifactStore` with an injected `IObjectStore`.

The production serverless binding is not implemented in this milestone. Instead, tests prove that any `IObjectStore` implementation can back durable match artifacts.

## Scheduled Match Runner

Add only the reusable runner boundary in this milestone. Do not add platform cron integration yet.

Responsibilities:

- Accept a schedule definition in code or test fixtures.
- Run a bounded mock-agent match through existing orchestration.
- Save a match artifact through `IMatchArtifactStore`.
- Return a small result object with `matchId`, `handCount`, and manifest metadata.

Proposed shape:

```ts
export interface ScheduledMatchDefinition {
  name: string;
  seed: string;
  numHands: number;
  agents: Array<{
    name: string;
    strategy: 'random' | 'always-call' | 'always-fold' | 'aggressive';
    buyIn: number;
  }>;
}

export interface ScheduledMatchRunner {
  run(definition: ScheduledMatchDefinition): Promise<{
    matchId: string;
    handCount: number;
  }>;
}
```

This keeps future Cloudflare Cron, Vercel Cron, GitHub Actions, or queue workers as thin wrappers around a tested runner.

## Error Handling

- Invalid object keys throw an internal storage error before provider calls.
- Missing manifest or summary returns `null` from `getMatchArtifact`.
- Missing replay returns `null` only when replay events are requested.
- Artifact size violations throw `ARTIFACT_LIMIT_EXCEEDED`.
- API should map `ARTIFACT_LIMIT_EXCEEDED` to HTTP 413 or 400; 413 is preferred for payload-size semantics.
- Unsafe public match IDs continue to map to `MATCH_NOT_FOUND`, not public 500s.

## Testing

Add focused Vitest coverage:

- `MemoryObjectStore` stores, reads, lists by prefix, and enforces deterministic order.
- `FileObjectStore` maps keys safely and rejects traversal.
- `ObjectMatchArtifactStore` writes the expected four artifact objects.
- `ObjectMatchArtifactStore` reads metadata without reading replay content.
- `ObjectMatchArtifactStore` rejects oversized replay and oversized summary files.
- Index truncates to `maxIndexEntries`.
- Public-safe artifact guarantees remain covered: no `holeCards`, no `handEvaluation`, no `hole_cards.dealt`.
- Scheduled runner creates an artifact through `IMatchArtifactStore` with hand cap respected.

Run:

```bash
pnpm --filter @agent-poker/persistence run test
pnpm --filter api exec vitest run src/__tests__/matches.test.ts
pnpm lint
pnpm build
pnpm test
```

Full workspace tests that bind local loopback sockets may require elevated local permissions in the Codex sandbox.

## Rollout Plan

1. Introduce object store abstractions and tests.
2. Extract shared artifact construction helpers from `match-artifact-store.ts`.
3. Implement `ObjectMatchArtifactStore`.
4. Add cost-limit tests and errors.
5. Add the scheduled match runner boundary and local tests.
6. Wire API construction so object-backed match artifacts can be injected without changing routes.
7. Update README with provider-neutral deployment notes.

## Deferred Decisions

- Which production provider to use first: Cloudflare R2, S3-compatible storage, Vercel Blob, or another backend.
- Whether replay event payloads should be paginated by hand or byte range in the public API.
- Whether scheduled match definitions should live in source, database rows, or object storage manifests.
- Whether the future ladder submission flow should share this same object store for submitted agent bundles.
