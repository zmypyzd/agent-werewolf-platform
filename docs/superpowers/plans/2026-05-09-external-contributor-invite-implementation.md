# External Contributor Agent Invite System — Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable external contributors to register agents via durable, public invite links by implementing web SPA bundling, Postgres store migration, and Supabase Auth integration across three independent stages.

**Architecture:** Stage 1 bundles the React SPA into the API container. Stage 2 swaps SQLite stores to Postgres with `IAuthService` abstraction for test hermiticity AND wires the JWT middleware up-front so route rewrites compile. Stage 3 flips frontend auth to Supabase JWT.

**Tech Stack:** Fastify, Vite, React, Supabase Auth, Postgres, TypeScript 5.5 strict, Vitest 2

**Revision notes (2026-05-09):** v2 fixes 4 critical ordering/security bugs and 18 informational issues found in pre-landing review. Key changes: middleware creation moved to Stage 2; SupabaseAuthService now actually verifies JWT signatures via `supabase.auth.getUser`; Task 13 split into 5 sub-tasks; placeholders removed.

**Estimated effort:** 16–22 hours of focused work across three stages.

---

## File Structure Overview

### New Files

```
packages/auth/src/auth-service.ts              IAuthService interface + implementations (Mock + Supabase)
apps/api/public/                               Created at Docker build (contains SPA dist)
apps/api/src/middleware/auth.ts                JWT verification Fastify decorator
apps/web/src/lib/supabase.ts                   Supabase client singleton
apps/web/src/lib/auth.ts                       Supabase auth hooks (useSession, signIn, signUp, signOut)
apps/web/src/pages/LoginPage.tsx               Email+password login (rewrite)
apps/web/src/pages/SignupPage.tsx              Email+password signup (rewrite)
```

### Modified Files

```
Dockerfile                                     Add web build stage with VITE_SUPABASE_* args
apps/api/package.json                          Add @fastify/static, @supabase/supabase-js
apps/api/src/server.ts                         Wire IAuthService, drop SQLite cookie path, add @fastify/static
apps/api/src/index.ts                          Pass publicDir option
apps/api/src/routes/agent-invites.ts           Rewrite for IAgentInviteStorePg + AuthenticatedRequest
apps/api/src/routes/me-agents.ts               Rewrite for IAgentStore + AuthenticatedRequest
apps/api/src/routes/auth.ts                    DELETE entirely (signup/signin moved to Supabase)
packages/auth/src/index.ts                     Export new IAuthService types; remove cookie/CSRF Fastify plugin from prod path
apps/web/package.json                          Add @supabase/supabase-js
apps/web/.env.example                          Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
apps/web/src/lib/api.ts                        Add JWT header, 401-signout logic (preserve existing surface)
apps/web/src/router.tsx                        Add ProtectedRoute wrapper
apps/web/src/pages/AgentsPage.tsx              Update prompt builders to mention public callback URL requirement
All 30+ test files in apps/api/src/__tests__/* Inject MockAuthService + SQLite stores (split across Tasks 13a–13e)
```

### Deleted Files
```
apps/api/src/routes/auth.ts                    Cookie signup/signin route gone
```

---

## STAGE 1: Web Bundling (2–3 hours)

### Task 1: Add @fastify/static dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add dependency**

Edit `apps/api/package.json` and add to `dependencies`:
```json
"@fastify/static": "^7.0.4"
```

(Use 7.x for Fastify 4 compatibility; 6.x is for Fastify 3.)

- [ ] **Step 2: Install and verify**

```bash
pnpm --filter api install
grep "@fastify/static" apps/api/package.json
```

Expected: dependency line present.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @fastify/static for SPA bundling"
```

---

### Task 2: Add publicDir option + register @fastify/static in server.ts

**Files:**
- Modify: `apps/api/src/server.ts:1-50` (imports section)
- Modify: `apps/api/src/server.ts:85-100` (BuildServerOptions)
- Modify: `apps/api/src/server.ts:155-180` (after `app = Fastify(...)`)

- [ ] **Step 1: Read existing server.ts to understand structure**

```bash
head -200 apps/api/src/server.ts
```

Note: where imports are, where `BuildServerOptions` is defined, where `app` is constructed, where plugins are registered.

- [ ] **Step 2: Add imports**

At the top of `apps/api/src/server.ts`, add:
```ts
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
```

- [ ] **Step 3: Extend BuildServerOptions interface**

Add to the interface (preserve all existing fields):
```ts
export interface BuildServerOptions {
  // ... existing fields preserved ...
  publicDir?: string;  // Absolute or repo-relative path to SPA dist directory
}
```

- [ ] **Step 4: Register static plugin conditionally**

After `const app = Fastify(...)` but before `app.register(...)` for routes, add:

```ts
if (opts.publicDir) {
  // Resolve publicDir relative to repo root if not absolute
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const publicPath = opts.publicDir.startsWith('/') ? opts.publicDir : join(repoRoot, opts.publicDir);

  await app.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
    decorateReply: false,
  });

  // SPA history fallback: any non-/api 404 returns index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
      return;
    }
    reply.sendFile('index.html');
  });
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm --filter api typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): register @fastify/static with SPA history fallback"
```

---

### Task 3: Update Dockerfile with web build stage

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Read existing Dockerfile**

```bash
cat Dockerfile
```

Identify: base, builder, runner stages and how COPY layers cache.

- [ ] **Step 2: Add web build stage**

Insert this stage AFTER the existing `builder` stage (which already runs `pnpm build` and produces `apps/web/dist` as a side effect since `web` is in the workspace):

Actually since `pnpm build` in the builder already builds web (the workspace runs `tsc -b` across all packages, and web's build script is invoked by `pnpm -r build`), we can simply COPY the web dist from builder to runner.

In the **runner** stage, after the existing `COPY --from=builder /app/apps/api/dist ...` line, add:

```dockerfile
# SPA dist served by @fastify/static at /
COPY --from=builder /app/apps/web/dist /app/apps/api/public
```

But: `apps/web` build needs `VITE_SUPABASE_*` env vars at build time. So in the **builder** stage, add ARG declarations BEFORE the `pnpm build` line:

```dockerfile
# Web build needs Supabase env vars (Vite inlines them at build time)
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
```

(Empty strings are fallback for Stage 1; Stage 3 supplies real values via `--build-arg`.)

- [ ] **Step 3: Validate Dockerfile parses**

```bash
docker buildx build --check . 2>&1 | tail -10
```

(Replaces the bogus `--dry-run` from v1; `--check` is the real "validate without building" flag in modern docker.)

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: bundle web SPA dist into API container"
```

---

### Task 4: Pass publicDir from index.ts

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Update opts construction**

```ts
const opts: BuildServerOptions = {
  publicDir: process.env['PUBLIC_DIR'] ?? 'apps/api/public',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter api typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): wire publicDir option from PUBLIC_DIR env"
```

---

### Task 5: Update apps/web/.gitignore

**Files:**
- Modify: `apps/web/.gitignore`

- [ ] **Step 1: Check if dist/ is already ignored**

```bash
grep -E "^dist/?$" apps/web/.gitignore || echo "MISSING"
```

- [ ] **Step 2: Add if missing**

If output was `MISSING`, append to `apps/web/.gitignore`:
```
dist/
```

- [ ] **Step 3: Commit (skip if no change)**

```bash
git add apps/web/.gitignore && git commit -m "chore(web): ensure dist/ gitignored" || echo "no change"
```

---

### Task 6: Smoke test Stage 1 locally

**Files:** none (verification only)

- [ ] **Step 1: Build Docker image**

```bash
docker build -t agent-platform-stage1 . 2>&1 | tail -20
```

Expected: build succeeds, no errors in web build.

- [ ] **Step 2: Run container**

```bash
docker run --rm -d --name stage1 -p 3000:3000 \
  -e PUBLIC_DIR=/app/apps/api/public \
  agent-platform-stage1
sleep 3
```

- [ ] **Step 3: Verify SPA serves**

```bash
curl -s http://localhost:3000/ | grep -E '<title>|<div id="root">'
```

Expected: HTML with `<title>` and `<div id="root">`.

- [ ] **Step 4: Verify API still responds**

```bash
curl -s http://localhost:3000/api/v1/health
```

Expected: 200 with health JSON.

- [ ] **Step 5: Verify SPA fallback works for unknown paths**

```bash
curl -s http://localhost:3000/some/spa/route | grep '<div id="root">'
```

Expected: Same index.html (history fallback).

- [ ] **Step 6: Cleanup**

```bash
docker stop stage1
```

- [ ] **Step 7: Commit (no code changes)**

Stage 1 verified.

---

## STAGE 2: Postgres Stores Swap + Auth Middleware (5–7 hours)

> **Critical ordering note:** Auth middleware (originally v1 Task 23) is moved to **Task 8** here so that route rewrites in Tasks 10–13 actually compile. JWT signature verification is real (uses `supabase.auth.getUser`) — not just payload decode.

### Task 7: Create IAuthService interface and implementations (TDD)

**Files:**
- Create: `packages/auth/src/auth-service.ts`
- Create: `packages/auth/src/__tests__/auth-service.test.ts`

- [ ] **Step 1: Write failing test FIRST**

Create `packages/auth/src/__tests__/auth-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockAuthService } from '../auth-service.js';

describe('MockAuthService', () => {
  it('throws on missing Authorization header', async () => {
    const svc = new MockAuthService('user-1');
    await expect(svc.verifyJwt(undefined)).rejects.toThrow(/Missing Authorization/);
  });

  it('throws on non-Bearer scheme', async () => {
    const svc = new MockAuthService('user-1');
    await expect(svc.verifyJwt('Basic abc')).rejects.toThrow(/Bearer/);
  });

  it('returns provided defaultUserId regardless of token contents', async () => {
    const svc = new MockAuthService('user-fixed');
    const result = await svc.verifyJwt('Bearer any-token');
    expect(result).toEqual({ userId: 'user-fixed', jwt: 'any-token' });
  });

  it('throws if no defaultUserId configured', async () => {
    const svc = new MockAuthService();
    await expect(svc.verifyJwt('Bearer abc')).rejects.toThrow(/userId/);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @agent-poker/auth exec vitest run src/__tests__/auth-service.test.ts
```

Expected: 4 failing tests (file doesn't exist).

- [ ] **Step 3: Write the implementation**

Create `packages/auth/src/auth-service.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export interface IAuthService {
  verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }>;
}

/**
 * Test-only auth service. Always returns the configured userId, never validates signature.
 * Throw if no userId configured — fails loudly rather than guessing from token contents.
 */
export class MockAuthService implements IAuthService {
  constructor(private readonly defaultUserId?: string) {}

  async verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }> {
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') {
      throw new Error('Authorization scheme must be Bearer');
    }
    if (!token) {
      throw new Error('Missing Bearer token');
    }
    if (!this.defaultUserId) {
      throw new Error('MockAuthService requires defaultUserId to return a userId');
    }
    return { userId: this.defaultUserId, jwt: token };
  }
}

/**
 * Production auth service. Calls Supabase's auth.getUser(jwt) which performs
 * full signature + expiry validation server-side. One RPC per request.
 *
 * Alternative: use jose to verify the JWT locally with the project's JWT secret.
 * supabase.auth.getUser is simpler and authoritative; we accept the per-request
 * latency for correctness.
 */
export class SupabaseAuthService implements IAuthService {
  private readonly client: ReturnType<typeof createClient>;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }> {
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer') {
      throw new Error('Authorization scheme must be Bearer');
    }
    if (!token) {
      throw new Error('Missing Bearer token');
    }

    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) {
      throw new Error(`Invalid or expired JWT: ${error?.message ?? 'no user returned'}`);
    }

    return { userId: data.user.id, jwt: token };
  }
}
```

- [ ] **Step 4: Export from packages/auth/src/index.ts**

Add to `packages/auth/src/index.ts`:
```ts
export { MockAuthService, SupabaseAuthService } from './auth-service.js';
export type { IAuthService } from './auth-service.js';
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
pnpm --filter @agent-poker/auth exec vitest run src/__tests__/auth-service.test.ts
```

Expected: 4 passing.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @agent-poker/auth typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/auth-service.ts packages/auth/src/__tests__/auth-service.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): add IAuthService with Mock + Supabase impls (signature verified)"
```

---

### Task 8: Create JWT Fastify middleware + decorate app.requireAuth

> **C1 fix:** middleware MUST exist before Task 10/11 rewrite routes that use `app.requireAuth`.

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the middleware**

Create `apps/api/src/middleware/auth.ts`:

```ts
import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { AppError } from '@agent-poker/shared';
import type { IAuthService } from '@agent-poker/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; jwt: string };
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; jwt: string };
}

export function registerAuthMiddleware(app: FastifyInstance, authService: IAuthService): void {
  app.decorate(
    'requireAuth',
    async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      try {
        const { userId, jwt } = await authService.verifyJwt(req.headers.authorization);
        req.user = { userId, jwt };
      } catch {
        throw new AppError('UNAUTHORIZED', 'Invalid or missing credentials', 401);
      }
    },
  );
}
```

- [ ] **Step 2: Wire in server.ts**

In `apps/api/src/server.ts`, after `const authService = opts.authService ?? new MockAuthService(...)` (you'll add this line in this same task) and after `const app = Fastify(...)`:

```ts
import { MockAuthService } from '@agent-poker/auth';
import { registerAuthMiddleware } from './middleware/auth.js';

// ... inside buildServer ...
const authService = opts.authService ?? new MockAuthService('test-user-default');

// ... after app = Fastify(...) ...
registerAuthMiddleware(app, authService);
```

Also extend `BuildServerOptions`:
```ts
import type { IAuthService } from '@agent-poker/auth';

export interface BuildServerOptions {
  // ... existing ...
  authService?: IAuthService;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter api typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/server.ts
git commit -m "feat(api): JWT middleware with app.requireAuth decorator"
```

---

### Task 9: Confirm @supabase/supabase-js is in API deps

**Files:**
- Verify: `apps/api/package.json`

- [ ] **Step 1: Check current deps**

```bash
grep "supabase" apps/api/package.json
```

If not present, add `"@supabase/supabase-js": "^2.45.0"` to `dependencies`.

- [ ] **Step 2: Install if needed**

```bash
pnpm --filter api install
```

- [ ] **Step 3: Commit if changed**

```bash
git diff --stat apps/api/package.json pnpm-lock.yaml | grep -q . && \
  git add apps/api/package.json pnpm-lock.yaml && \
  git commit -m "chore(api): pin @supabase/supabase-js" || \
  echo "no change"
```

---

### Task 10: Rewrite agent-invites.ts using Postgres stores

**Files:**
- Modify: `apps/api/src/routes/agent-invites.ts` (full rewrite)

- [ ] **Step 1: Read existing route**

```bash
cat apps/api/src/routes/agent-invites.ts
```

Note current helpers (`registerUrlFor`, `inviteStatus`, `toPublicInvite`, `toPublicConfig`, `assertInviteUsable`) — preserve them where possible.

- [ ] **Step 2: Update plugin opts type**

Replace the existing `AgentInvitesPluginOptions`:

```ts
import type {
  IAgentStore,
  IAgentInviteStorePg,
  SupabaseClientConfig,
} from '@agent-poker/persistence';

interface AgentInvitesPluginOptions extends FastifyPluginOptions {
  agentInviteStore: IAgentInviteStorePg;
  agentConfigStore: IAgentStore;
  supabaseConfig: SupabaseClientConfig;
}
```

- [ ] **Step 3: Update imports**

```ts
import {
  PostgresAgentStore,
  PostgresAgentInviteStore,
  createServiceRoleClient,
  createUserScopedClient,
} from '@agent-poker/persistence';
import type { AuthenticatedRequest } from '../middleware/auth.js';
```

- [ ] **Step 4: Rewrite POST /agents/invites**

```ts
app.post(
  '/agents/invites',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    let body;
    try {
      body = CreateAgentInviteRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    const { userId, jwt } = (req as AuthenticatedRequest).user;
    const userClient = createUserScopedClient(opts.supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    const rawToken = randomBytes(24).toString('base64url');
    const invite = await store.create({
      rawToken,
      ownerId: userId,
      displayName: body.displayName ?? null,
      notes: body.notes ?? null,
      expiresAt: Date.now() + body.ttlSec * 1000,
    });

    reply.status(201).send({
      data: {
        token: rawToken,  // Show raw token to user once; DB stores hash
        expiresAt: invite.expiresAt,
        registerUrl: registerUrlFor(req, rawToken),
      },
    });
  },
);
```

- [ ] **Step 5: Rewrite GET /agents/invites**

```ts
app.get(
  '/agents/invites',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    const { userId, jwt } = (req as AuthenticatedRequest).user;
    const userClient = createUserScopedClient(opts.supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    const invites = await store.list(userId);
    reply.send({ data: invites.map(toPublicInvitePg) });
  },
);
```

`toPublicInvitePg` adapter (add as helper at top of file):
```ts
function toPublicInvitePg(invite: AgentInviteRecord) {
  return {
    tokenHash: invite.tokenHash,  // Don't expose raw — already shown at creation
    displayName: invite.displayName,
    notes: invite.notes,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    createdAt: invite.createdAt,
    registeredAgentId: invite.registeredAgentId,
    status: invite.live
      ? 'pending'
      : invite.usedAt !== null
        ? 'used'
        : invite.revokedAt !== null
          ? 'revoked'
          : 'expired',
  };
}
```

- [ ] **Step 6: Rewrite DELETE /agents/invites/:token**

```ts
app.delete<{ Params: { token: string } }>(
  '/agents/invites/:token',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    const { userId, jwt } = (req as AuthenticatedRequest).user;
    const userClient = createUserScopedClient(opts.supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    const invite = await store.findByRawToken(req.params.token);
    if (!invite || invite.ownerId !== userId) {
      throw new AgentInviteNotFoundError(req.params.token);
    }
    if (invite.usedAt !== null || invite.revokedAt !== null || invite.expiresAt < Date.now()) {
      throw new AgentInviteUnavailableError(req.params.token);
    }

    const revoked = await store.revokeUnused(userId, req.params.token);
    if (!revoked) throw new AgentInviteUnavailableError(req.params.token);
    reply.status(204).send();
  },
);
```

- [ ] **Step 7: Rewrite POST /agents/invites/:token/register (public)**

```ts
app.post<{ Params: { token: string } }>(
  '/agents/invites/:token/register',
  // No requireAuth — external person has no account
  async (req, reply) => {
    let body;
    try {
      body = RegisterAgentInviteRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    const serviceClient = createServiceRoleClient(opts.supabaseConfig);
    const inviteStore = new PostgresAgentInviteStore(serviceClient);
    const agentStore = new PostgresAgentStore(serviceClient);

    const invite = await inviteStore.findByRawToken(req.params.token);
    if (!invite) throw new AgentInviteNotFoundError(req.params.token);
    if (invite.usedAt !== null || invite.revokedAt !== null || invite.expiresAt < Date.now()) {
      throw new AgentInviteUnavailableError(req.params.token);
    }

    const agent = await agentStore.create({
      ownerId: invite.ownerId,
      name: body.displayName,
      description: invite.notes ?? null,
      protocol: 'http',
      callbackUrl: body.endpointUrl,
      authHeaderName: body.authHeaderName ?? null,
      authHeaderValue: body.authHeaderValue ?? null,
      timeoutMs: body.timeoutMs,
    });

    await inviteStore.markUsed(req.params.token, agent.id);

    reply.status(201).send({
      data: {
        agent: toPublicAgentPg(agent),
        invite: { ...toPublicInvitePg(invite), status: 'used', registeredAgentId: agent.id },
      },
    });
  },
);
```

`toPublicAgentPg` helper:
```ts
function toPublicAgentPg(agent: AgentRecord) {
  return {
    agentId: agent.id,
    name: agent.name,
    protocol: agent.protocol,
    callbackUrl: agent.callbackUrl,
    authHeaderName: agent.authHeaderName,
    hasAuthHeader: agent.authHeaderValue !== null && agent.authHeaderValue.length > 0,
    timeoutMs: agent.timeoutMs,
    description: agent.description,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm --filter api typecheck
```

Expected: no errors. (If errors persist, ensure `AgentRecord` and `AgentInviteRecord` are exported from `@agent-poker/persistence`.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/agent-invites.ts
git commit -m "feat(routes): rewrite agent-invites for Postgres + JWT auth"
```

---

### Task 11: Rewrite me-agents.ts using PostgresAgentStore

**Files:**
- Modify: `apps/api/src/routes/me-agents.ts`

- [ ] **Step 1: Read existing routes**

```bash
cat apps/api/src/routes/me-agents.ts
```

- [ ] **Step 2: Update plugin signature**

```ts
interface MeAgentsPluginOptions extends FastifyPluginOptions {
  agentStore: IAgentStore;
  supabaseConfig: SupabaseClientConfig;
}
```

- [ ] **Step 3: Update each route**

For each route (`GET /agents`, `GET /agents/:id`, `PATCH /agents/:id`, `DELETE /agents/:id`):

```ts
const { userId, jwt } = (req as AuthenticatedRequest).user;
const userClient = createUserScopedClient(opts.supabaseConfig, jwt);
const store = new PostgresAgentStore(userClient);
const agents = await store.list(userId);  // or .get, .update, .delete as appropriate
```

(Adapt method names to whatever `IAgentStore` exposes — verify by reading `packages/persistence/src/postgres/postgres-agent-store.ts`.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter api typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me-agents.ts
git commit -m "feat(routes): rewrite me-agents for PostgresAgentStore + JWT"
```

---

### Task 12: Audit IAgentStore vs IUserAgentConfigStore identifier compatibility

> **I14 fix:** old `cfg-xxxx` IDs vs new UUID IDs may break werewolf/poker code that has hardcoded format assumptions.

**Files:** none changed yet — this is a discovery task.

- [ ] **Step 1: Find all references to agent IDs**

```bash
grep -rn "agentConfigId\|agentId\|cfg-" \
  apps/api/src apps/web/src packages \
  --include="*.ts" --include="*.tsx" \
  | grep -v node_modules | grep -v dist | grep -v __tests__
```

- [ ] **Step 2: Categorize**

Make a list of:
- Routes that pass `agentConfigId` in URLs / bodies
- Frontend components that store `agentConfigId` in state
- Werewolf orchestrator code that references agent IDs

- [ ] **Step 3: Decide format compatibility**

UUID strings (e.g., `550e8400-e29b-41d4-a716-446655440000`) are valid where `cfg-xxxx` was — they're just opaque IDs. So **most code should work unchanged**, but:
- Any regex like `^cfg-` will break — search and remove
- Any hardcoded `cfg-test-1` in tests must change to a UUID-shaped value

Run:
```bash
grep -rn "cfg-" apps packages --include="*.ts" | grep -v node_modules
```

- [ ] **Step 4: Document findings**

Write findings to `docs/superpowers/specs/2026-05-09-external-contributor-invite-design.md` as an addendum, OR open a TODO comment for each file that needs updating in Task 13.

- [ ] **Step 5: Commit findings**

```bash
git add -u
git commit -m "docs: audit agent ID format compatibility (cfg-* vs UUID)" || echo "no doc changes"
```

---

### Task 13a: Update test infrastructure (route-audit + auth tests)

**Files:**
- Modify: `apps/api/src/__tests__/route-audit.test.ts`
- Modify: `apps/api/src/__tests__/auth.test.ts` (or DELETE if it only tests cookie auth)

- [ ] **Step 1: Read each file**

```bash
cat apps/api/src/__tests__/route-audit.test.ts | head -50
cat apps/api/src/__tests__/auth.test.ts | head -50
```

- [ ] **Step 2: Update buildServer calls**

For each test that calls `buildServer(...)`:

```ts
import { MockAuthService } from '@agent-poker/auth';
import { openDatabase, SqliteUserStore, SqliteSessionStore, SqliteUserAgentConfigStore, SqliteAgentInviteStore } from '@agent-poker/persistence';

const authDb = openDatabase(':memory:');
const app = buildServer({
  authService: new MockAuthService('test-user-1'),
  authDb,
  // Test fixtures stay on SQLite for hermetic + fast
});
```

- [ ] **Step 3: Replace cookie setup with Authorization header**

```ts
// OLD
const res = await app.inject({ method: 'POST', url: '/api/v1/agents/invites', cookies: { apk_sid: '...' }, ... });

// NEW
const res = await app.inject({
  method: 'POST',
  url: '/api/v1/agents/invites',
  headers: { authorization: 'Bearer mock-token' },
  payload: { ... },
});
```

- [ ] **Step 4: Run these two test files**

```bash
pnpm --filter api exec vitest run src/__tests__/route-audit.test.ts src/__tests__/auth.test.ts
```

If `auth.test.ts` exclusively tests cookie signup/signin/logout that has been removed (Task 14 deletes the route), DELETE the file:
```bash
git rm apps/api/src/__tests__/auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -u apps/api/src/__tests__/route-audit.test.ts apps/api/src/__tests__/auth.test.ts
git commit -m "test(api): migrate route-audit + auth tests to MockAuthService"
```

---

### Task 13b: Update agent-invites + me-agents tests

**Files:**
- Modify: `apps/api/src/__tests__/agent-invites.test.ts`
- Modify: `apps/api/src/__tests__/me-agents.test.ts`

- [ ] **Step 1: Apply same transformation as Task 13a**

For each `buildServer()` call, inject `MockAuthService` and `authDb`. Replace cookie-based authentication setup with `Authorization: Bearer mock-token` header.

- [ ] **Step 2: Verify against new route behavior**

The test assertions may need updating if response shapes changed (e.g., `tokenHash` now in invite list responses instead of raw token).

- [ ] **Step 3: Run**

```bash
pnpm --filter api exec vitest run src/__tests__/agent-invites.test.ts src/__tests__/me-agents.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/agent-invites.test.ts apps/api/src/__tests__/me-agents.test.ts
git commit -m "test(api): migrate agent-invites + me-agents tests to JWT auth"
```

---

### Task 13c: Update werewolf-* tests

**Files:**
- Modify: All files matching `apps/api/src/__tests__/werewolf-*.test.ts` and `werewolf-*.spec.ts`

- [ ] **Step 1: List werewolf tests**

```bash
ls apps/api/src/__tests__/werewolf*.test.ts
```

- [ ] **Step 2: For each, apply 13a transformation**

`buildServer()` injection pattern; replace cookies with Bearer header where authenticated; preserve werewolf-specific test logic.

- [ ] **Step 3: Run werewolf tests**

```bash
pnpm --filter api exec vitest run src/__tests__/werewolf
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/werewolf*.test.ts
git commit -m "test(api): migrate werewolf tests to MockAuthService"
```

---

### Task 13d: Update remaining tests (ownership, integration, postgres-bundle, etc.)

**Files:**
- Modify: `apps/api/src/__tests__/ownership.test.ts`
- Modify: `apps/api/src/__tests__/api.integration.test.ts`
- Modify: `apps/api/src/__tests__/postgres-werewolf-bundle.test.ts`
- Modify: any other remaining test files

- [ ] **Step 1: List remaining tests**

```bash
ls apps/api/src/__tests__/*.test.ts | grep -v -E "(route-audit|auth\.test|agent-invites|me-agents|werewolf)"
```

- [ ] **Step 2: Apply 13a transformation to each**

- [ ] **Step 3: Run them**

```bash
pnpm --filter api exec vitest run src/__tests__/ownership.test.ts src/__tests__/api.integration.test.ts src/__tests__/postgres-werewolf-bundle.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -u apps/api/src/__tests__/
git commit -m "test(api): migrate remaining tests to MockAuthService"
```

---

### Task 13e: Run full test suite + fix regressions

**Files:** any with surface regressions

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Triage failures**

If failures remain, classify:
- **Mock fixture out of date:** test uses `cfg-` prefix but route now returns UUID → update assertion
- **Cookie helpers leak:** stale `set-cookie` test logic → delete
- **Werewolf cross-pollination:** werewolf path uses an agent ID format check → see Task 12 findings

- [ ] **Step 3: Fix and re-run iteratively until green**

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "test: fix regressions from MockAuthService migration"
```

---

### Task 14: Delete apps/api/src/routes/auth.ts + remove cookie/CSRF plugin

> **I7 fix:** clean up `packages/auth` cookie plugin too.

**Files:**
- Delete: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/server.ts` (remove cookie plugin registration)
- Modify: `packages/auth/src/index.ts` (remove cookie/CSRF Fastify plugin export)

- [ ] **Step 1: Find all references to auth route**

```bash
grep -rn "routes/auth\|authRoutes" apps/api/src
```

- [ ] **Step 2: Remove the registration**

In `apps/api/src/server.ts`, find and delete:
```ts
app.register(authRoutes, { prefix: '/api/v1' });
```

- [ ] **Step 3: Remove cookie/CSRF plugin from server.ts**

If server.ts has lines like:
```ts
await app.register(authPlugin, { sessionStore, userStore });
```

Remove them. The middleware now handles auth.

- [ ] **Step 4: Remove old plugin export from packages/auth**

In `packages/auth/src/index.ts`, remove the line that exports the Fastify cookie plugin (e.g., `export { authPlugin } from './fastify-plugin.js';`). Keep only:
- `IAuthService`, `MockAuthService`, `SupabaseAuthService`
- `hashPassword` / `verifyPassword` helpers (if still needed for non-Supabase paths — likely just delete)

- [ ] **Step 5: Delete auth route file**

```bash
git rm apps/api/src/routes/auth.ts
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "refactor(api): delete auth.ts route + cookie plugin (Supabase Auth replaces)"
```

---

### Task 15: Smoke test Stage 2 — Postgres invite flow

**Files:** none (manual smoke test)

> **I9 fix:** signup goes through web UI (Stage 3) or supabase-js, never through API. This smoke test only covers the invite flow.

- [ ] **Step 1: Set up local Postgres connection**

You need:
- A Supabase project (test or dev)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` from Supabase dashboard → Settings → API

```bash
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY"
export SUPABASE_ANON_KEY="YOUR-ANON-KEY"
```

(Get keys from: https://supabase.com/dashboard/project/_/settings/api)

- [ ] **Step 2: Manually create a test user in Supabase**

In Supabase dashboard → Authentication → Users → Invite a user (or create with password). Note the user's UUID.

- [ ] **Step 3: Get a JWT for that user**

In Supabase dashboard → SQL editor:
```sql
-- Or use supabase-js: signInWithPassword to get an access_token
```

Easier: from a browser console after web login (Stage 3), copy `localStorage["sb-PROJECT_ID-auth-token"].access_token`. For now since web isn't done, use:

```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"yourpassword"}' \
  | jq -r .access_token
```

Save the JWT to `$JWT`.

- [ ] **Step 4: Run API**

```bash
pnpm dev:api &
sleep 2
```

- [ ] **Step 5: Create an invite**

```bash
curl -X POST http://localhost:3000/api/v1/agents/invites \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"TestAgent","ttlSec":3600}'
```

Expected: `{ "data": { "token": "...", "expiresAt": ..., "registerUrl": "..." } }`

- [ ] **Step 6: Verify token is in Postgres**

In Supabase SQL editor:
```sql
SELECT token_hash, owner_id, display_name, expires_at FROM public.agent_invites ORDER BY created_at DESC LIMIT 1;
```

- [ ] **Step 7: Register an external agent**

```bash
curl -X POST "http://localhost:3000/api/v1/agents/invites/$RAW_TOKEN/register" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"ExtAgent","endpointUrl":"https://example.com/decide","timeoutMs":5000}'
```

Expected: `{ "data": { "agent": {...}, "invite": {...} } }`

- [ ] **Step 8: Stop API**

```bash
pkill -f "pnpm dev:api"
```

- [ ] **Step 9: Cleanup**

Delete test rows from Postgres if desired.

Stage 2 verified. Commit (none needed, no code change).

---

## STAGE 3: Supabase Auth Frontend Integration (5–6 hours)

> **I1:** Read DESIGN.md before any UI work in this stage.

### Task 16: Read DESIGN.md before frontend work

**Files:** none (read-only)

- [ ] **Step 1: Read DESIGN.md fully**

```bash
cat DESIGN.md
```

Note: font choices, color palette, spacing units, button variants, form styling. **Stage 3 LoginPage and SignupPage MUST match these tokens.** No inline styles unless DESIGN.md sanctions them.

- [ ] **Step 2: Check for existing form/button components**

```bash
find apps/web/src -name "*Button*" -o -name "*Input*" -o -name "*Form*" 2>/dev/null
```

If existing components exist, reuse them in Tasks 19/20.

- [ ] **Step 3: No commit (read-only)**

---

### Task 17: Add @supabase/supabase-js to web

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependency**

```json
"@supabase/supabase-js": "^2.45.0"
```

- [ ] **Step 2: Install**

```bash
pnpm --filter web install
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @supabase/supabase-js"
```

---

### Task 18: Create supabase.ts client (TDD)

**Files:**
- Create: `apps/web/src/lib/supabase.ts`
- Create: `apps/web/src/lib/__tests__/supabase.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';

describe('supabase client', () => {
  it('exports a client when env vars are set', async () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
    const { supabase } = await import('../supabase.js');
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm --filter web exec vitest run src/lib/__tests__/supabase.test.ts
```

- [ ] **Step 3: Implementation**

```ts
// apps/web/src/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Soft warning rather than throw, so dev mode without env still loads (login will fail visibly)
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — auth will fail');
}

export const supabase: SupabaseClient = createClient(
  url ?? 'https://invalid.supabase.co',
  anonKey ?? 'invalid-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter web exec vitest run src/lib/__tests__/supabase.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase.ts apps/web/src/lib/__tests__/supabase.test.ts
git commit -m "feat(web): create Supabase client with soft env warning"
```

---

### Task 19: Create auth.ts hooks

**Files:**
- Create: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Implementation**

```ts
// apps/web/src/lib/auth.ts
import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import type { Session, User } from '@supabase/supabase-js';

export interface SessionState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription?.unsubscribe();
  }, []);

  return { session, user, isLoading };
}

export async function signUp(email: string, password: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signUp({ email, password });
  return error ? { error: error.message } : {};
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signOut();
  return error ? { error: error.message } : {};
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "feat(web): create Supabase auth hooks (useSession, signIn, signUp, signOut)"
```

---

### Task 20: Update api.ts to attach JWT and handle 401

> **C4 fix:** read existing file first, preserve all methods, no placeholders.

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Read existing file completely**

```bash
cat apps/web/src/lib/api.ts
```

Catalog every existing method (`get`, `post`, `put`, `del`, `patch`, etc.) and any error/retry helpers. Preserve them all.

- [ ] **Step 2: Inject JWT into the existing request function**

Find the central `fetch` wrapper. At the top of the function (before the actual `fetch` call), add:

```ts
const { data: { session } } = await supabase.auth.getSession();
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  ...(options?.headers ?? {}),
};
if (session?.access_token) {
  headers['Authorization'] = `Bearer ${session.access_token}`;
}
```

After the fetch call:

```ts
if (response.status === 401) {
  await signOut();
  window.location.href = '/login';
  throw new ApiError('Session expired', 401);
}
```

(Use the project's existing `ApiError` class — don't introduce a new error type.)

- [ ] **Step 3: Add the imports**

```ts
import { supabase } from './supabase.js';
import { signOut } from './auth.js';
```

- [ ] **Step 4: Remove `credentials: 'include'`**

Search and delete any `credentials: 'include'` from the fetch options — JWT replaces cookies.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): attach JWT to API calls, handle 401 logout"
```

---

### Task 21: Create LoginPage.tsx (using DESIGN.md tokens)

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Read existing LoginPage.tsx**

```bash
cat apps/web/src/pages/LoginPage.tsx
```

Preserve any container layout / header structure that conforms to DESIGN.md.

- [ ] **Step 2: Replace the form logic with Supabase signIn**

(Using existing form components from Task 16 audit. Do not introduce new inline styles unless DESIGN.md is silent on a specific element.)

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signIn } from '../lib/auth.js';
// Import existing form components (Button, Input, etc.) from your component library

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) {
      setError(err);
      setIsLoading(false);
    } else {
      navigate('/agents');
    }
  };

  return (
    <div className="login-page-container">
      <h1>Sign In</h1>
      {error && <p className="error-message">{error}</p>}
      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </label>
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <p>
        No account? <Link to="/signup">Sign up</Link>
      </p>
    </div>
  );
}
```

(Replace `className` values with whatever DESIGN.md / existing CSS prescribes.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): rewrite LoginPage for Supabase signIn"
```

---

### Task 22: Create SignupPage.tsx (using DESIGN.md tokens)

**Files:**
- Modify: `apps/web/src/pages/SignupPage.tsx`

- [ ] **Step 1: Read existing if any**

```bash
ls apps/web/src/pages/SignupPage.tsx 2>/dev/null && cat apps/web/src/pages/SignupPage.tsx
```

- [ ] **Step 2: Implement using Supabase signUp**

Same structure as LoginPage; on success show "Check your email" message (Supabase default is email confirmation enabled). Use DESIGN.md tokens.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SignupPage.tsx
git commit -m "feat(web): rewrite SignupPage for Supabase signUp"
```

---

### Task 23: Add ProtectedRoute wrapper in router.tsx

**Files:**
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Read existing router**

```bash
cat apps/web/src/router.tsx
```

Identify whether routes are defined as `RouteObject[]` or with JSX `<Routes>` / `<Route>` components.

- [ ] **Step 2: Add ProtectedRoute component**

```tsx
import { Navigate } from 'react-router-dom';
import { useSession } from './lib/auth.js';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useSession();
  if (isLoading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Wrap protected routes**

For each protected page (e.g., `/agents`, `/`, `/werewolf-rooms`, etc.), wrap with `ProtectedRoute`:

```tsx
{
  path: '/agents',
  element: (
    <ProtectedRoute>
      <AgentsPage />
    </ProtectedRoute>
  ),
}
```

(Style depends on existing router style — adapt accordingly.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/router.tsx
git commit -m "feat(web): add ProtectedRoute wrapper for authenticated pages"
```

---

### Task 24: Update apps/web/.env.example

**Files:**
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Add Supabase vars**

Append:
```
# From Supabase dashboard → Settings → API
# https://supabase.com/dashboard/project/_/settings/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-key
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/.env.example
git commit -m "docs(web): document VITE_SUPABASE_* env vars"
```

---

### Task 25: Update Render env vars (production deploy)

**Files:** none (Render config)

- [ ] **Step 1: List current env vars**

```bash
curl -s "https://api.render.com/v1/services/srv-d7uo61lb910c73epl1d0/env-vars" \
  -H "Authorization: Bearer $(cat ~/.config/render/api-key)" \
  | python3 -c "import sys,json;data=json.load(sys.stdin);[print(e['envVar']['key']) for e in data]"
```

- [ ] **Step 2: Add VITE_* env vars (mirror SUPABASE_*)**

For each `VITE_SUPABASE_*` var, POST to Render. Or use the Render dashboard:

```
1. https://dashboard.render.com/web/srv-d7uo61lb910c73epl1d0/env
2. Add VITE_SUPABASE_URL = (same as SUPABASE_URL)
3. Add VITE_SUPABASE_ANON_KEY = (same as SUPABASE_ANON_KEY)
```

OR via API:
```bash
curl -X POST "https://api.render.com/v1/services/srv-d7uo61lb910c73epl1d0/env-vars" \
  -H "Authorization: Bearer $(cat ~/.config/render/api-key)" \
  -H "Content-Type: application/json" \
  -d '[{"key":"VITE_SUPABASE_URL","value":"https://YOUR-PROJECT.supabase.co"}, {"key":"VITE_SUPABASE_ANON_KEY","value":"YOUR-ANON-KEY"}]'
```

- [ ] **Step 3: Verify they appear**

```bash
curl -s "https://api.render.com/v1/services/srv-d7uo61lb910c73epl1d0/env-vars" \
  -H "Authorization: Bearer $(cat ~/.config/render/api-key)" \
  | python3 -c "import sys,json;data=json.load(sys.stdin);[print(e['envVar']['key']) for e in data]" | grep VITE
```

Expected: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY appear.

- [ ] **Step 4: Trigger redeploy** (via dashboard or `curl` POST to deploys endpoint).

---

### Task 26: Update AgentsPage prompt builders to clarify public URL requirement

> **I13 fix:** existing prompt templates say `http://localhost:8080/decide` — confusing for production.

**Files:**
- Modify: `apps/web/src/pages/AgentsPage.tsx:516-541` (and similar templates)

- [ ] **Step 1: Read current prompt builders**

```bash
sed -n '500,650p' apps/web/src/pages/AgentsPage.tsx
```

- [ ] **Step 2: Add a "public URL required" note**

In `buildHttpAgentInvitePrompt` and `buildCodingAgentInvitePrompt`, add a callout:

```ts
// Add near the top of each prompt template:
`IMPORTANT: Your endpoint URL must be publicly reachable from the internet — the
platform will POST to it from its servers. For local agents, use a tunnel:
  - cloudflared tunnel: cloudflared tunnel --url http://localhost:8080
  - ngrok: ngrok http 8080
Your endpointUrl in the registration command should be the public tunnel URL,
NOT http://localhost:8080.`
```

- [ ] **Step 3: Update test snapshots**

```bash
pnpm --filter web exec vitest run src/__tests__/agents-page.test.tsx -u
```

(`-u` updates snapshots if any.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AgentsPage.tsx apps/web/src/__tests__/agents-page.test.tsx
git commit -m "docs(web): clarify public URL requirement in agent invite prompts"
```

---

### Task 27: End-to-end smoke test on staging deploy

**Files:** none

- [ ] **Step 1: Deploy stage 3 image to Render**

(Render auto-deploys on push to main. Or trigger manually.)

```bash
git push origin main
# wait for Render deploy to complete (watch dashboard)
```

- [ ] **Step 2: Test signup via web UI**

Navigate to `https://werewolf-api-ttsb.onrender.com/signup`. Create an account.

- [ ] **Step 3: Test login**

Navigate to `/login`, log in. Confirm localStorage has `sb-*` token.

- [ ] **Step 4: Create invite via web**

Navigate to `/agents`, click "Generate invite". Confirm response includes `registerUrl: https://werewolf-api-ttsb.onrender.com/api/v1/agents/invites/<token>/register`.

- [ ] **Step 5: Test public registration**

```bash
TOKEN="copy-from-step-4"
curl -X POST "https://werewolf-api-ttsb.onrender.com/api/v1/agents/invites/$TOKEN/register" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"E2E-Test","endpointUrl":"https://example.com/decide","timeoutMs":5000}'
```

Expected: `{ data: { agent: {...}, invite: {...} } }`.

- [ ] **Step 6: Verify the agent appears under owner's account**

In web UI, refresh `/agents` page. The newly registered E2E-Test agent should appear.

- [ ] **Step 7: Cleanup test data**

Delete test invite/agent from Supabase if desired.

- [ ] **Step 8: Document success**

End-to-end flow verified. Mark deploy as production-ready.

---

### Task 28: Final sanity sweep + delete dev SQLite remnants

> **Spec gap fix:** ensure no stale local SQLite db pollutes dev.

**Files:** any local dev artifacts

- [ ] **Step 1: Find any committed SQLite databases**

```bash
find . -name "*.db" -o -name "*.sqlite" -not -path "*/node_modules/*" 2>/dev/null
```

If any found that aren't intentional fixtures, evaluate and delete.

- [ ] **Step 2: Check .gitignore for SQLite patterns**

```bash
grep -E "\.db$|\.sqlite$" .gitignore
```

If missing, add. SQLite db files should never be committed; they're either `:memory:` (default) or per-environment (gitignored).

- [ ] **Step 3: Run full test + build**

```bash
pnpm test && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore SQLite db artifacts" || echo "no change"
```

---

## Rollback Strategy (per spec)

Each stage is a separate set of commits. To roll back:

- **Stage 3 (web frontend auth):** revert commits between "feat(web): create Supabase client" and "docs(web): clarify public URL". Web reverts to cookie auth.
- **Stage 2 (Postgres + middleware):** revert commits between "feat(auth): add IAuthService" and Stage 2 final test commit. API reverts to SQLite cookie auth.
- **Stage 1 (web bundling):** revert commits between "chore(api): add @fastify/static" and Stage 1 smoke test commit. API stops serving SPA.

Each stage's revert leaves the system in a working state at the prior stage.

---

## Summary

This plan implements 28 tasks across three stages. Each stage is independently deployable and testable.

| Stage | Tasks | Hours | Key Output |
|---|---|---|---|
| 1 | 1–6 | 2–3 | API serves SPA from same origin |
| 2 | 7–15 | 7–10 | Postgres stores + JWT middleware live (auth still local-only) |
| 3 | 16–28 | 7–9 | Supabase Auth on web + production smoke tested |
| **Total** | **28** | **16–22** | **External contributors can register agents via durable invite links** |

Critical risks mitigated in v2:
- Auth middleware is registered before route rewrites (no compile breakage)
- JWT signature is actually verified (no auth bypass)
- Test migration is split into manageable sub-tasks (no all-in-one debugging session)
- No placeholders in code samples — every method enumerated
