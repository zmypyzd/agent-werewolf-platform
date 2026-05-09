# External Contributor Agent Invite System — Design Spec

**Date:** 2026-05-09  
**Status:** Approved  
**Modules:** Poker, Werewolf  
**Audience:** External contributors (coding agents, HTTP webhooks)

## Problem Statement

Currently, the agent platform runs only in-memory SQLite for auth/sessions/invites. This means:
- Invites generated on local dev (e.g., localhost:3000) are not valid on production (Render).
- Render's free tier sleeps after 15 mins, wiping all invite state.
- External contributors can't bootstrap an agent via a shareable invite link because the platform has no persistent, web-accessible invite mechanism.

The goal is to make invite links **durable, public, and usable by external contributors** by:
1. Persisting auth/invites to Supabase Postgres (RLS-protected)
2. Deploying the web SPA to production (same origin as API, no CORS)
3. Wiring Supabase Auth to the web frontend
4. Migrating API auth from cookie sessions to Supabase JWT

## Design Principles

- **Incremental rollout:** Three independent stages to catch and isolate failures.
- **Minimal data migration:** No real users exist yet (in-memory); delete all SQLite auth state and start fresh.
- **Test resilience:** Tests remain hermetic via `IAuthService` abstraction (Mock in tests, Supabase in prod).
- **RLS preservation:** Existing Postgres schema + RLS policies continue to work; `owner_id text` is compatible with `auth.uid()::text` matching.

## Architecture

```
┌─────────────────────────────────────────┐
│  Browser (https://werewolf-api-ttsb...)  │
│  ┌─────────────────────────────────────┐│
│  │  React SPA (Vite)                   ││
│  │  + @supabase/supabase-js            ││
│  │    └─ JWT in localStorage           ││
│  └─────────────────────────────────────┘│
└────────────────┬────────────────────────┘
                 │ same origin
┌────────────────▼────────────────────────┐
│  Fastify API + @fastify/static           │
│  ├─ / ← serves SPA dist/                 │
│  ├─ /api/v1/* (requireAuth middleware)  │
│  │  └─ verifies JWT via IAuthService    │
│  └─ routes use Postgres stores           │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Supabase Postgres                       │
│  ├─ auth.users (managed by Supabase)    │
│  ├─ public.profiles (1:1 with auth)     │
│  ├─ public.agents (owner_id text PK)    │
│  ├─ public.agent_invites (token_hash)   │
│  └─ public.werewolf_* (existing)        │
│                                         │
│  RLS: auth.uid()::text = owner_id       │
└─────────────────────────────────────────┘
```

## Three-Stage Rollout

### Stage 1: Web Bundling (2–3 hours)

**Goal:** Ship a production Docker image that serves the web SPA at `/` and API at `/api/v1/*` from the same origin.

**Changes:**
- `Dockerfile`: Add web build stage; copy `apps/web/dist` to `apps/api/public`
- `apps/api/src/server.ts`: Register `@fastify/static` for `/` with history fallback (SPA index.html)
- `apps/api/package.json`: Add `@fastify/static` dependency
- `apps/web/.gitignore`: Add `dist/` if not already present

**Testing:** No API route changes. Existing tests pass unchanged. Smoke test: Browser can load `/`, API still responds to `/api/v1/health`.

**Rollback:** Delete static registration from Fastify, revert Dockerfile.

---

### Stage 2: Postgres Stores Swap (4–6 hours)

**Goal:** Switch from SQLite user/session/invite stores to Postgres, with test compatibility via `IAuthService` abstraction.

**New files:**
- `packages/auth/src/auth-service.ts`:
  ```ts
  export interface IAuthService {
    verifyJwt(authHeader: string | undefined): Promise<{ userId: string; jwt: string }>;
  }
  export class SupabaseAuthService implements IAuthService { ... }
  export class MockAuthService implements IAuthService { ... }
  ```

**Modified files:**
- `apps/api/src/server.ts`:
  - Remove `SqliteUserStore`, `SqliteSessionStore`, `SqliteUserAgentConfigStore`, `SqliteAgentInviteStore` from production code path
  - Wire `PostgresAgentStore`, `PostgresAgentInviteStore` (already exist in persistence package)
  - Accept `IAuthService` via `opts` parameter
  - Remove cookie/CSRF plugin registration from production path

- `apps/api/src/routes/agent-invites.ts`:
  - Rewrite to use `IAgentInviteStorePg` interface (token-hashed lookups)
  - Extract `userId` from `req.user` (populated by auth middleware)
  - Use `createUserScopedClient(jwt)` for RLS enforcement

- `apps/api/src/routes/me-agents.ts`:
  - Rewrite to use `IAgentStore` (replaces `IUserAgentConfigStore`)
  - Same JWT extraction pattern

- `apps/api/src/routes/auth.ts`:
  - **Delete entirely** (signup/signin now handled by Supabase Auth on web)

- Tests (all files in `apps/api/src/__tests__/*`):
  - Wire `MockAuthService` + SQLite stores via `buildServer({ authService: new MockAuthService(...), authDb: ... })`
  - Tests remain fast and hermetic; no external Supabase dependency

**Verification:** All tests pass. Smoke test: API can write invites to Postgres, read them back with correct owner_id.

**Rollback:** Revert to SQLite stores, re-enable cookie plugin.

---

### Stage 3: Supabase Auth Flip (4–5 hours)

**Goal:** Migrate web from cookie sessions to Supabase Auth (email + password).

**Web files (new):**
- `apps/web/src/lib/supabase.ts`:
  ```ts
  export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
  ```

- `apps/web/src/lib/auth.ts`:
  - `signUp(email, password)` → `supabase.auth.signUp(...)`
  - `signIn(email, password)` → `supabase.auth.signInWithPassword(...)`
  - `signOut()` → `supabase.auth.signOut()`
  - `useSession()` hook → `supabase.auth.onAuthStateChange(...)`

- `apps/web/src/pages/LoginPage.tsx`:
  - Email input + password input + "Sign In" button
  - Call `signIn()` on submit, handle errors (display message)
  - Link to signup if no account

- `apps/web/src/pages/SignupPage.tsx`:
  - Email input + password input + "Sign Up" button
  - Call `signUp()`, show "check email" confirmation message if needed
  - Note: Supabase project setting controls whether email confirmation is required (default: yes)

**Web config:**
- `apps/web/.env.example`: Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Dockerfile: Pass `VITE_SUPABASE_*` from build env to `vite build`

**Web library changes:**
- `apps/web/src/lib/api.ts`:
  - Add `Authorization: Bearer ${session?.access_token}` header to fetch calls
  - On 401, call `signOut()` and redirect to `/login`

- `apps/web/src/router.tsx`:
  - Add `<ProtectedRoute>` wrapper
  - Check `useSession()` before rendering protected pages

**API files:**
- `apps/api/src/middleware/auth.ts` (new or refactored):
  - `requireAuth` middleware: parse `Authorization: Bearer <jwt>`
  - Call `IAuthService.verifyJwt(jwt)`
  - Populate `req.user = { userId }`

**Verification:**
- Web: Sign up → check localStorage for `supabase.auth.token` → sign in → request protected route → request includes JWT header
- API: Extract JWT, verify signature and expiry, return user ID
- End-to-end: Owner signs up → creates invite → sends to external person → external person curls register URL → agent appears under owner's account

**Rollback:** Remove supabase-js, reinstate cookie session + old login page.

---

## Data Structures & Flows

### Create Invite Flow (all stages)

1. **Stage 1–2:** Owner logs in via cookie session (`req.session.userId`)
   - `POST /api/v1/agents/invites` with cookie
   - API checks cookie validity
   - Route uses `createServiceRoleClient` (service-role key; no JWT needed yet)
   - Response includes `registerUrl = "https://werewolf-api-ttsb.onrender.com/api/v1/agents/invites/<token>/register"`

2. **Stage 3:** Owner logs in via Supabase Auth (`localStorage`)
   - `POST /api/v1/agents/invites` with `Authorization: Bearer <access_token>`
   - Middleware verifies JWT, populates `req.user.userId`
   - Route uses `createUserScopedClient(jwt)` (RLS enforcement)
   - Response includes same `registerUrl` (now valid on production)

### Register External Agent Flow (all stages, no owner auth needed)

1. External person: `curl -X POST https://werewolf-api-ttsb.onrender.com/api/v1/agents/invites/<token>/register` (no auth header)
2. Route uses `createServiceRoleClient` (bypasses RLS — safe because endpoint is public but only works with valid, unused invite token)
3. `PostgresAgentInviteStore.findByRawToken(token)` → validates not expired/used/revoked
4. `PostgresAgentStore.create({ ownerId: invite.ownerId, ... })` → creates agent under owner's account
5. Response: `{ agent: { id, name, ... }, invite: { status: 'used', ... } }`

---

## Testing Strategy

**Test isolation via `IAuthService`:**

All tests use `MockAuthService` (no JWT validation) + SQLite stores (hermetic, fast).

```ts
// Example test setup
const authDb = openDatabase(':memory:');
const app = buildServer({
  authService: new MockAuthService('test-user-123'),
  authDb,
  userStore: new SqliteUserStore(authDb),
  sessionStore: new SqliteSessionStore(authDb),
  agentConfigStore: new SqliteUserAgentConfigStore(authDb),
  agentInviteStore: new SqliteAgentInviteStore(authDb),
});
```

**Web tests:**

Existing Vitest tests for components continue. No Supabase client mock needed (or mock via `vitest.mock('@supabase/supabase-js')`).

**Smoke test (post-deploy):**

- [ ] Browser login/signup works; JWT appears in localStorage
- [ ] `POST /api/v1/agents/invites` with JWT header succeeds
- [ ] Invite link on production domain (werewolf-api-ttsb...) is valid
- [ ] External curl to register endpoint works

---

## Schema & Migrations

**No new migrations required.**

Existing schema (`supabase/migrations/20260508000000_init.sql`) has:
- `public.agents(owner_id text)`
- `public.agent_invites(owner_id text)`
- RLS policies: `auth.uid()::text = owner_id`

This remains unchanged. Phase 3 (future): optionally migrate `owner_id text → uuid references auth.users(id)` for stronger FK semantics, but not required for current functionality.

**Data migration:** None. No production data exists (all in-memory SQLite); delete all and start fresh.

---

## Deployment Checklist

### Stage 1
- [ ] `docker build` produces image with `/public/index.html`
- [ ] `curl http://localhost/` returns HTML
- [ ] `curl http://localhost/api/v1/health` returns 200

### Stage 2
- [ ] All tests pass
- [ ] `PostgresAgentInviteStore` + `PostgresAgentStore` write/read to Supabase
- [ ] `IAuthService` injection mechanism works in tests

### Stage 3
- [ ] Web signup/signin flows complete locally
- [ ] `Authorization: Bearer <jwt>` header is included in API calls
- [ ] Protected routes (e.g., `POST /api/v1/agents/invites`) accept JWT
- [ ] End-to-end: owner signs up → creates invite → external curl → success

---

## Render Environment Variables

**Existing:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `WEREWOLF_BRIEFING_ENABLED`

**New (Stage 3):**
- `VITE_SUPABASE_URL` (copy from `SUPABASE_URL` at build time)
- `VITE_SUPABASE_ANON_KEY` (copy from `SUPABASE_ANON_KEY` at build time)

These allow the bundled SPA to access Supabase Auth from the browser.

---

## Notes for Phase 3 (Not In Scope)

- Email confirmation toggle: Supabase project setting, not code. Consider disabling for demo/development.
- `owner_id text → uuid FK`: Deferred. Current RLS works via `auth.uid()::text = owner_id` casting.
- OAuth providers (GitHub, Google): Not in scope; email+password only.
- Password recovery: Handled by Supabase Auth UI (out of box).

---

## References

- `packages/persistence/src/postgres/postgres-agent-invite-store.ts` — token-hashed invite store
- `packages/persistence/src/postgres/postgres-agent-store.ts` — replaces `user_agent_configs`
- `supabase/migrations/20260508000000_init.sql` — schema with RLS
- `apps/web/src/pages/AgentsPage.tsx` — prompt builder for external agents
