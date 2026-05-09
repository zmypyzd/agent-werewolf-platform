# External Contributor Agent Invite System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable external contributors to register agents via durable, public invite links by implementing web SPA bundling, Postgres store migration, and Supabase Auth integration across three independent stages.

**Architecture:** Stage 1 bundles the React SPA into the API container. Stage 2 swaps SQLite stores to Postgres with `IAuthService` abstraction for test hermiticity. Stage 3 flips auth from cookies to Supabase JWT.

**Tech Stack:** Fastify, Vite, React, Supabase Auth, Postgres, TypeScript 5.5 strict, Vitest 2

---

## File Structure Overview

### New Files

```
packages/auth/src/auth-service.ts              IAuthService interface + implementations
apps/api/public/                               (created by Docker build, contains SPA dist)
apps/api/src/middleware/auth.ts                JWT verification middleware
apps/web/src/lib/supabase.ts                   Supabase client singleton
apps/web/src/lib/auth.ts                       Supabase auth hooks
apps/web/src/pages/LoginPage.tsx               Email+password login (rewrite)
apps/web/src/pages/SignupPage.tsx              Email+password signup (rewrite)
```

### Modified Files

```
Dockerfile                                     Add web build stage
apps/api/package.json                          Add @fastify/static, @supabase/supabase-js
apps/api/src/server.ts                         Wire Postgres stores, remove SQLite, add static
apps/api/src/index.ts                          Pass static publicDir opt
apps/api/src/routes/agent-invites.ts           Rewrite for IAgentInviteStorePg
apps/api/src/routes/me-agents.ts               Rewrite for IAgentStore
apps/api/src/routes/auth.ts                    Delete entirely (move to Supabase)
apps/web/package.json                          Add @supabase/supabase-js
apps/web/.env.example                          Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
apps/web/src/lib/api.ts                        Add JWT header, 401 signout logic
apps/web/src/router.tsx                        Add ProtectedRoute wrapper
All test files in apps/api/src/__tests__/*     Inject MockAuthService + SQLite
```

---

## STAGE 1: Web Bundling (2–3 hours)

### Task 1: Add @fastify/static dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add dependency**

Edit `apps/api/package.json` and add to `dependencies`:
```json
"@fastify/static": "^6.14.0"
```

- [ ] **Step 2: Install and verify**

```bash
cd apps/api && pnpm install
grep -A 1 "@fastify/static" package.json
```

Expected output: `"@fastify/static": "^6.14.0"` appears in package.json and lock file is updated.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/pnpm-lock.yaml
git commit -m "feat(api): add @fastify/static for SPA bundling"
```

---

### Task 2: Register @fastify/static in server.ts

**Files:**
- Modify: `apps/api/src/server.ts:1-50` (top of file, around imports)
- Modify: `apps/api/src/server.ts:155-175` (where plugins are registered)

- [ ] **Step 1: Add import**

At the top of `apps/api/src/server.ts`, after other imports, add:
```ts
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
```

- [ ] **Step 2: Add static registration (conditional on publicDir)**

In `buildServer()`, after `app = Fastify(...)` line (around line 157), before `app.removeContentTypeParser`, add:

```ts
// If publicDir is provided (web SPA), serve it at / with history fallback for SPA routing
if (opts.publicDir) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicPath = join(__dirname, '../../..', opts.publicDir); // relative to src/
  
  app.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
    constraints: {},
  });
  
  // SPA history mode: serve index.html for routes not matched by /api or static files
  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith('/api')) {
      reply.sendFile('index.html');
    } else {
      reply.code(404).send({ error: 'Not Found' });
    }
  });
}
```

- [ ] **Step 3: Update BuildServerOptions type**

Find `interface BuildServerOptions` (around line 85) and add:

```ts
export interface BuildServerOptions {
  // ... existing options ...
  publicDir?: string; // Path to SPA public directory (relative to project root)
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): register @fastify/static with SPA history fallback"
```

---

### Task 3: Update Dockerfile to build and bundle web

**Files:**
- Modify: `Dockerfile` (add web build stage and copy step)

- [ ] **Step 1: Read current Dockerfile to understand structure**

```bash
head -50 Dockerfile
```

Identify the builder and runner stages.

- [ ] **Step 2: Add web build stage**

After the existing builder stage closes, add a new stage before runner:

```dockerfile
# ─── Stage 3: web (build the Vite SPA) ──────────────────────────────
FROM base AS web
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
# Copy shared config but skip copying everything; we'll do that in builder
RUN pnpm install --frozen-lockfile --filter web...

# Copy source
COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/

# Build web SPA
RUN cd apps/web && pnpm build
```

- [ ] **Step 3: Update runner stage to copy web dist**

In the runner stage, after `COPY --from=builder /app/apps/api/dist ...`, add:

```dockerfile
# Copy web SPA dist into API public directory
COPY --from=web /app/apps/web/dist /app/apps/api/public
```

- [ ] **Step 4: Verify Dockerfile syntax**

```bash
docker build --dry-run . 2>&1 | head -20
```

Should succeed or show parse warnings only (not errors).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "feat: add web build stage and bundle dist/ into API container"
```

---

### Task 4: Pass publicDir to buildServer in index.ts

**Files:**
- Modify: `apps/api/src/index.ts:10-20` (where buildServer is called)

- [ ] **Step 1: Update buildServer call**

In `apps/api/src/index.ts`, update the `opts` object passed to `buildServer()`:

```ts
const opts: BuildServerOptions = {
  publicDir: process.env.PUBLIC_DIR || 'apps/api/public', // Default for Docker
};
```

Or, if you want to be more explicit that it exists:

```ts
const opts: BuildServerOptions = {
  ...(process.env.PUBLIC_DIR && { publicDir: process.env.PUBLIC_DIR }),
};
```

(Choose one; first is simpler.)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): wire publicDir option to buildServer"
```

---

### Task 5: Update .gitignore for web dist/

**Files:**
- Modify: `apps/web/.gitignore`

- [ ] **Step 1: Ensure dist/ is gitignored**

```bash
grep "dist" apps/web/.gitignore
```

If not present, add to `apps/web/.gitignore`:
```
dist/
dist-ssr/
```

- [ ] **Step 2: Commit if changed**

```bash
git add apps/web/.gitignore
git commit -m "chore: ensure dist/ is gitignored in web"
```

(If no change needed, skip this step.)

---

### Task 6: Smoke test bundling locally

**Files:**
- No new files; testing existing changes

- [ ] **Step 1: Build Docker image locally**

```bash
docker build -t agent-platform-test . 2>&1 | tail -20
```

Expected: Build succeeds, final image size ~250MB, no errors in web build stage.

- [ ] **Step 2: Run container**

```bash
docker run -p 3000:3000 agent-platform-test &
sleep 3
```

- [ ] **Step 3: Test SPA is served**

```bash
curl http://localhost:3000/ | head -20
```

Expected: Returns HTML with `<title>` and `<div id="root">`.

- [ ] **Step 4: Test API still works**

```bash
curl http://localhost:3000/api/v1/health
```

Expected: JSON response `{ status: "ok" }` or similar.

- [ ] **Step 5: Kill container**

```bash
pkill -f "docker run.*agent-platform-test"
```

- [ ] **Step 6: Commit (no code change, but document success)**

```bash
# No new changes, but verify the earlier commits are solid
git log --oneline | head -5
```

Expected: Recent commits include bundling-related messages.

---

## STAGE 2: Postgres Stores Swap (4–6 hours)

### Task 7: Create IAuthService interface and implementations

**Files:**
- Create: `packages/auth/src/auth-service.ts`

- [ ] **Step 1: Write interface and MockAuthService**

```ts
// packages/auth/src/auth-service.ts

/**
 * Verifies and extracts user ID from an Authorization header.
 * Production: validates Supabase JWT signature.
 * Tests: Mock implementation, accepts any Bearer token.
 */
export interface IAuthService {
  verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }>;
}

export class MockAuthService implements IAuthService {
  constructor(private defaultUserId?: string) {}

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

    // For tests: use defaultUserId or extract from token (format: "user-<id>" for testing)
    const userId = this.defaultUserId || extractUserIdFromMockToken(token);
    return { userId, jwt: token };
  }
}

function extractUserIdFromMockToken(token: string): string {
  // Mock token format: "mock-<userId>" or just any non-empty string → use first 8 chars as ID
  return token.startsWith('mock-') ? token.substring(5) : token.substring(0, 8);
}

export class SupabaseAuthService implements IAuthService {
  constructor(private supabaseUrl: string, private supabaseServiceRoleKey: string) {}

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

    // Verify Supabase JWT using the public key from Supabase
    // For now, a simple implementation: try to extract sub (user ID) from JWT claims
    // In production, you'd use supabase-js verifyIdToken or manual JWT verification
    const userId = extractUserIdFromSupabaseJwt(token);
    if (!userId) {
      throw new Error('Invalid or expired JWT');
    }

    return { userId, jwt: token };
  }
}

function extractUserIdFromSupabaseJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Export from packages/auth/src/index.ts**

Add to `packages/auth/src/index.ts`:
```ts
export type { IAuthService };
export { MockAuthService, SupabaseAuthService };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/auth && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/auth-service.ts packages/auth/src/index.ts
git commit -m "feat(auth): add IAuthService interface with Mock and Supabase implementations"
```

---

### Task 8: Update BuildServerOptions and server.ts to wire IAuthService

**Files:**
- Modify: `apps/api/src/server.ts:85-100` (BuildServerOptions)
- Modify: `apps/api/src/server.ts:145-155` (buildServer function signature)

- [ ] **Step 1: Add IAuthService to BuildServerOptions**

```ts
import { IAuthService, MockAuthService } from '@agent-poker/auth';

export interface BuildServerOptions {
  // ... existing options ...
  authService?: IAuthService;
  publicDir?: string;
}
```

- [ ] **Step 2: Default to MockAuthService in buildServer**

In the `buildServer()` function body, add (after `const authDb = ...` line):

```ts
const authService = opts.authService ?? new MockAuthService();
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): wire IAuthService to BuildServerOptions"
```

---

### Task 9: Add @supabase/supabase-js to API (for createUserScopedClient)

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add dependency**

Edit `apps/api/package.json` and ensure `@supabase/supabase-js` is in dependencies:

```json
"@supabase/supabase-js": "^2.45.0"
```

(It may already be present from the persistence package; verify it's listed.)

- [ ] **Step 2: Install and verify**

```bash
cd apps/api && pnpm install
grep "@supabase/supabase-js" package.json
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/pnpm-lock.yaml
git commit -m "chore(api): ensure @supabase/supabase-js is available"
```

---

### Task 10: Rewrite agent-invites.ts to use PostgresAgentInviteStore

**Files:**
- Modify: `apps/api/src/routes/agent-invites.ts` (entire file rewrite)

- [ ] **Step 1: Read the current file to understand structure**

```bash
head -50 apps/api/src/routes/agent-invites.ts
```

Note the existing route structure.

- [ ] **Step 2: Rewrite POST /agents/invites route**

Replace the route with:

```ts
app.post(
  '/agents/invites',
  { preHandler: [app.requireAuth] }, // requireAuth middleware will populate req.user
  async (req, reply) => {
    let body;
    try {
      body = CreateAgentInviteRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    // Extract userId from req.user (populated by auth middleware)
    const userId = (req as any).user?.userId;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Generate token
    const token = randomBytes(24).toString('base64url');

    // Use Postgres store with user-scoped client for RLS
    const { jwt } = (req as any).user;
    const userClient = createUserScopedClient(supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    const invite = await store.create({
      rawToken: token,
      ownerId: userId,
      displayName: body.displayName ?? null,
      notes: body.notes ?? null,
      expiresAt: Date.now() + body.ttlSec * 1000,
    });

    reply.status(201).send({
      data: {
        token: invite.tokenHash,
        expiresAt: invite.expiresAt,
        registerUrl: registerUrlFor(req, token),
      },
    });
  },
);
```

(Keep the existing helpers like `registerUrlFor`, `inviteStatus`, `toPublicInvite`.)

- [ ] **Step 3: Update GET /agents/invites**

```ts
app.get(
  '/agents/invites',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    const userId = (req as any).user?.userId;
    if (!userId) throw new Error('User not authenticated');

    const { jwt } = (req as any).user;
    const userClient = createUserScopedClient(supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    const invites = await store.list(userId);
    reply.send({ data: invites.map(toPublicInvite) });
  },
);
```

- [ ] **Step 4: Update DELETE /agents/invites/:token**

```ts
app.delete<{ Params: { token: string } }>(
  '/agents/invites/:token',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    const userId = (req as any).user?.userId;
    if (!userId) throw new Error('User not authenticated');

    const { jwt } = (req as any).user;
    const userClient = createUserScopedClient(supabaseConfig, jwt);
    const store = new PostgresAgentInviteStore(userClient);

    // Check ownership
    const invite = await store.findByRawToken(req.params.token);
    if (!invite || invite.ownerId !== userId) {
      throw new AgentInviteNotFoundError(req.params.token);
    }

    const revoked = await store.revokeUnused(userId, req.params.token);
    if (!revoked) throw new AgentInviteUnavailableError(req.params.token);
    reply.status(204).send();
  },
);
```

- [ ] **Step 5: Update POST /agents/invites/:token/register (public, no auth)**

```ts
app.post<{ Params: { token: string } }>(
  '/agents/invites/:token/register',
  async (req, reply) => {
    let body;
    try {
      body = RegisterAgentInviteRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    // Use service-role client (public endpoint, but validates invite)
    const serviceClient = createServiceRoleClient(supabaseConfig);
    const inviteStore = new PostgresAgentInviteStore(serviceClient);
    const agentStore = new PostgresAgentStore(serviceClient);

    const invite = await inviteStore.findByRawToken(req.params.token);
    if (!invite) throw new AgentInviteNotFoundError(req.params.token);

    // Validate not used/revoked/expired
    if (invite.usedAt !== null || invite.revokedAt !== null || invite.expiresAt < Date.now()) {
      throw new AgentInviteUnavailableError(req.params.token);
    }

    // Create agent under invite owner's account
    const config = await agentStore.create({
      ownerId: invite.ownerId,
      name: body.displayName,
      description: invite.notes ?? undefined,
      protocol: 'http',
      callbackUrl: body.endpointUrl,
      authHeaderName: body.authHeaderName ?? null,
      authHeaderValue: body.authHeaderValue ?? null,
      timeoutMs: body.timeoutMs,
    });

    // Mark invite as used
    await inviteStore.markUsed(req.params.token, config.id);

    reply.status(201).send({
      data: {
        agent: toPublicConfig(config),
        invite: toPublicInvite({
          ...invite,
          usedAt: Date.now(),
          registeredAgentId: config.id,
        }),
      },
    });
  },
);
```

(Adapt `toPublicConfig` helper as needed for the new `IAgentStore` interface.)

- [ ] **Step 6: Update imports at top of file**

```ts
import {
  PostgresAgentStore,
  PostgresAgentInviteStore,
  createServiceRoleClient,
  createUserScopedClient,
  type SupabaseClientConfig,
} from '@agent-poker/persistence';
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

Expected: No errors related to agent-invites.ts.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/agent-invites.ts
git commit -m "feat(routes): rewrite agent-invites to use PostgresAgentInviteStore"
```

---

### Task 11: Rewrite me-agents.ts to use PostgresAgentStore

**Files:**
- Modify: `apps/api/src/routes/me-agents.ts`

- [ ] **Step 1: Read the current route**

```bash
head -30 apps/api/src/routes/me-agents.ts
```

- [ ] **Step 2: Rewrite routes to use PostgresAgentStore**

Key changes:
- Import `PostgresAgentStore` and `createUserScopedClient` from persistence
- In each authenticated route, extract `userId` from `req.user`
- Create a Postgres client with the user's JWT via `createUserScopedClient`
- Use `PostgresAgentStore` instead of `SqliteUserAgentConfigStore`

Example for GET /agents:

```ts
app.get(
  '/agents',
  { preHandler: [app.requireAuth] },
  async (req, reply) => {
    const userId = (req as any).user?.userId;
    const jwt = (req as any).user?.jwt;
    if (!userId) throw new Error('User not authenticated');

    const userClient = createUserScopedClient(supabaseConfig, jwt);
    const store = new PostgresAgentStore(userClient);

    const agents = await store.list(userId);
    reply.send({ data: agents });
  },
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/me-agents.ts
git commit -m "feat(routes): rewrite me-agents to use PostgresAgentStore"
```

---

### Task 12: Delete apps/api/src/routes/auth.ts

**Files:**
- Delete: `apps/api/src/routes/auth.ts`

- [ ] **Step 1: Check if route is registered in server.ts**

```bash
grep -n "authRoutes\|auth.ts" apps/api/src/server.ts
```

- [ ] **Step 2: Remove registration from server.ts (if present)**

Remove the line that calls `app.register(authRoutes, ...)` from `server.ts`.

- [ ] **Step 3: Delete the file**

```bash
git rm apps/api/src/routes/auth.ts
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): remove auth.ts route (moved to Supabase Auth)"
```

---

### Task 13: Update all test files to inject MockAuthService

**Files:**
- Modify: All files in `apps/api/src/__tests__/*.test.ts`

This is a bulk update. For each test file:

- [ ] **Step 1: Update buildServer call in test setup**

Find all places where `buildServer()` is called (usually in `beforeEach` or test setup). Change from:

```ts
const app = buildServer();
```

To:

```ts
const authDb = openDatabase(':memory:');
const app = buildServer({
  authService: new MockAuthService('test-user-' + Math.random().toString(36).substring(7)),
  authDb,
  userStore: new SqliteUserStore(authDb),
  sessionStore: new SqliteSessionStore(authDb),
  agentInviteStore: new SqliteAgentInviteStore(authDb),
  agentConfigStore: new SqliteUserAgentConfigStore(authDb),
});
```

(You may need to adjust constructor names if they differ; check `packages/auth/src/index.ts` for exact exports.)

- [ ] **Step 2: Import MockAuthService**

Add to imports in each test file:

```ts
import { MockAuthService } from '@agent-poker/auth';
```

- [ ] **Step 3: Remove any old cookie/session setup code**

If tests were manually setting cookies or session data, remove that code (MockAuthService and the injected SQLite stores handle it).

- [ ] **Step 4: Update authenticated requests**

For routes that require auth, change from:
```ts
test.set('Cookie', 'apk_sid=...');
```

To:
```ts
// Add Authorization header with mock token
const mockToken = 'mock-test-user-id';
request.set('Authorization', `Bearer ${mockToken}`);
```

Or if the test uses a specific userId, pass it to MockAuthService constructor:
```ts
const testUserId = 'specific-test-user';
const app = buildServer({
  authService: new MockAuthService(testUserId),
  // ...
});
```

- [ ] **Step 5: Run all tests**

```bash
cd apps/api && pnpm test
```

Expected: All tests pass. May need to adjust test expectations if they were checking specific session keys.

- [ ] **Step 6: Commit all test changes together**

```bash
git add apps/api/src/__tests__/
git commit -m "test(api): wire MockAuthService + SQLite stores to all tests"
```

---

### Task 14: Smoke test Stage 2 routes

**Files:**
- No code changes; testing the routes via Vitest

- [ ] **Step 1: Run all tests**

```bash
cd apps/api && pnpm test
```

Expected: All tests pass with green checkmarks.

- [ ] **Step 2: Verify Postgres stores are being used**

In one or two of the agent-invites or me-agents tests, add a console.log or assertion to confirm Postgres methods are called:

```ts
test('create invite via POST /agents/invites', async () => {
  const { body } = await request
    .post('/api/v1/agents/invites')
    .set('Authorization', 'Bearer mock-test-user')
    .send({ displayName: 'Test', ttlSec: 86400 });

  expect(body.data.token).toBeDefined();
  expect(body.data.registerUrl).toContain('werewolf-api-ttsb'); // Not localhost
});
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit (document passing state)**

```bash
git log --oneline | head -3
```

Just verify the recent commits are there. No new changes to commit.

---

## STAGE 3: Supabase Auth Flip (4–5 hours)

### Task 15: Add @supabase/supabase-js to web

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependency**

```json
"@supabase/supabase-js": "^2.45.0"
```

- [ ] **Step 2: Install**

```bash
cd apps/web && pnpm install
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat(web): add @supabase/supabase-js"
```

---

### Task 16: Create supabase.ts client

**Files:**
- Create: `apps/web/src/lib/supabase.ts`

- [ ] **Step 1: Write the client**

```ts
// apps/web/src/lib/supabase.ts

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars');
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/supabase.ts
git commit -m "feat(web): create Supabase client"
```

---

### Task 17: Create auth hooks in auth.ts

**Files:**
- Create: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Write auth hooks**

```ts
// apps/web/src/lib/auth.ts

import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import type { AuthSession, User } from '@supabase/supabase-js';

export interface Session {
  user: User | null;
  session: AuthSession | null;
  isLoading: boolean;
}

export function useSession(): Session {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Subscribe to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription?.unsubscribe();
  }, []);

  return { session, user, isLoading };
}

export async function signUp(email: string, password: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function signOut(): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    return { error: error.message };
  }

  return {};
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "feat(web): create Supabase auth hooks (signUp, signIn, signOut, useSession)"
```

---

### Task 18: Create LoginPage.tsx

**Files:**
- Create: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/pages/LoginPage.tsx

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signIn } from '../lib/auth.js';

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

    const { error: signInError } = await signIn(email, password);

    if (signInError) {
      setError(signInError);
      setIsLoading(false);
    } else {
      navigate('/agents');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto' }}>
      <h1>Sign In</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Email:
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </label>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Password:
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </label>
        </div>
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
      <p>
        Don't have an account? <Link to="/signup">Sign up</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): create LoginPage with email+password form"
```

---

### Task 19: Create SignupPage.tsx

**Files:**
- Create: `apps/web/src/pages/SignupPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/pages/SignupPage.tsx

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signUp } from '../lib/auth.js';

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const { error: signUpError } = await signUp(email, password);

    if (signUpError) {
      setError(signUpError);
      setIsLoading(false);
    } else {
      setSubmitted(true);
      // Automatically redirect after signup (Supabase auto-confirms or requires email confirmation)
      setTimeout(() => navigate('/login'), 2000);
    }
  };

  if (submitted) {
    return (
      <div style={{ maxWidth: '400px', margin: '100px auto' }}>
        <h1>Check Your Email</h1>
        <p>
          A confirmation link has been sent to your email. Please check your inbox and click the link to confirm your account.
        </p>
        <p>
          Redirecting to login in 2 seconds...{' '}
          <Link to="/login">Click here to go now</Link>
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto' }}>
      <h1>Sign Up</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Email:
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </label>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Password:
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </label>
        </div>
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Signing up...' : 'Sign Up'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/SignupPage.tsx
git commit -m "feat(web): create SignupPage with email confirmation message"
```

---

### Task 20: Update api.ts to include JWT header and handle 401

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Read current api.ts**

```bash
head -40 apps/web/src/lib/api.ts
```

- [ ] **Step 2: Add JWT header and 401 handling**

Find the `fetch` wrapper and update it:

```ts
import { supabase } from './supabase.js';
import { signOut } from './auth.js';

export const api = {
  async request<T = unknown>(
    method: string,
    path: string,
    options?: RequestInit & { body?: unknown }
  ): Promise<T> {
    const { session } = await supabase.auth.getSession();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Add JWT if available
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(path, {
      ...options,
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    // Handle 401 — session expired, sign out and redirect
    if (response.status === 401) {
      await signOut();
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  },

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  },

  post<T = unknown>(path: string, body: unknown) {
    return this.request<T>('POST', path, { body });
  },

  // ... other methods (put, delete, etc.)
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add JWT Authorization header to API calls, handle 401 logout"
```

---

### Task 21: Create ProtectedRoute wrapper in router.tsx

**Files:**
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Add ProtectedRoute component**

Add this component near the top of the router file:

```tsx
import { Navigate } from 'react-router-dom';
import { useSession } from './lib/auth.js';

interface ProtectedRouteProps {
  component: React.ComponentType<any>;
}

function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Component />;
}
```

- [ ] **Step 2: Wrap protected routes**

In the route definitions, wrap pages that need auth:

```tsx
const routes: RouteObject[] = [
  {
    path: '/',
    element: <ProtectedRoute component={DashboardPage} />,
  },
  {
    path: '/agents',
    element: <ProtectedRoute component={AgentsPage} />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/signup',
    element: <SignupPage />,
  },
  // ... other routes
];
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/router.tsx
git commit -m "feat(web): add ProtectedRoute wrapper for authenticated pages"
```

---

### Task 22: Update .env.example with Supabase vars

**Files:**
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Add Supabase env vars**

Add to `apps/web/.env.example`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/.env.example
git commit -m "docs(web): add VITE_SUPABASE_* to .env.example"
```

---

### Task 23: Create JWT verification middleware in API

**Files:**
- Create: `apps/api/src/middleware/auth.ts` (new file, or modify if exists)

- [ ] **Step 1: Write middleware**

```ts
// apps/api/src/middleware/auth.ts

import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@agent-poker/shared';
import type { IAuthService } from '@agent-poker/auth';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    userId: string;
    jwt: string;
  };
}

export function createAuthMiddleware(authService: IAuthService) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      const { userId, jwt } = await authService.verifyJwt(authHeader);
      request.user = { userId, jwt };
    } catch (err) {
      throw new AppError('UNAUTHORIZED', 'Invalid or missing credentials', 401);
    }
  };
}
```

- [ ] **Step 2: Wire requireAuth middleware in server.ts**

In `server.ts`, replace the old cookie-based `requireAuth`:

```ts
app.decorate('requireAuth', createAuthMiddleware(authService));
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/server.ts
git commit -m "feat(api): add JWT verification middleware"
```

---

### Task 24: Update Dockerfile to pass Supabase env vars to web build

**Files:**
- Modify: `Dockerfile` (web build stage)

- [ ] **Step 1: Update web stage to accept env vars**

Find the web build stage and modify:

```dockerfile
# ─── Stage 3: web (build the Vite SPA with Supabase env) ──────────────────
FROM base AS web
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/

RUN cd apps/web && pnpm build
```

- [ ] **Step 2: Update runner stage (if needed)**

No change needed to runner stage; the dist/ is already copied.

- [ ] **Step 3: Verify Dockerfile syntax**

```bash
docker build --dry-run \
  --build-arg VITE_SUPABASE_URL=http://example \
  --build-arg VITE_SUPABASE_ANON_KEY=test . 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: pass VITE_SUPABASE_* build args to web stage"
```

---

### Task 25: Smoke test Stage 3 locally (web signup/signin)

**Files:**
- No code changes; testing the flows

- [ ] **Step 1: Create .env.local for web with test values**

```bash
cat > apps/web/.env.local << 'EOF'
VITE_SUPABASE_URL=https://your-test-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-test-anon-key
EOF
```

(Use your actual Supabase test project keys.)

- [ ] **Step 2: Start dev server**

```bash
cd apps && pnpm --filter web dev &
sleep 3
```

- [ ] **Step 3: Open browser and test signup**

- Navigate to `http://localhost:5173/signup`
- Enter test email and password
- Click "Sign Up"
- Check localStorage for `sb-*` keys (Supabase session storage)

Expected: Browser console shows no errors, Supabase client initializes.

- [ ] **Step 4: Test API call with JWT**

In browser console:

```js
const session = (await supabase.auth.getSession()).data.session;
fetch('/api/v1/agents', {
  headers: { 'Authorization': `Bearer ${session.access_token}` }
}).then(r => r.json()).then(console.log);
```

Expected: API returns 200 with agent list (or empty array if no agents).

- [ ] **Step 5: Kill dev server**

```bash
pkill -f "vite"
pkill -f "pnpm.*dev"
```

- [ ] **Step 6: No commit needed**

Test passed; implementation is working.

---

### Task 26: Deploy to staging and end-to-end test

**Files:**
- No code changes; deployment and verification

- [ ] **Step 1: Build Docker image with Supabase env**

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="https://your-project.supabase.co" \
  --build-arg VITE_SUPABASE_ANON_KEY="your-anon-key" \
  -t agent-platform-stage3 . 2>&1 | tail -10
```

- [ ] **Step 2: Run container**

```bash
docker run \
  -p 3000:3000 \
  -e SUPABASE_URL="https://your-project.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  -e SUPABASE_ANON_KEY="your-anon-key" \
  agent-platform-stage3 &
sleep 3
```

- [ ] **Step 3: Test signup flow**

```bash
curl -X POST http://localhost:3000/api/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "test123"}'
```

(Verify endpoint exists; adjust if needed.)

- [ ] **Step 4: Test create invite as owner**

First, authenticate and get JWT, then:

```bash
curl -X POST http://localhost:3000/api/v1/agents/invites \
  -H "Authorization: Bearer <jwt-from-login>" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Test", "ttlSec": 86400}'
```

Expected: Returns `{ data: { token, registerUrl, expiresAt } }`.

- [ ] **Step 5: Test register external agent**

```bash
curl -X POST http://localhost:3000/api/v1/agents/invites/<token>/register \
  -H "Content-Type: application/json" \
  -d '{"displayName": "ExternalAgent", "endpointUrl": "https://example.com/decide", "timeoutMs": 5000}'
```

Expected: Returns `{ data: { agent: {...}, invite: {...} } }`.

- [ ] **Step 6: Kill container**

```bash
pkill -f "docker run.*agent-platform-stage3"
```

- [ ] **Step 7: Document test results**

No code commit, but verify the following passed:
- Signup/signin through web UI
- JWT in localStorage
- API accepts Authorization header
- Invite creation and registration workflows work

---

### Task 27: Final verification and documentation

**Files:**
- No code changes; review and document

- [ ] **Step 1: Run full test suite**

```bash
cd apps/api && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Verify TypeScript builds**

```bash
pnpm build
```

Expected: No errors.

- [ ] **Step 3: Check git log for commits**

```bash
git log --oneline | head -30
```

Expected: All Stage 1, 2, and 3 commits are present.

- [ ] **Step 4: Update memory with completion notes**

Document the completion in the user's memory (optional, but useful for future sessions).

- [ ] **Step 5: Ready for deployment**

All three stages are complete. Next step: deploy to Render via the Vercel/Render workflow (outside scope of this plan).

---

## Summary

This plan implements three independent stages:

1. **Web Bundling:** Fastify serves the SPA and API from the same origin (werewolf-api-ttsb.onrender.com).
2. **Postgres Stores Swap:** SQLite auth stores migrate to Postgres via `IAuthService` abstraction for test hermiticity.
3. **Supabase Auth Flip:** Web authenticates via Supabase Auth (email+password), API verifies JWT.

Each stage is deployable independently. The invite flow remains unchanged for external contributors; they always curl the register endpoint without authentication.

Total estimated effort: **10–14 hours of focused development** (including testing and commits).
