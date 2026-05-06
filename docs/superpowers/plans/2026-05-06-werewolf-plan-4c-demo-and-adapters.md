# Werewolf Plan 4c — End-to-End Demo + Real Adapters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive a full 9-AI werewolf match end-to-end through real HTTP-mediated agent adapters, with a reproducible local demo and an in-process E2E suite that exercises the orchestrator → HTTP adapter → mock-agent-server → response → engine path.

**Architecture:** Add a `WerewolfHttpAgentAdapter` that mirrors the poker `HttpAgentAdapter` shape — `IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>`, `WerewolfDecisionResponseSchema` for validation, `AbortController` for timeout. Add a `WerewolfWsAgentAdapter` placeholder that throws `NotImplementedError` (parity with poker). Build `examples/werewolf-local-simulation` that boots N in-process Fastify mock-agent servers, wires HTTP adapters to them, and runs one match through `WerewolfOrchestrator`, persisting via `ObjectWerewolfMatchArtifactStore(new FileObjectStore(...))`. Add an E2E test alongside the API that does the same shape but validates privacy invariants survive the live HTTP path.

**Tech Stack:** TypeScript 5.5 strict / NodeNext / `.js` extensions on relative imports. Node 20, pnpm 10.33.2 workspace. Vitest 2 for tests. Fastify 4 for both the API and the in-process mock-agent servers. `@agent-poker/agent-runtime`, `@agent-poker/agent-protocol`, `@agent-poker/werewolf-orchestrator`, `@agent-poker/persistence`. No new external dependencies.

**Scope discipline:**

- **In scope:** Items 1, 2, 3, 4, 6, 7 from the user brief (real HTTP adapter; WS stub; demo with persisted artifact; in-process E2E; `pnpm demo:werewolf` script; light overview doc + `CLAUDE.md` update).
- **Out of scope (deferred to a future plan):** Item 5 (werewolf `MatchAnalysisSummary` equivalent + `/analysis` route). The artifact already carries the data needed; an analysis summary can be a separate plan once we know what dimensions are interesting (role survival, average reasoning confidence by side, fallback rate by phase). Adding it now without a real consumer is YAGNI.
- **Not changed:** Privacy filter pipeline (`werewolfReplayEventToPublic`, `attachWerewolfHub`, the `match:`/`player:` topic gate, the `/api/v1/werewolf-matches/...` redaction) is already established in 4b. 4c reuses it; do **not** rebuild or bypass any of it.

**Pre-existing scaffolding 4c reuses (do not modify these contracts):**

- `WerewolfHubAttachment.attachMatch(matchId, ownership)` already filters night-phase actor identity from `match:` topic frames and gates `player:<userId>:<gameId>` to the owning user (`packages/werewolf-orchestrator/src/hub-integration.ts`).
- `apps/api/src/routes/werewolf-matches.ts` already strips `seed`, `files`, `privateStateHash`, `reasoningSummary` from every public response.
- `WerewolfDecisionResponseSchema` (`packages/agent-protocol/src/werewolf-schemas.ts`) is the only validator the new HTTP adapter is allowed to use.
- `werewolfFallback(req)` (`packages/werewolf-orchestrator/src/werewolf-fallback.ts`) is the runner-side fallback for adapter failures; the runner already wraps every agent call in `TimeoutHandler<WerewolfDecisionRequest, WerewolfDecisionResponse>` with this fallback. The HTTP adapter never returns a fallback itself — it throws on any failure and the runner's `TimeoutHandler` converts the throw into a fallback. This matches poker's contract (see `HttpAgentAdapter` test "keeps throwing on errors when wrapped by TimeoutHandler — fallback contract").

---

## File Structure

**New files:**

- `packages/agent-runtime/src/werewolf-http-agent-adapter.ts` — `WerewolfHttpAgentAdapter` class implementing `IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>`.
- `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts` — placeholder class throwing `NotImplementedError` (parity with `WsAgentAdapter`).
- `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts` — 7 cases mirroring `http-agent-adapter.test.ts` but with werewolf request/response shapes.
- `packages/agent-runtime/src/__tests__/werewolf-ws-agent-adapter.test.ts` — single case asserting the stub throws `NotImplementedError`.
- `examples/werewolf-local-simulation/package.json` — workspace package, deps mirror local-simulation + `werewolf-orchestrator` + `fastify`.
- `examples/werewolf-local-simulation/tsconfig.json` — composite tsconfig, references the same packages.
- `examples/werewolf-local-simulation/index.ts` — demo entry: spins up 9 in-process Fastify mock-agent servers, builds `WerewolfHttpAgentAdapter`s pointed at them, registers via `WerewolfOrchestrator.registerAgent`, runs the match, prints summary + artifact paths.
- `examples/werewolf-local-simulation/README.md` — short usage doc.
- `examples/werewolf-local-simulation/output/.gitkeep` — keeps the directory tracked.
- `apps/api/src/__tests__/werewolf-http-e2e.test.ts` — in-process Fastify API + 9 in-process mock-agent HTTP servers + 9 `WerewolfHttpAgentAdapter`s; runs one match, asserts public WS stream, owning-player private WS stream, and persisted artifact stay consistent and private fields stay redacted.
- `docs/agent-poker-werewolf-platform-overview.md` — light platform overview pointing at engine, agent protocol, orchestrator, API, demo.

**Modified files:**

- `packages/agent-runtime/src/index.ts` — re-export `werewolf-http-agent-adapter.js` + `werewolf-ws-agent-adapter.js`.
- `package.json` (workspace root) — add `"demo:werewolf": "pnpm --filter werewolf-local-simulation start"`.
- `.gitignore` — add patterns for `examples/werewolf-local-simulation/output/**/*.{json,jsonl}` (keep `.gitkeep`).
- `CLAUDE.md` — add `pnpm demo:werewolf` and one-line werewolf project note.
- `docs/agent-poker-platform-CLAUDE.md` — same edits as `CLAUDE.md` (the docs file is kept in sync per the docs section of `CLAUDE.md`).

**Files NOT touched (load-bearing for invariants — do not edit in 4c):**

- `packages/werewolf-orchestrator/src/hub-integration.ts`
- `packages/werewolf-orchestrator/src/match-runner.ts`
- `apps/api/src/routes/werewolf-matches.ts`
- `apps/api/src/routes/ws.ts`
- `packages/realtime/src/wire.ts`
- `apps/api/src/server.ts`

---

## Conventions reminder for the implementer

- **NodeNext + ESM + `.js` extensions:** every relative import inside a `.ts` source file must use `.js` (e.g. `import { X } from './foo.js'`). The TypeScript compiler enforces this.
- **Strict TypeScript:** `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. Any field that is conditionally present must be added by spreading a conditional object literal — `{ ...(x !== undefined ? { x } : {}) }` — not by assigning `undefined`. Indexed access into arrays returns `T | undefined` and must be narrowed.
- **No mocking of the engine:** integration/E2E tests must use the real `WerewolfOrchestrator` + `createGame` + the real `WerewolfMatchRunner`. Only mock the network endpoint (the agent-side HTTP server is implemented with the real Fastify, not stubbed).
- **No `Math.random`** in werewolf-engine (already enforced; not touched here). Demo agents use `WerewolfRandomMockAgent({ seed })` for reproducibility.
- **Tests live in `src/__tests__/`** colocated with the package; demo lives under `examples/`.
- **Per-package typecheck:** `pnpm --filter <pkg> run build` is the source of truth for type errors. `vitest` does not type-check.
- **Auth `/auth/me` shape**: `{ data: { user: { userId } } }` — must match in the E2E test.
- **`pnpm install` after adding a new workspace package** so the workspace-link symlink is created. Without this the demo + the API tests will fail to resolve `werewolf-local-simulation`.

---

## Task 1: `WerewolfHttpAgentAdapter`

**Files:**

- Create: `packages/agent-runtime/src/werewolf-http-agent-adapter.ts`
- Test: `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts`

This adapter is a near-clone of `HttpAgentAdapter` (`packages/agent-runtime/src/http-agent-adapter.ts`) but for werewolf request/response shapes. The only validator is `WerewolfDecisionResponseSchema` from `@agent-poker/agent-protocol`. The adapter must:

1. POST the `WerewolfDecisionRequest` body to `endpointUrl` as JSON.
2. Send `authHeaderName`/`authHeaderValue` if both are configured; never log the value.
3. Abort the request after `timeoutMs` via `AbortController` and throw a clear "aborted (timeout Nms)" error.
4. Reject any non-2xx status (`HTTP <status>`).
5. Reject malformed JSON bodies.
6. Reject schema-violating bodies with a message starting with `WerewolfDecisionResponseSchema`.
7. Pass `reasoningSummary` through verbatim when the schema accepts it (it has only `intent`, `confidence`, `keyObservations` — no `riskLevel` or `consideredActions`, unlike poker).

The runner wraps the adapter in `TimeoutHandler<…>` with `werewolfFallback`, so the adapter must always **throw** on failure rather than returning a synthesized response. This matches poker's contract.

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { WerewolfHttpAgentAdapter } from '../werewolf-http-agent-adapter.js';
import { TimeoutHandler } from '../timeout-handler.js';
import { werewolfFallback } from '@agent-poker/werewolf-orchestrator';

interface ReceivedRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

async function startStub(handler: (received: ReceivedRequest) => {
  status?: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
}): Promise<{ url: string; close: () => Promise<void>; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  const app = Fastify({ logger: false });
  app.post('/decide', async (req, reply) => {
    const r: ReceivedRequest = { body: req.body, headers: req.headers };
    received.push(r);
    const result = handler(r);
    if (result.delayMs) await new Promise((res) => setTimeout(res, result.delayMs));
    if (result.rawBody !== undefined) {
      return reply.status(result.status ?? 200).type('application/json').send(result.rawBody);
    }
    return reply.status(result.status ?? 200).send(result.body ?? {});
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  return { url: `http://127.0.0.1:${addr.port}/decide`, close: () => app.close(), received };
}

const baseReq: WerewolfDecisionRequest = {
  requestId: 'req-1',
  gameId: 'g-1',
  agentId: 'agent-1',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
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
  validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
  deadlineMs: 1000,
};

describe('WerewolfHttpAgentAdapter', () => {
  let stub: { url: string; close: () => Promise<void>; received: ReceivedRequest[] } | null = null;

  afterEach(async () => {
    if (stub) await stub.close();
    stub = null;
  });

  it('happy path: posts the request, returns the parsed WerewolfDecisionResponse', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    const resp: WerewolfDecisionResponse = await adapter.requestDecision(baseReq);
    expect(resp.requestId).toBe('req-1');
    expect(resp.action.type).toBe('werewolf-vote');
    expect(stub.received).toHaveLength(1);
    expect(stub.received[0]!.body).toMatchObject({ requestId: 'req-1', agentId: 'agent-1' });
  });

  it('passes structured public reasoning summaries through verbatim', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
        reasoningSummary: {
          intent: 'eliminate-suspected-seer',
          confidence: 0.7,
          keyObservations: ['p2 voted defensively last day'],
        },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    const resp = await adapter.requestDecision(baseReq);
    expect(resp.reasoningSummary?.intent).toBe('eliminate-suspected-seer');
    expect(resp.reasoningSummary?.confidence).toBe(0.7);
    expect(resp.reasoningSummary?.keyObservations).toEqual(['p2 voted defensively last day']);
  });

  it('non-2xx response throws — TimeoutHandler then converts to werewolfFallback', async () => {
    stub = await startStub(() => ({ status: 500, body: { error: 'boom' } }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/HTTP 500/);

    const wrapped = new TimeoutHandler(adapter, 1000, werewolfFallback);
    const { response, timedOut } = await wrapped.requestDecision(baseReq);
    expect(timedOut).toBe(true);
    expect(response.action).toEqual(baseReq.validActions[0]);
    expect(response.requestId).toBe('req-1');
  });

  it('malformed JSON body throws', async () => {
    stub = await startStub(() => ({ rawBody: 'not json {' }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/malformed JSON/);
  });

  it('schema-violating response throws with WerewolfDecisionResponseSchema in the message', async () => {
    stub = await startStub(() => ({ body: { foo: 'bar' } }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/WerewolfDecisionResponseSchema/);
  });

  it('hangs past timeoutMs → adapter aborts; TimeoutHandler returns fallback', async () => {
    stub = await startStub(() => ({
      delayMs: 500,
      body: {
        requestId: 'req-1', agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 50,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/aborted/);

    const wrapped = new TimeoutHandler(adapter, 50, werewolfFallback);
    const result = await wrapped.requestDecision(baseReq);
    expect(result.timedOut).toBe(true);
  });

  it('sends the auth header when configured, and does not write the value to stdout/stderr', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1', agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url,
      authHeaderName: 'Authorization', authHeaderValue: 'Bearer DO-NOT-LEAK',
      timeoutMs: 1000,
    });

    const writes: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStdout(chunk as never, ...args as []);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStderr(chunk as never, ...args as []);
    }) as typeof process.stderr.write;

    try {
      await adapter.requestDecision(baseReq);
    } finally {
      process.stdout.write = origStdout as typeof process.stdout.write;
      process.stderr.write = origStderr as typeof process.stderr.write;
    }

    expect(stub.received[0]!.headers['authorization']).toBe('Bearer DO-NOT-LEAK');
    expect(writes.join('')).not.toContain('DO-NOT-LEAK');
  });
});
```

> **Note on the cross-package import:** the test imports `werewolfFallback` from `@agent-poker/werewolf-orchestrator`. `agent-runtime`'s `package.json` does not list `werewolf-orchestrator` (and must not, to keep the dependency DAG pointed away from agent-runtime). Add it as a **devDependency** in Step 2 below — the runtime adapter itself will not import it, only the test does.

- [ ] **Step 2: Wire the test devDependency and verify the test fails**

Edit `packages/agent-runtime/package.json` and add to `devDependencies`:

```json
    "@agent-poker/werewolf-orchestrator": "workspace:*",
```

The full `devDependencies` block becomes:

```json
  "devDependencies": {
    "@agent-poker/werewolf-engine": "workspace:*",
    "@agent-poker/werewolf-orchestrator": "workspace:*",
    "fastify": "^4.28.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
```

Run:

```bash
pnpm install
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-http-agent-adapter.test.ts
```

Expected: FAIL — module `'../werewolf-http-agent-adapter.js'` not found.

> **Why a devDep cycle is OK here but not a runtime one:** TypeScript composite project references and the workspace dep DAG only constrain runtime/build edges. Vitest tests resolve at test-runtime and a devDep on `werewolf-orchestrator` from `agent-runtime` does not create a runtime cycle as long as no `src/*.ts` (only `src/__tests__/*.ts`) imports `werewolf-orchestrator`. The `tsconfig.json` `references` array already excludes `__tests__`, so per-package builds are unaffected.

- [ ] **Step 3: Implement `WerewolfHttpAgentAdapter`**

Create `packages/agent-runtime/src/werewolf-http-agent-adapter.ts`:

```typescript
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import { WerewolfDecisionResponseSchema } from '@agent-poker/agent-protocol';
import type { IAgent } from './agent-interface.js';

export interface WerewolfHttpAgentAdapterOptions {
  agentId: string;
  name: string;
  endpointUrl: string;
  authHeaderName?: string | null;
  authHeaderValue?: string | null;
  // Per-call timeout. The runner's TimeoutHandler also enforces a higher-level
  // timeout, so this acts as a fast-fail bound on the network call itself.
  timeoutMs: number;
}

export class WerewolfHttpAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  public readonly agentId: string;
  public readonly name: string;
  public readonly endpointUrl: string;
  private readonly authHeaderName: string | null;
  private readonly authHeaderValue: string | null;
  private readonly timeoutMs: number;

  constructor(opts: WerewolfHttpAgentAdapterOptions) {
    this.agentId = opts.agentId;
    this.name = opts.name;
    this.endpointUrl = opts.endpointUrl;
    this.authHeaderName = opts.authHeaderName ?? null;
    this.authHeaderValue = opts.authHeaderValue ?? null;
    this.timeoutMs = opts.timeoutMs;
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName] = this.authHeaderValue;
    }

    let resp: Response;
    try {
      resp = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        controller.signal.aborted
          ? `WerewolfHttpAgentAdapter ${this.agentId}: request aborted (timeout ${this.timeoutMs}ms)`
          : `WerewolfHttpAgentAdapter ${this.agentId}: network error ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(`WerewolfHttpAgentAdapter ${this.agentId}: HTTP ${resp.status}`);
    }

    let raw: unknown;
    try {
      raw = await resp.json();
    } catch (err) {
      throw new Error(
        `WerewolfHttpAgentAdapter ${this.agentId}: malformed JSON body (${(err as Error).message})`,
      );
    }

    const parsed = WerewolfDecisionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `WerewolfHttpAgentAdapter ${this.agentId}: response does not match WerewolfDecisionResponseSchema (${parsed.error.message})`,
      );
    }
    const { requestId, agentId, action, reasoningSummary } = parsed.data;
    return {
      requestId,
      agentId,
      action,
      ...(reasoningSummary !== undefined
        ? { reasoningSummary: toReasoningSummary(reasoningSummary) }
        : {}),
    };
  }
}

function toReasoningSummary(
  summary: NonNullable<
    ReturnType<typeof WerewolfDecisionResponseSchema.parse>['reasoningSummary']
  >,
): WerewolfReasoningSummary {
  return {
    intent: summary.intent,
    confidence: summary.confidence,
    keyObservations: [...summary.keyObservations],
  };
}
```

- [ ] **Step 4: Re-export from the runtime barrel**

Edit `packages/agent-runtime/src/index.ts` and add the line **directly after** the existing `export * from './ws-agent-adapter.js';`:

```typescript
export * from './werewolf-http-agent-adapter.js';
```

The full file should now be:

```typescript
export * from './agent-interface.js';
export * from './mock-agent.js';
export * from './random-mock-agent.js';
export * from './npc-strategies.js';
export * from './npc-agent.js';
export * from './timeout-handler.js';
export * from './http-agent-adapter.js';
export * from './ws-agent-adapter.js';
export * from './werewolf-http-agent-adapter.js';
export * from './human-agent.js';
export * from './bootstrap-script-generator.js';
export * from './werewolf-decision-request.js';
export * from './werewolf-mock-agent.js';
export * from './werewolf-random-mock-agent.js';
export * from './werewolf-prng.js';
```

- [ ] **Step 5: Run the build (the only typecheck) and the test**

```bash
pnpm --filter @agent-poker/agent-runtime run build
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-http-agent-adapter.test.ts
```

Expected: build succeeds with zero errors; all 7 test cases PASS.

If the build fails on `exactOptionalPropertyTypes` complaining about `reasoningSummary`, double-check the conditional spread — never assign `reasoningSummary: undefined`.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime/src/werewolf-http-agent-adapter.ts \
        packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts \
        packages/agent-runtime/src/index.ts \
        packages/agent-runtime/package.json
git commit -m "feat(agent-runtime): WerewolfHttpAgentAdapter

Mirrors HttpAgentAdapter for werewolf decision shapes. Validates
responses with WerewolfDecisionResponseSchema. AbortController-driven
timeout. Throws on every failure mode so the runner's TimeoutHandler
controls fallback semantics."
```

---

## Task 2: `WerewolfWsAgentAdapter` placeholder

**Files:**

- Create: `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts`
- Create: `packages/agent-runtime/src/__tests__/werewolf-ws-agent-adapter.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

Mirrors the poker `WsAgentAdapter`: stores constructor args, throws `NotImplementedError` from `requestDecision`. Locked-in placeholder so callers can name the type today; a real implementation can land in a follow-up plan.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-runtime/src/__tests__/werewolf-ws-agent-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
} from '@agent-poker/shared';
import { NotImplementedError } from '@agent-poker/shared';
import { WerewolfWsAgentAdapter } from '../werewolf-ws-agent-adapter.js';

const stubReq: WerewolfDecisionRequest = {
  requestId: 'r', gameId: 'g', agentId: 'a', playerId: 'p1',
  phase: 'night-werewolf-vote', nightNumber: 1, dayNumber: 0,
  publicState: {
    gameId: 'g', phase: 'night-werewolf-vote', nightNumber: 1, dayNumber: 0,
    players: [], history: [], winner: null,
  },
  privateState: {
    selfId: 'p1', selfRole: 'werewolf', selfSide: 'werewolf',
    knownAllies: [], seerKnowledge: [], witchView: null, hunterCanShoot: false,
  },
  validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
  deadlineMs: 1000,
};

describe('WerewolfWsAgentAdapter', () => {
  it('stores its identity and endpoint without invoking the network', () => {
    const a = new WerewolfWsAgentAdapter('a-1', 'Wolf', 'ws://example/ws');
    expect(a.agentId).toBe('a-1');
    expect(a.name).toBe('Wolf');
    expect(a.endpoint).toBe('ws://example/ws');
  });

  it('requestDecision throws NotImplementedError', async () => {
    const a = new WerewolfWsAgentAdapter('a-1', 'Wolf', 'ws://example/ws');
    await expect(a.requestDecision(stubReq)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
```

Run it to confirm failure:

```bash
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-ws-agent-adapter.test.ts
```

Expected: FAIL — module `'../werewolf-ws-agent-adapter.js'` not found.

- [ ] **Step 2: Implement the placeholder**

Create `packages/agent-runtime/src/werewolf-ws-agent-adapter.ts`:

```typescript
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { NotImplementedError } from '@agent-poker/shared';
import type { IAgent } from './agent-interface.js';

export class WerewolfWsAgentAdapter
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    public readonly endpoint: string,
  ) {}

  async requestDecision(_req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    throw new NotImplementedError('WerewolfWsAgentAdapter');
  }
}
```

- [ ] **Step 3: Re-export**

Edit `packages/agent-runtime/src/index.ts` and add **immediately after** the new HTTP adapter export:

```typescript
export * from './werewolf-ws-agent-adapter.js';
```

The export block should now contain (in order):

```typescript
export * from './http-agent-adapter.js';
export * from './ws-agent-adapter.js';
export * from './werewolf-http-agent-adapter.js';
export * from './werewolf-ws-agent-adapter.js';
```

- [ ] **Step 4: Build and test**

```bash
pnpm --filter @agent-poker/agent-runtime run build
pnpm --filter @agent-poker/agent-runtime exec vitest run src/__tests__/werewolf-ws-agent-adapter.test.ts
```

Expected: build clean; both cases PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/werewolf-ws-agent-adapter.ts \
        packages/agent-runtime/src/__tests__/werewolf-ws-agent-adapter.test.ts \
        packages/agent-runtime/src/index.ts
git commit -m "feat(agent-runtime): WerewolfWsAgentAdapter placeholder

NotImplementedError parity with poker's WsAgentAdapter. Lets callers
name the type today; a real WS implementation can land later without
churning consumers."
```

---

## Task 3: `examples/werewolf-local-simulation` skeleton

**Files:**

- Create: `examples/werewolf-local-simulation/package.json`
- Create: `examples/werewolf-local-simulation/tsconfig.json`
- Create: `examples/werewolf-local-simulation/output/.gitkeep`
- Create: `examples/werewolf-local-simulation/README.md`
- Modify: `.gitignore`

This task wires the workspace package so subsequent tasks can `pnpm install` and `pnpm --filter werewolf-local-simulation start` it. The actual `index.ts` content lands in Task 4.

- [ ] **Step 1: Create the package.json**

Create `examples/werewolf-local-simulation/package.json`:

```json
{
  "name": "werewolf-local-simulation",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx index.ts",
    "build": "echo 'No build for examples'"
  },
  "dependencies": {
    "@agent-poker/shared": "workspace:*",
    "@agent-poker/agent-protocol": "workspace:*",
    "@agent-poker/agent-runtime": "workspace:*",
    "@agent-poker/persistence": "workspace:*",
    "@agent-poker/werewolf-orchestrator": "workspace:*",
    "fastify": "^4.28.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create the tsconfig.json**

Create `examples/werewolf-local-simulation/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "composite": true,
    "paths": {
      "@agent-poker/shared": ["../../packages/shared/src/index.ts"],
      "@agent-poker/agent-protocol": ["../../packages/agent-protocol/src/index.ts"],
      "@agent-poker/agent-runtime": ["../../packages/agent-runtime/src/index.ts"],
      "@agent-poker/persistence": ["../../packages/persistence/src/index.ts"],
      "@agent-poker/werewolf-orchestrator": ["../../packages/werewolf-orchestrator/src/index.ts"]
    }
  },
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/agent-protocol" },
    { "path": "../../packages/agent-runtime" },
    { "path": "../../packages/persistence" },
    { "path": "../../packages/werewolf-orchestrator" }
  ],
  "include": ["index.ts"]
}
```

- [ ] **Step 3: Create the output directory marker**

Create `examples/werewolf-local-simulation/output/.gitkeep` (an empty file).

```bash
mkdir -p examples/werewolf-local-simulation/output
: > examples/werewolf-local-simulation/output/.gitkeep
```

- [ ] **Step 4: Update root `.gitignore`**

The current `.gitignore` (relevant lines, already present):

```
examples/local-simulation/output/**/*.jsonl
examples/local-simulation/output/**/*.json
!examples/local-simulation/output/.gitkeep
```

…and:

```
examples/local-simulation/output/**/*.mp4
examples/local-simulation/output/**/*.png
examples/local-simulation/output/**/*.webp
```

Add the werewolf equivalents. After the existing `local-simulation` block, append:

```
examples/werewolf-local-simulation/output/**/*.jsonl
examples/werewolf-local-simulation/output/**/*.json
!examples/werewolf-local-simulation/output/.gitkeep
```

(No need to mirror the .mp4/.png/.webp lines — the demo only writes JSON/JSONL.)

- [ ] **Step 5: Create the README**

Create `examples/werewolf-local-simulation/README.md`:

````markdown
# Werewolf Local Simulation

In-process end-to-end demo of the multi-agent werewolf platform.
Spins up 9 in-process Fastify mock-agent HTTP servers, wires
`WerewolfHttpAgentAdapter`s into a `WerewolfOrchestrator`, runs
one match, and persists the artifact to `output/matches/<gameId>/`.

## Usage

```bash
pnpm install
pnpm demo:werewolf
# or, equivalently:
pnpm --filter werewolf-local-simulation start
```

Args (positional, optional):

```bash
pnpm demo:werewolf -- <gameId> <seed>
```

Defaults: `<gameId>` = `werewolf-demo-001`, `<seed>` = `werewolf-seed-001`.

## What it produces

```
examples/werewolf-local-simulation/output/
└── matches/
    └── <gameId>/
        ├── manifest.json
        ├── summary.json
        ├── replay.jsonl
        └── decision-trace.jsonl
```

Files match the persisted artifact shape `apps/api/src/routes/werewolf-matches.ts`
serves at `/api/v1/werewolf-matches/:id/...` once a real match has been recorded.

## Reproducibility

Each agent is seeded as `<seed>-<playerId>` so the entire match transcript
is deterministic for a given `<seed>`. Re-run with the same seed to verify
`replayEventCount` and `stepCount` match.
````

- [ ] **Step 6: Install and verify**

```bash
pnpm install
pnpm --filter werewolf-local-simulation run build
```

Expected: `pnpm install` symlinks the new workspace package; `run build` prints `No build for examples` and exits 0.

- [ ] **Step 7: Commit**

```bash
git add examples/werewolf-local-simulation/package.json \
        examples/werewolf-local-simulation/tsconfig.json \
        examples/werewolf-local-simulation/output/.gitkeep \
        examples/werewolf-local-simulation/README.md \
        .gitignore
git commit -m "chore(werewolf-local-simulation): scaffold workspace package

Adds a new example workspace package alongside local-simulation. The
demo entry point ships in the next commit; this commit only sets up
package metadata so the workspace symlink resolves."
```

---

## Task 4: `examples/werewolf-local-simulation/index.ts` — the demo

**Files:**

- Create: `examples/werewolf-local-simulation/index.ts`

The demo:

1. Parses optional CLI args (`gameId`, `seed`).
2. Creates one `WerewolfOrchestrator` wired to `ObjectWerewolfMatchArtifactStore(new FileObjectStore(OUTPUT_DIR))` and `MemoryWerewolfDecisionTraceStore`.
3. For each of the 9 players:
   - Constructs a `WerewolfRandomMockAgent` (server-side worker, seeded as `<seed>-<playerId>`).
   - Stands up a tiny Fastify server on `127.0.0.1:0` with one route `POST /decide` that reads the request body as a `WerewolfDecisionRequest`, calls the worker's `requestDecision`, and returns the JSON response.
   - Builds a `WerewolfHttpAgentAdapter` pointed at that server and registers it with the orchestrator under the player's id.
4. Runs the match.
5. Logs the summary, the persisted file paths, and shuts the 9 servers down.

Per-player timeout: 5 seconds (`WerewolfHttpAgentAdapter.timeoutMs = 5000`). The orchestrator itself uses `defaultTimeoutMs: 5000` (via `WerewolfMatchConfig`) so `TimeoutHandler` and the adapter share a budget; if the network is fine and the worker is in-process, neither will fire.

- [ ] **Step 1: Create `examples/werewolf-local-simulation/index.ts`**

```typescript
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  FileObjectStore,
  MemoryWerewolfDecisionTraceStore,
  ObjectWerewolfMatchArtifactStore,
} from '@agent-poker/persistence';
import {
  WerewolfHttpAgentAdapter,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import type { WerewolfPlayerId } from '@agent-poker/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

interface AgentServer {
  readonly playerId: WerewolfPlayerId;
  readonly agentId: string;
  readonly url: string;
  close(): Promise<void>;
}

// Spins up one Fastify server per seat. The handler validates the incoming
// WerewolfDecisionRequest with the shared Zod schema, then hands it to a
// seeded WerewolfRandomMockAgent. Real-network roundtrip without ever
// leaving 127.0.0.1.
async function startAgentServer(
  playerId: WerewolfPlayerId,
  playerName: string,
  seedBase: string,
): Promise<AgentServer> {
  const agentId = `agent-${playerId}`;
  const worker = new WerewolfRandomMockAgent(agentId, playerName, {
    seed: `${seedBase}-${playerId}`,
  });

  const app: FastifyInstance = Fastify({ logger: false });
  app.post('/decide', async (req, reply) => {
    const parsed = WerewolfDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    // The Zod-parsed request shape is structurally compatible with the
    // domain WerewolfDecisionRequest interface; cast at the seam.
    const response = await worker.requestDecision(
      parsed.data as unknown as Parameters<typeof worker.requestDecision>[0],
    );
    return reply.send(response);
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error(`agent ${playerId}: listen failed`);
  return {
    playerId,
    agentId,
    url: `http://127.0.0.1:${addr.port}/decide`,
    close: () => app.close(),
  };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const gameId = args[0] ?? 'werewolf-demo-001';
  const seed = args[1] ?? 'werewolf-seed-001';

  console.log('\n=========================================');
  console.log('  Agent Werewolf Platform — Local Sim    ');
  console.log('=========================================\n');
  console.log(`Game ID: ${gameId}`);
  console.log(`Seed:    ${seed}\n`);

  const artifactStore = new ObjectWerewolfMatchArtifactStore(new FileObjectStore(OUTPUT_DIR));
  const decisionTraceStore = new MemoryWerewolfDecisionTraceStore();
  const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore });

  const { matchId, initialState } = orch.createMatch({
    gameId,
    seed,
    defaultTimeoutMs: 5_000,
  });

  // Stand up 9 in-process agent servers and register HTTP adapters pointed at them.
  const servers: AgentServer[] = [];
  try {
    for (const player of initialState.players) {
      const server = await startAgentServer(player.id, player.name, seed);
      servers.push(server);
      const adapter = new WerewolfHttpAgentAdapter({
        agentId: server.agentId,
        name: player.name,
        endpointUrl: server.url,
        timeoutMs: 5_000,
      });
      orch.registerAgent(matchId, player.id, adapter);
    }
    console.log(`Seated ${servers.length} agents. Running match...\n`);

    const t0 = Date.now();
    const summary = await orch.runMatch(matchId);
    const elapsed = Date.now() - t0;

    console.log(`Winner:           ${summary.winner}`);
    console.log(`Nights:           ${summary.nightCount}`);
    console.log(`Days:             ${summary.dayCount}`);
    console.log(`Steps:            ${summary.stepCount}`);
    console.log(`Replay events:    ${summary.replayEventCount}`);
    console.log(`Wall-clock:       ${elapsed}ms\n`);

    console.log('Final players:');
    for (const p of summary.finalPlayers) {
      const status = p.alive ? 'alive ' : 'dead  ';
      console.log(`  [${status}] ${p.name.padEnd(12)} ${p.role.padEnd(8)} (${p.side})`);
    }
    console.log('');
    console.log(`Match artifact: ${OUTPUT_DIR}/matches/${matchId}/manifest.json`);
    console.log(`Summary:        ${OUTPUT_DIR}/matches/${matchId}/summary.json`);
    console.log(`Replay:         ${OUTPUT_DIR}/matches/${matchId}/replay.jsonl`);
    console.log(`Decision trace: ${OUTPUT_DIR}/matches/${matchId}/decision-trace.jsonl`);
    console.log('');
    console.log('=========================================');
    console.log('Werewolf simulation complete!');
    console.log('=========================================\n');
  } finally {
    await Promise.all(servers.map((s) => s.close()));
  }
}

main().catch((err) => {
  console.error('Werewolf simulation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck the example**

```bash
pnpm --filter werewolf-local-simulation exec tsc -p tsconfig.json --noEmit
```

Expected: zero errors. If `WerewolfDecisionRequestSchema`'s parsed shape doesn't match the runtime `WerewolfDecisionRequest` interface (e.g. `readonly` mismatch), the `as unknown as Parameters<...>[0]` cast handles it — there is one structural seam between the Zod schema's inferred type and the domain type, mirrored in production code.

- [ ] **Step 3: Run the demo end-to-end**

```bash
pnpm demo:werewolf
```

Wait — this will fail because the script isn't registered yet (Task 5). Run via the filter for now:

```bash
pnpm --filter werewolf-local-simulation start
```

Expected output: a winner line, 9 final players with revealed roles, and four artifact paths printed. The artifact files must exist:

```bash
ls examples/werewolf-local-simulation/output/matches/werewolf-demo-001/
```

Expected: `manifest.json`, `summary.json`, `replay.jsonl`, `decision-trace.jsonl` (4 files).

If the run hangs or never completes, check that `WerewolfRandomMockAgent` is being seeded (logs of "agent <id>: no valid action in phase" indicate a bug) and that no agent server is held open — the `try/finally` block must close all 9 servers.

- [ ] **Step 4: Re-run with the same seed and verify reproducibility**

```bash
pnpm --filter werewolf-local-simulation start -- werewolf-demo-001 werewolf-seed-001
pnpm --filter werewolf-local-simulation start -- werewolf-demo-002 werewolf-seed-001
```

Expected: both runs print the same `Steps:`, `Replay events:`, and `Winner:` values. Different `gameId`s only change the manifest's `matchId` — the seed determines the transcript.

If the two runs diverge, the `WerewolfRandomMockAgent` seed wiring is wrong. Check that each server passes `seed: \`${seedBase}-${playerId}\`` to its worker.

- [ ] **Step 5: Cleanup demo output and commit**

```bash
rm -rf examples/werewolf-local-simulation/output/matches
git status
```

Expected: only the new `index.ts` is staged-able; the `output/matches/` tree is gitignored.

```bash
git add examples/werewolf-local-simulation/index.ts
git commit -m "feat(werewolf-local-simulation): in-process 9-AI demo over real HTTP

Spins up 9 Fastify mock-agent servers on 127.0.0.1, wires
WerewolfHttpAgentAdapter into WerewolfOrchestrator, runs one match,
and persists the artifact to output/matches/<gameId>/. Mirrors the
poker local-simulation demo but over a real HTTP path."
```

---

## Task 5: `pnpm demo:werewolf` workspace script

**Files:**

- Modify: `package.json` (workspace root)

- [ ] **Step 1: Add the script**

Edit the root `package.json` `scripts` block. The relevant existing lines:

```json
    "dev:api": "pnpm --filter api dev",
    "demo": "pnpm --filter local-simulation start",
    "demo:local": "pnpm --filter local-simulation start"
```

Insert a `demo:werewolf` entry **immediately after** `demo:local`:

```json
    "dev:api": "pnpm --filter api dev",
    "demo": "pnpm --filter local-simulation start",
    "demo:local": "pnpm --filter local-simulation start",
    "demo:werewolf": "pnpm --filter werewolf-local-simulation start"
```

- [ ] **Step 2: Verify the script wires through**

```bash
pnpm demo:werewolf
```

Expected: same output as the previous task's `pnpm --filter werewolf-local-simulation start`. Match completes; artifact paths printed.

```bash
rm -rf examples/werewolf-local-simulation/output/matches
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(workspace): pnpm demo:werewolf shortcut

Mirrors the existing pnpm demo / pnpm demo:local scripts."
```

---

## Task 6: API E2E test — orchestrator drives 9 HTTP adapters

**Files:**

- Create: `apps/api/src/__tests__/werewolf-http-e2e.test.ts`

This is the integration test that proves the full path works without external network. The 4b suite (`werewolf-matches.integration.test.ts`) already exercises `attachWerewolfHub` with **in-process** mock agents. This 4c test exercises the **same path with HTTP-mediated agents** — orchestrator → `WerewolfHttpAgentAdapter` → in-process Fastify → `WerewolfRandomMockAgent` → response → engine. Validates:

1. The match completes and is persisted.
2. The spectator's `match:<gameId>` topic carries no actor identity in night phases.
3. The owning player's `player:<userId>:<gameId>` topic carries `werewolf.private_state` frames.
4. The persisted `/api/v1/werewolf-matches/:id/replay` is consistent with the live WS stream and carries no `seed`.
5. The persisted `/api/v1/werewolf-matches/:id/decision-trace` strips `privateStateHash` and `reasoningSummary`.

The test leans on `werewolf-matches.integration.test.ts`'s helpers (`registerAs`, `connectWs`, `awaitMessage`) — copy them into the new file rather than introducing a shared helper module (per CLAUDE.md, integration tests are colocated and self-contained).

- [ ] **Step 1: Create the failing test file**

Create `apps/api/src/__tests__/werewolf-http-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
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
import {
  WerewolfHttpAgentAdapter,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { RealtimeHub } from '@agent-poker/realtime';
import type { WerewolfPlayerId } from '@agent-poker/shared';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;

interface AgentServer {
  readonly playerId: WerewolfPlayerId;
  readonly agentId: string;
  readonly url: string;
  close(): Promise<void>;
}

async function startAgentServer(
  playerId: WerewolfPlayerId,
  playerName: string,
  seedBase: string,
): Promise<AgentServer> {
  const agentId = `agent-${playerId}`;
  const worker = new WerewolfRandomMockAgent(agentId, playerName, {
    seed: `${seedBase}-${playerId}`,
  });
  const a = Fastify({ logger: false });
  a.post('/decide', async (req, reply) => {
    const parsed = WerewolfDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const response = await worker.requestDecision(
      parsed.data as unknown as Parameters<typeof worker.requestDecision>[0],
    );
    return reply.send(response);
  });
  await a.listen({ host: '127.0.0.1', port: 0 });
  const addr = a.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  return {
    playerId,
    agentId,
    url: `http://127.0.0.1:${addr.port}/decide`,
    close: () => a.close(),
  };
}

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
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${await res.text()}`);
  const sid = /apk_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `apk_sid=${sid}` } });
  const meBody = await me.json() as { data: { user: { userId: string } } };
  return { sid, userId: meBody.data.user.userId };
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

function awaitMessage(
  messages: Array<Record<string, unknown>>,
  predicate: (m: Record<string, unknown>) => boolean,
  timeoutMs = 15_000,
) {
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

describe('werewolf E2E over real HTTP adapters', () => {
  it('orchestrator drives 9 HTTP-mediated mock agents; WS public stream and persisted artifact stay consistent and private fields stay redacted', async () => {
    const spectator = await registerAs('spec-w-http@x.test');
    const player1 = await registerAs('p1-w-http@x.test');

    const specClient = await connectWs(spectator.sid);
    const playerClient = await connectWs(player1.sid);

    const gameId = 'g-http-e2e';
    const matchTopic = `match:${gameId}`;
    const player1Topic = `player:${player1.userId}:${gameId}`;

    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'subscribe', payload: {} }));
    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'ping', payload: {} }));
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'pong');

    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'subscribe', payload: {} }));
    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'ping', payload: {} }));
    await awaitMessage(playerClient.messages, (m) => m['topic'] === player1Topic && m['type'] === 'pong');

    // Build the match.
    const { matchId, initialState } = orch.createMatch({
      gameId, seed: 'seed-http-e2e', defaultTimeoutMs: 5_000,
    });

    // Stand up 9 in-process agent servers and register HTTP adapters.
    const servers: AgentServer[] = [];
    try {
      for (const p of initialState.players) {
        const server = await startAgentServer(p.id, p.name, 'seed-http-e2e');
        servers.push(server);
        orch.registerAgent(
          matchId,
          p.id,
          new WerewolfHttpAgentAdapter({
            agentId: server.agentId,
            name: p.name,
            endpointUrl: server.url,
            timeoutMs: 5_000,
          }),
        );
      }

      // Map every player to player1.userId so player1's WS topic receives
      // every private-state emission regardless of role. Spectator must
      // still never see them — that is the cross-leak assertion.
      attachment.attachMatch(
        matchId,
        initialState.players.map((p) => ({ playerId: p.id, userId: player1.userId })),
      );

      await orch.runMatch(matchId);
      await awaitMessage(
        specClient.messages,
        (m) => m['topic'] === matchTopic && m['type'] === 'match.completed',
      );

      // 1. WS public stream observed events; sequence is monotonic; no actor
      //    identity in night-phase action frames.
      const liveEvents = specClient.messages
        .filter((m) => m['topic'] === matchTopic && m['type'] !== 'pong')
        .map((m) => ({
          type: m['type'] as string,
          payload: m['payload'] as Record<string, unknown>,
          sequence: ((m['payload'] as Record<string, unknown>)['sequence'] as number) ?? -1,
        }));
      expect(liveEvents.length).toBeGreaterThan(0);
      expect(liveEvents.every((e) => e.sequence >= 0)).toBe(true);
      for (let i = 1; i < liveEvents.length; i++) {
        expect(liveEvents[i]!.sequence).toBeGreaterThanOrEqual(liveEvents[i - 1]!.sequence);
      }
      const nightActionFrames = liveEvents.filter(
        (e) =>
          ['agent.action_requested', 'agent.action_received'].includes(e.type) &&
          ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.payload['phase'] as string),
      );
      expect(nightActionFrames.length).toBeGreaterThan(0);
      for (const f of nightActionFrames) {
        expect(f.payload['playerId']).toBeUndefined();
        expect(f.payload['agentId']).toBeUndefined();
      }

      // 2. The owning player saw private-state frames; spectator never did.
      const playerPrivate = playerClient.messages.filter(
        (m) => m['topic'] === player1Topic && m['type'] === 'werewolf.private_state',
      );
      expect(playerPrivate.length).toBeGreaterThan(0);
      expect(specClient.messages.filter((m) => m['topic'] === player1Topic).length).toBe(0);

      // 3. Persisted artifact replay matches the public WS frame count and
      //    carries no seed on match.started.
      const replayRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/replay`);
      expect(replayRes.status).toBe(200);
      const replayBody = await replayRes.json() as {
        data: Array<{ eventType: string; sequence: number; data: Record<string, unknown> }>;
      };
      expect(replayBody.data.length).toBe(liveEvents.length);
      expect(
        replayBody.data.find((e) => e.eventType === 'match.started')?.data['seed'],
      ).toBeUndefined();

      // 4. Persisted decision-trace strips privateStateHash + reasoningSummary.
      const traceRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/decision-trace`);
      expect(traceRes.status).toBe(200);
      const traceText = await traceRes.text();
      const traceData = JSON.parse(traceText) as { data: unknown[] };
      expect(traceData.data.length).toBeGreaterThan(0);
      expect(traceText).not.toContain('privateStateHash');
      expect(traceText).not.toContain('reasoningSummary');

      // 5. The match summary at /werewolf-matches/:id strips seed and files block.
      const summaryRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}`);
      expect(summaryRes.status).toBe(200);
      const summaryBody = await summaryRes.json() as {
        data: { manifest: Record<string, unknown>; summary: Record<string, unknown> };
      };
      expect(summaryBody.data.manifest['files']).toBeUndefined();
      expect(summaryBody.data.summary['seed']).toBeUndefined();
    } finally {
      await Promise.all(servers.map((s) => s.close()));
      specClient.ws.close();
      playerClient.ws.close();
    }
  }, 30_000);
});
```

- [ ] **Step 2: Run the test and verify it passes**

```bash
pnpm --filter api run build
pnpm --filter api exec vitest run src/__tests__/werewolf-http-e2e.test.ts
```

Expected: build clean; test PASSES within ~10s.

If the test times out at `awaitMessage(... 'match.completed')`, check that:

- Each `WerewolfHttpAgentAdapter` is being given a 5-second timeout (not 0).
- Each agent server's `/decide` returns the response synchronously.
- `attachment.attachMatch` is called **before** `orch.runMatch`. Listeners attached after the run starts will miss early events.

If the test fails on `expect(playerPrivate.length).toBeGreaterThan(0)`, the WS connection may be racing the runner. The `connectWs` + `subscribe` + `pong` handshake before `runMatch` is the synchronization barrier — leave it as written.

- [ ] **Step 3: Run the full API test suite to confirm no regressions**

```bash
pnpm --filter api run test
```

Expected: every test (existing + new) passes. The new file should be the only addition.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/werewolf-http-e2e.test.ts
git commit -m "test(api): werewolf E2E over real HTTP adapters

Drives 9 in-process Fastify agent servers via WerewolfHttpAgentAdapter
through the real WerewolfOrchestrator. Asserts the public WS stream,
the owning-player private stream, and the persisted artifact stay
consistent and private fields stay redacted — same invariants as the
4b WS test, but with the network path live."
```

---

## Task 7: `docs/agent-poker-werewolf-platform-overview.md`

**Files:**

- Create: `docs/agent-poker-werewolf-platform-overview.md`

A short overview that points readers at the existing engine and protocol docs and walks the runtime path. Mirrors the depth of the poker `agent-poker-platform-CLAUDE.md` but doesn't duplicate the engine spec (which lives in the engine plan) or the protocol spec (which lives in the agent-protocol plan).

- [ ] **Step 1: Create the doc**

Create `docs/agent-poker-werewolf-platform-overview.md`:

````markdown
# Werewolf Platform Overview

Companion to the poker platform docs. The werewolf system reuses the
same monorepo, the same dependency DAG, and the same realtime hub +
artifact-store machinery. This doc collects the werewolf-specific
pieces in one place.

## Component layering

```
shared (types: WerewolfGameState, WerewolfPublicState, WerewolfPrivateState,
        WerewolfReplayEvent, WerewolfDecisionTrace, AppError)
   │
   ├── agent-protocol (Zod: WerewolfDecisionRequestSchema, WerewolfDecisionResponseSchema)
   │
   ├── werewolf-engine (pure reducer: createGame, applyAction,
   │                    getPublicState, getPrivateState, getValidActions)
   │
   ├── agent-runtime (IAgent, TimeoutHandler, WerewolfRandomMockAgent,
   │                  WerewolfMockAgent, WerewolfHttpAgentAdapter,
   │                  WerewolfWsAgentAdapter)
   │
   ├── persistence (WerewolfMatchArtifactStore, WerewolfDecisionTraceStore;
   │                Memory + Object/File backends)
   │
   ├── realtime (RealtimeHub; werewolfMatchTopic, werewolfPlayerTopic;
   │             werewolfReplayEventToPublic redaction)
   │
   └── werewolf-orchestrator (WerewolfMatchRunner, WerewolfOrchestrator,
                              attachWerewolfHub, WerewolfMatchTtlCleaner)
```

`apps/api` consumes all of the above; `examples/werewolf-local-simulation`
drives the orchestrator through the real HTTP path.

## Information-isolation invariants

The werewolf domain is much stricter than poker about hidden information.
Five protected points, each defended by ≥2 layers and pinned by tests:

1. **Night actor identity** — `agent.action_requested` / `agent.action_received`
   replay events in night phases must not include `playerId` or `agentId`.
   Defended by: `werewolfReplayEventToPublic` (filters before persistence
   and before WS publish) + `attachWerewolfHub` (publishes only the public
   projection).
2. **Match seed** — never appears on `match.started` events that reach
   spectators or in `/api/v1/werewolf-matches/:id` responses. Defended by:
   `werewolfReplayEventToPublic` + `apps/api/src/routes/werewolf-matches.ts`
   stripping `seed` from summary + manifest's `files` block.
3. **`speak` action `inner` field** — agent's private rationale for the
   public speech. Stripped from the public `speak` replay event. Defended
   by: `sanitizeActionForBroadcast` + `werewolfReplayEventToPublic`.
4. **Decision trace `privateStateHash` + `reasoningSummary`** — persist
   for analysis but never serve over the public route. Defended by: type
   layer (`WerewolfDecisionTrace` carries them; the route's
   `PublicWerewolfDecisionTrace` Omit drops them) + the route's
   destructure-and-spread in `apps/api/src/routes/werewolf-matches.ts`.
5. **`player:<userId>:<gameId>` topic** — server-side gate in
   `apps/api/src/routes/ws.ts:isOwnPlayerTopic` (subscribe-time) +
   per-player ownership map in `attachWerewolfHub` (publish-time).

## Runtime data flow (one decision)

```
WerewolfOrchestrator.runMatch
  → WerewolfMatchRunner.run loop
    → engine.getValidActions(state, playerId)
    → buildWerewolfDecisionRequest(...)              (agent-runtime)
    → TimeoutHandler<…>(adapter, timeoutMs, werewolfFallback).requestDecision
        → WerewolfHttpAgentAdapter.requestDecision   (POSTs over HTTP, validates response)
    → validateWerewolfAction(state, response.action) (action-validator)
    → engine.applyAction(state, action)
    → emit WerewolfReplayEvent to orchestrator's emitter
        → attachWerewolfHub forwards public projection to RealtimeHub
        → match-runner's on('replay-event', …) buffers for persistence
    → emit private-state event for the next actor
        → attachWerewolfHub forwards to player:<userId>:<gameId>
  → at game-over: orchestrator persists the artifact via
    IWerewolfMatchArtifactStore.saveMatchArtifact
```

## Local demo

```bash
pnpm install
pnpm demo:werewolf
```

What it does (`examples/werewolf-local-simulation/index.ts`):

1. Boots one Fastify server per seat on `127.0.0.1:0`, each wrapping a
   seeded `WerewolfRandomMockAgent`.
2. Builds 9 `WerewolfHttpAgentAdapter` instances pointed at those
   servers.
3. Hands them to `WerewolfOrchestrator.registerAgent` and runs one match.
4. Persists the artifact to `examples/werewolf-local-simulation/output/matches/<gameId>/`.

The demo is the canonical reproduction of the production runtime path
without any external network hop.

## Tests

- Engine reducer: `packages/werewolf-engine/src/__tests__/`
- Action validator + fallback: `packages/werewolf-orchestrator/src/__tests__/`
- HTTP adapter: `packages/agent-runtime/src/__tests__/werewolf-http-agent-adapter.test.ts`
- E2E (orchestrator + HTTP adapters + WS hub + persisted artifact):
  `apps/api/src/__tests__/werewolf-http-e2e.test.ts`
- E2E (in-process agents + WS hub + persisted artifact):
  `apps/api/src/__tests__/werewolf-matches.integration.test.ts`

## Out of scope

The werewolf platform deliberately omits, as of Plan 4c:

- A `MatchAnalysisSummary`-equivalent and `/api/v1/werewolf-matches/:id/analysis`
  route. The data needed (per-agent latency, fallback rate, intent/confidence
  distribution by phase) is already captured in the persisted decision-trace
  artifact; an aggregator + route can land in a follow-up plan once a
  consumer is ready.
- A real `WerewolfWsAgentAdapter`. The class exists as a placeholder
  throwing `NotImplementedError`; a real implementation can land later
  without churning callers.
- Web UI for werewolf matches. `apps/web` currently surfaces the poker
  flow only; a werewolf live view is future work.
````

- [ ] **Step 2: Commit**

```bash
git add docs/agent-poker-werewolf-platform-overview.md
git commit -m "docs: werewolf platform overview

Light overview pointing at the existing engine + agent-protocol +
orchestrator + API docs. Anchors the five information-isolation
invariants and walks the runtime path."
```

---

## Task 8: `CLAUDE.md` + `docs/agent-poker-platform-CLAUDE.md` updates

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/agent-poker-platform-CLAUDE.md`

Add the werewolf demo command to the Commands block, add a one-line werewolf project note, and reference the new overview doc. The `docs/agent-poker-platform-CLAUDE.md` file is the longer-form mirror of `CLAUDE.md` per CLAUDE.md's own Documentation section, so it gets the same edits.

- [ ] **Step 1: Edit `CLAUDE.md` — Commands block**

In `CLAUDE.md`, find the line:

```
pnpm demo                                               # local simulation, see examples/local-simulation
```

Add a sibling line **immediately after** it:

```
pnpm demo:werewolf                                      # werewolf 9-AI simulation, see examples/werewolf-local-simulation
```

- [ ] **Step 2: Edit `CLAUDE.md` — Project section**

Find the existing line:

```
Multi-agent Texas Hold'em poker platform for technical experimentation.
```

Replace it with:

```
Multi-agent platform for technical experimentation: a Texas Hold'em
poker module and a 9-player werewolf module share the same monorepo,
agent-runtime, persistence, and realtime hub. See
`docs/agent-poker-werewolf-platform-overview.md` for the werewolf
architecture and information-isolation invariants.
```

(Keep the "**Not** a real-money product" sentence that follows it intact.)

- [ ] **Step 3: Edit `CLAUDE.md` — Conventions block**

Find the line:

```
- `examples/local-simulation` writes per-hand and per-match artifacts to `examples/local-simulation/output/...`; those JSON/JSONL files are gitignored.
```

Add a sibling line **immediately after**:

```
- `examples/werewolf-local-simulation` writes per-match artifacts to `examples/werewolf-local-simulation/output/matches/<gameId>/`; those JSON/JSONL files are gitignored.
```

- [ ] **Step 4: Mirror the same three edits in `docs/agent-poker-platform-CLAUDE.md`**

The docs file has the same structure (Project, Commands, Conventions). Apply the identical text changes to the matching sections.

- [ ] **Step 5: Run the full workspace build + test to confirm clean state**

```bash
pnpm build
pnpm test
```

Expected: every package builds; every test passes (including the new HTTP adapter tests, the E2E test, and the existing 776 baseline). Total green count should be 776 + the new tests added in Tasks 1, 2, 6 (a handful — the exact number depends on subtask granularity, but ≥ 10 new cases).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/agent-poker-platform-CLAUDE.md
git commit -m "docs: link werewolf platform from CLAUDE.md

Adds pnpm demo:werewolf to the Commands block, references the new
werewolf overview from the Project block, and notes the werewolf demo
output directory in Conventions. Mirrors the long-form
docs/agent-poker-platform-CLAUDE.md."
```

---

## Verification checklist (run before opening review)

- [ ] `pnpm build` succeeds across the workspace.
- [ ] `pnpm test` is green; new files contributed: `werewolf-http-agent-adapter.test.ts`, `werewolf-ws-agent-adapter.test.ts`, `werewolf-http-e2e.test.ts`.
- [ ] `pnpm demo:werewolf` runs to completion and writes 4 files under `examples/werewolf-local-simulation/output/matches/werewolf-demo-001/`.
- [ ] Re-running with the same seed (`pnpm demo:werewolf -- abc werewolf-seed-001` then `pnpm demo:werewolf -- xyz werewolf-seed-001`) produces identical `Steps:` and `Replay events:` counts.
- [ ] No new file imports `werewolf-orchestrator` from `agent-runtime/src/*.ts` (only from `agent-runtime/src/__tests__/*.ts`). Verify with: `grep -rn "@agent-poker/werewolf-orchestrator" packages/agent-runtime/src | grep -v __tests__` — expect zero output.
- [ ] No new file imports anything from `examples/` (examples are sinks, not sources). Verify with: `grep -rn "examples/werewolf-local-simulation" packages apps` — expect zero output.
- [ ] `git diff --name-only main..HEAD` lists only the files in the File Structure block above (plus the package.json/.gitignore/CLAUDE.md edits).

## Out-of-scope reminders

These belong in a future plan, not 4c:

- Werewolf `MatchAnalysisSummary` + `/analysis` route.
- Real `WerewolfWsAgentAdapter` (network protocol design + reconnect/heartbeat semantics).
- Web UI for werewolf matches.
- A `superpowers:requesting-code-review` pass — recommended after this plan lands but not required for the implementation tasks themselves.
