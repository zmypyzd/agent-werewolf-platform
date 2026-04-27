# Phase 2 — Implementation Plan

Pair this with `phase-2-web-platform-spec.md` (product) and
`phase-2-web-platform-api.md` (HTTP / WS contracts).

This document is the engineering shipping order. Each milestone has
files to touch, acceptance criteria, and the exact command to verify
it. **Do not jump milestones.** Each one leaves the tree green
(`pnpm test` passes).

---

## 1. Architecture deltas vs. Phase 1

Concept-level changes:

1. **Storage.** Add SQLite (better-sqlite3) behind the existing
   `ITableStore` and `IHandStore` interfaces, plus three new stores
   (`IUserStore`, `ISessionStore`, `IUserAgentConfigStore`). Keep
   the Phase 1 in-memory + JSONL stores for tests and local
   simulation.
2. **Auth.** A new `packages/auth` with password hashing, session
   creation/validation, and a Fastify auth plugin that decorates
   `request.user`.
3. **Real-time hub.** A new `packages/realtime` that subscribes to
   the per-hand `EventEmitter` already created in
   `TableOrchestrator.startHand` (`packages/table-orchestrator/src/orchestrator.ts:191`)
   and fans out to WebSocket clients with a public/private filter.
4. **Human player.** A new `HumanAgent` in `agent-runtime` whose
   `requestDecision` returns a `Promise` that the API resolves when
   the user POSTs an action. Wraps cleanly in `TimeoutHandler`, so
   timeout / fallback behaviour is identical to other agents.
5. **HTTP agent.** Implement
   `packages/agent-runtime/src/http-agent-adapter.ts` with `fetch`,
   Zod parse of the response, and the existing `TimeoutHandler`.
6. **Orchestrator.** Add seat-as-human, seat-as-agent (using a
   user's `UserAgentConfig`), leave-seat (with `sitOutNextHand`
   semantics), and submit-action (resolves the pending `HumanAgent`
   promise). The mid-hand state machine stays inside `HandRunner`
   unchanged — we don't refactor it to a continuation-based engine
   in Phase 2.
7. **Frontend.** New `apps/web` (Vite + React).

The diagram below is the runtime topology Phase 2 lands on:

```
                ┌──────────────────────────────────────────┐
                │                  Browser                  │
                │  React app (apps/web)                     │
                │   ├── HTTP cookie session ─┐              │
                │   └── WebSocket /ws        │              │
                └────────────┬───────────────┴──────────────┘
                             │
                             ▼
       ┌────────────────────────────────────────────────────┐
       │                Fastify (apps/api)                   │
       │  /auth/*     /tables/*     /me/agents/*    /ws      │
       │     │            │              │           │       │
       │     ▼            ▼              ▼           ▼       │
       │  Auth plugin  Orchestrator  AgentConfigStore  Hub   │
       │  (Sessions)        │                          │     │
       │                    ▼                          │     │
       │            HandRunner ──emits ReplayEvent────►│     │
       │                    │                                │
       │                    ▼                                │
       │   IAgent: HumanAgent | HttpAgentAdapter | MockAgent │
       └─────────────┬───────────────────┬──────────────────┘
                     │                   │
                     ▼                   ▼
                 SQLite             user-owned
              (users, sessions,    HTTP endpoints
               agent configs,
               tables, hands,
               replay events)
```

---

## 2. Workspace changes

```
packages/
  shared/                 # extend types
  agent-protocol/         # extend Zod schemas
  poker-engine/           # unchanged
  agent-runtime/          # implement HttpAgentAdapter; add HumanAgent
  persistence/            # add SQLite stores; add User/Session/AgentConfig stores
  table-orchestrator/     # extend orchestrator with seat/leave/action/spectator
  auth/            (NEW)  # bcrypt/argon2 + cookie/session helpers + fastify plugin
  realtime/        (NEW)  # WS hub, topic registry, public/private filter

apps/
  api/                    # add new routes + WS + auth plugin
  web/             (NEW)  # Vite + React frontend
```

`pnpm-workspace.yaml` already includes `apps/*` and `packages/*`,
so new packages are picked up automatically.

---

## 3. Milestones

The order below is the recommended commit-by-commit path. After
each milestone, `pnpm build && pnpm test` must pass.

### M0 — Pre-flight (≈ 30 min)

- Confirm Node 20 (`.nvmrc`) and `pnpm install` succeed on the
  current tree.
- Run baseline: `pnpm test` and `pnpm demo` should pass.
- Branch off `phase-2/foundation`.

**Acceptance:** baseline tests green, demo prints 5 hand summaries.
**Verify:** `pnpm test && pnpm demo`.

---

### M1 — SQLite persistence

**New code:**
- `packages/persistence/src/sqlite/schema.sql` — DDL for `users`,
  `sessions`, `user_agent_configs`, `tables`, `hands`,
  `replay_events`.
- `packages/persistence/src/sqlite/connection.ts` — open db,
  apply migrations.
- `packages/persistence/src/sqlite/sqlite-table-store.ts` —
  implements `ITableStore` against SQLite.
- `packages/persistence/src/sqlite/sqlite-hand-store.ts` —
  implements `IHandStore` against SQLite.
- `packages/persistence/src/sqlite/sqlite-user-store.ts`,
  `sqlite-session-store.ts`,
  `sqlite-user-agent-config-store.ts` — implement the new
  interfaces.

**New interfaces** (added to
`packages/persistence/src/store-interface.ts`):

```ts
export interface IUserStore {
  createUser(u: NewUser): Promise<User>;
  findById(userId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
}
export interface ISessionStore {
  create(sessionId: string, userId: string, expiresAt: number): Promise<void>;
  find(sessionId: string): Promise<Session | null>;
  touch(sessionId: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
export interface IUserAgentConfigStore {
  list(userId: string): Promise<UserAgentConfig[]>;
  get(userId: string, agentConfigId: string): Promise<UserAgentConfig | null>;
  create(cfg: NewUserAgentConfig): Promise<UserAgentConfig>;
  update(userId: string, agentConfigId: string, patch: PatchUserAgentConfig): Promise<UserAgentConfig>;
  delete(userId: string, agentConfigId: string): Promise<void>;
}
```

**Dependency:** `better-sqlite3` (synchronous, single-process; the
right shape for our single-process server). Wrap calls in `Promise.resolve`
so the interface stays Promise-based.

**Acceptance:**
- All five stores have unit tests covering create / find / update
  / delete and uniqueness constraints (email unique).
- `MemoryTableStore`, `MemoryHandStore` tests still pass — they
  remain the default for the existing in-process tests.

**Verify:**
```
pnpm --filter @agent-poker/persistence run build
pnpm --filter @agent-poker/persistence run test
```

---

### M2 — Auth package

**New code:**
- `packages/auth/src/password.ts` — `hashPassword`, `verifyPassword`
  (argon2id; bcrypt fallback).
- `packages/auth/src/sessions.ts` — `createSession`,
  `validateSession` against an `ISessionStore`.
- `packages/auth/src/cookie.ts` — cookie name, options, helpers.
- `packages/auth/src/fastify-plugin.ts` — registers `@fastify/cookie`,
  decorates `request.user` (or null), exposes
  `app.requireAuth` lifecycle hook.
- `packages/auth/src/csrf.ts` — `assertSameOriginAndFetchHeader`
  helper used by mutating routes.

**Acceptance:**
- Hash a password, verify it round-trips, verify a wrong password
  fails.
- Create + validate + expire a session.
- `requireAuth` rejects requests without a cookie with HTTP 401.
- Test covers a simulated CSRF: no `X-Requested-With` header on a
  mutating route → 403.

**Verify:**
```
pnpm --filter @agent-poker/auth run test
```

---

### M3 — Auth API routes

**Touch:**
- `apps/api/src/server.ts` — register the auth plugin; mount
  `authRoutes`.
- `apps/api/src/routes/auth.ts` (NEW) — `POST /api/v1/auth/register`,
  `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`,
  `GET /api/v1/auth/me`.
- `packages/agent-protocol/src/schemas.ts` — add
  `RegisterRequestSchema`, `LoginRequestSchema`, `MeResponseSchema`.

**Acceptance:**
- Register, login, me, logout flow works end-to-end against an
  in-memory `IUserStore` + `ISessionStore` in tests.
- Password is never present in any response body.
- Cookies on the response are HttpOnly, Secure (in production),
  SameSite=Lax.

**Verify:**
```
pnpm --filter api run test -- auth.test
```

---

### M4 — Auth-aware ownership in orchestrator

**Touch:**
- `packages/shared/src/types.ts` — extend `SeatInfo` with
  `ownerUserId`, `adapterType`, `agentConfigId`,
  `sitOutNextHand`, `joinedAt`. Extend `TableState.status` to
  `'preparing' | 'in_hand' | 'paused' | 'completed'` and adjust
  the orchestrator's transitions in
  `packages/table-orchestrator/src/orchestrator.ts:140-238`.
- `packages/table-orchestrator/src/orchestrator.ts` — change
  `addAgent` to require `ownerUserId`. Add helpers
  `assertSeatOwnedBy(tableId, seatIndex, userId)`.
- `apps/api/src/routes/tables.ts` — protect mutating endpoints
  with `requireAuth`; reject ops on seats the user doesn't own.

**Acceptance:**
- Existing orchestrator tests updated to pass an `ownerUserId`.
- New test: user A cannot remove user B's seat.
- New test: status transitions match §6.1 of the spec.

**Verify:**
```
pnpm --filter @agent-poker/table-orchestrator run test
pnpm --filter api run test
```

---

### M5 — HumanAgent + action submission

**New code:**
- `packages/agent-runtime/src/human-agent.ts` —
  ```ts
  export class HumanAgent implements IAgent {
    readonly agentId: string; readonly name: string;
    private pending: { resolve: (r: AgentDecisionResponse) => void; reject: (e: Error) => void } | null = null;
    private currentRequest: AgentDecisionRequest | null = null;
    requestDecision(req): Promise<AgentDecisionResponse> { /* save resolver, await */ }
    submit(action: { actionType: ActionType; amount?: number }): void { /* validate matches currentRequest, resolve */ }
    cancel(): void { /* reject pending */ }
  }
  ```
  The `TimeoutHandler` wrapping in `hand-runner.ts:272` enforces
  the per-action timeout and falls back to check/fold if the
  human doesn't act.

**Touch:**
- `packages/table-orchestrator/src/orchestrator.ts` — add
  `submitHumanAction(tableId, userId, action)` that finds the
  user's `HumanAgent` and calls `submit`.
- `apps/api/src/routes/tables.ts` —
  `POST /api/v1/tables/:tableId/actions` (auth required).
  Validates against the open request's `legalActions` server-side
  before calling `submit`.

**Acceptance:**
- A test runs a full hand with two `HumanAgent`s, posting actions
  programmatically. Hand completes correctly.
- A test where the human never acts — `agent.timeout` event is
  emitted and check/fold is applied.
- A test where the human submits an illegal action — server
  rejects with 400 and the seat keeps waiting until timeout.

**Verify:**
```
pnpm --filter @agent-poker/agent-runtime run test
pnpm --filter @agent-poker/table-orchestrator run test
```

---

### M6 — HttpAgentAdapter

**Touch:**
- `packages/agent-runtime/src/http-agent-adapter.ts` —
  implement `requestDecision`:
  1. Build `AgentDecisionRequest` (the caller already does this).
  2. `fetch(endpoint, { method: 'POST', headers, body, signal })`
     using an `AbortController` whose timeout = `timeoutMs`.
  3. Reject on non-2xx or on body that fails
     `AgentDecisionResponseSchema.safeParse`.
  4. Return validated response.
  Note: `TimeoutHandler` already wraps this and converts errors to
  fallback actions. The adapter itself just throws on any failure.

**Touch:**
- `apps/api/src/routes/tables.ts` — when seating an agent, build
  an `HttpAgentAdapter` from the user's `UserAgentConfig`.

**Acceptance:**
- Unit test against a local Fastify mock that returns a valid
  decision → adapter returns parsed response.
- Mock returns malformed JSON → adapter throws → orchestrator
  records `agent.invalid_action`, applies fallback.
- Mock hangs longer than `timeoutMs` → `TimeoutHandler` falls back,
  emits `agent.timeout`.
- Auth header is sent if configured; never logged or echoed.

**Verify:**
```
pnpm --filter @agent-poker/agent-runtime run test
```

---

### M7 — Realtime hub + WebSocket

**New package:** `packages/realtime/`
- `src/hub.ts` — per-process registry: `tableId → Set<Connection>`,
  `topic → Set<Connection>`. Methods: `subscribe`, `unsubscribe`,
  `publishLobby`, `publishTable`, `publishToUser`.
- `src/filter.ts` — given a `ReplayEvent` and a connection's
  identity (spectator | seated player A | seated player B), strip
  any `holeCards` that don't belong to the recipient. Mid-hand,
  hole cards never leak.
- `src/wire.ts` — Zod schemas for `WsEvent` envelopes.

**Touch:**
- `apps/api/package.json` — add `@fastify/websocket`.
- `apps/api/src/server.ts` — register the WS plugin and
  `/ws` route. Auth: WS upgrade reads the cookie and resolves a
  user; an unauthenticated upgrade is rejected.
- `apps/api/src/routes/ws.ts` (NEW) — connection lifecycle:
  on connect, subscribe to `lobby` plus any tables the user
  asks to subscribe to via incoming messages
  `{ type: 'subscribe', topic: 'table:<id>' }`.
- `packages/table-orchestrator/src/orchestrator.ts` — accept an
  optional `RealtimeHub` and forward the per-hand emitter into
  `hub.publishTable(tableId, event)`. Forward
  `action.requested` to the seated user via `hub.publishToUser`
  with the private state.

**Acceptance:**
- Two WS clients on the same table see synchronized public events.
- A seated player receives `seat:` events with their own private
  state; a spectator never does.
- A test asserts that no WS frame sent to a spectator contains
  the substring of any non-spectator's hole cards.

**Verify:**
```
pnpm --filter @agent-poker/realtime run test
pnpm --filter api run test -- ws.test
```

---

### M8 — Lobby endpoints + table status mapping

**Touch:**
- `apps/api/src/routes/tables.ts` —
  `GET /api/v1/tables` returns `TableSummary` shape (see API doc).
  `POST /api/v1/tables` requires auth and stamps `ownerUserId`.
  `GET /api/v1/tables/:tableId` returns the full `TableState`
  with masked agent secrets and no hole cards.
- `packages/table-orchestrator/src/orchestrator.ts` — emit
  `lobby.table_created` on creation and `lobby.table_updated` on
  status / seat-count change.

**Acceptance:**
- Creating a table broadcasts `lobby.table_created` to all WS
  clients on the lobby topic.
- Sitting / leaving updates the table summary and broadcasts
  `lobby.table_updated`.

**Verify:**
```
pnpm --filter api run test -- lobby.test
```

---

### M9 — Seat / spectator endpoints

**Touch:**
- `apps/api/src/routes/tables.ts` — add:
  - `POST /api/v1/tables/:tableId/watch` (auth) → registers
    spectator in the realtime hub. No persistence.
  - `DELETE /api/v1/tables/:tableId/watch` (auth) → unregister.
  - `POST /api/v1/tables/:tableId/seats` (auth) →
    `{ seatIndex, buyIn }`. Allowed only when status is
    `preparing` or `paused`. Creates a `HumanAgent`, calls
    `orchestrator.addAgent` with `ownerUserId = req.user.userId`,
    `adapterType = 'human'`.
  - `DELETE /api/v1/tables/:tableId/seats/me` (auth) → if hand in
    progress, set `sitOutNextHand = true`; else free immediately.
  - `POST /api/v1/tables/:tableId/seats/agent` (auth) →
    `{ seatIndex, buyIn, agentConfigId }`. Resolves the user's
    `UserAgentConfig`, builds an `HttpAgentAdapter`, sits it.

**Acceptance:**
- A user can spectate, sit, leave at the right times.
- A user cannot sit at someone else's seat or sit twice.
- A user cannot sit during `in_hand`.
- Sitting an agent that does not belong to the caller is 403.

**Verify:**
```
pnpm --filter api run test -- seats.test
```

---

### M10 — User agent config CRUD

**Touch:**
- `apps/api/src/routes/me-agents.ts` (NEW) — full CRUD per the
  API doc. `authHeaderValue` is write-only: GET responses replace
  it with `null` and return a `hasAuthHeader: boolean` flag
  instead.

**Acceptance:**
- A user only sees their own configs.
- `endpointUrl` must be `https://` in production (allow `http://`
  for `localhost` and `127.0.0.1` to make local dev practical).
- Auth header value is never returned.

**Verify:**
```
pnpm --filter api run test -- me-agents.test
```

---

### M11 — End-to-end integration test

**New code:**
- `apps/api/src/__tests__/e2e.test.ts` — drives the full demo
  flow from §12 of the spec against an ephemeral SQLite file:
  register two users, create table, sit both, sit an agent
  pointing at a stub Fastify server, run a hand via WS, assert
  events.

**Acceptance:**
- One single test executes the demo flow without any UI,
  catching regressions across auth + orchestrator + WS + agent.

**Verify:**
```
pnpm --filter api run test -- e2e.test
```

---

### M12 — Frontend scaffold

**New app:** `apps/web/`
- `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`.
- `src/lib/api.ts` — `fetch` wrapper that always sends
  `credentials: 'include'` and `X-Requested-With: fetch`.
- `src/lib/ws.ts` — auto-reconnecting WS client.
- `src/auth/AuthContext.tsx` — pulls `/auth/me` on mount.
- `src/router.tsx` — public vs. protected routes, redirect to
  `/login?next=...` on 401.

**Acceptance:**
- `pnpm --filter web run dev` opens a working app.
- Hitting `/lobby` while logged out redirects to `/login`.

**Verify:**
```
pnpm --filter web run build
pnpm --filter web run dev   # manual smoke
```

---

### M13 — Auth pages

- `/register`, `/login` forms, error display, redirect on success
  honouring `?next=`.

**Acceptance:** can register, log in, log out from the UI.
**Verify:** manual smoke + a Playwright happy-path test (M16).

---

### M14 — Lobby page

- `/lobby` lists tables (poll-on-load + WS updates), shows
  status, blinds, seated count, button to create a table.

**Acceptance:** new tables appear on a second tab without reload.
**Verify:** manual smoke; covered by M16 e2e.

---

### M15 — Table page

- `/tables/:tableId` shows seats, public state, action log.
- Sit-here button (for empty seats, `preparing | paused`).
- Sit-with-agent dropdown (lists user's agents).
- Action panel when it's the user's turn.
- Hole cards visible only for the user's own seat.

**Acceptance:** end-to-end demo flow from spec §12 works through
the UI.

---

### M16 — Playwright e2e for the demo flow

- One test: register two users in two browser contexts, sit both,
  sit an agent (against a stub HTTP server started by the test),
  drive a hand, assert visibility rules in the DOM.

**Verify:**
```
pnpm --filter web run e2e
```

---

### M17 — Agent management pages

- `/agents`, `/agents/new`, `/agents/:agentId/edit`. Form with the
  config fields. Auth-header value field is write-only — when
  editing, the existing value is not pre-filled and the UI shows
  "leave blank to keep current".

---

### M18 — Hardening pass

- Rate-limit `/auth/login` (e.g. 10 / minute / IP) with
  `@fastify/rate-limit`.
- Add a `/health` endpoint.
- Audit every route for ownership checks (search for
  `requireAuth` usage; assert ownership in seat / agent routes).
- Audit WS filter: a unit test that records every frame sent to
  a spectator and asserts none contain non-spectator hole cards.

---

## 4. Estimate

| Milestone | Rough effort |
|---|---|
| M0 pre-flight | 0.5 d |
| M1 SQLite | 1.5 d |
| M2 auth pkg | 1 d |
| M3 auth routes | 0.5 d |
| M4 ownership | 1 d |
| M5 HumanAgent + action | 1.5 d |
| M6 HttpAgentAdapter | 1 d |
| M7 realtime hub + WS | 2 d |
| M8 lobby | 0.5 d |
| M9 seat / spectator | 1 d |
| M10 agent CRUD | 0.5 d |
| M11 e2e backend | 1 d |
| M12 fe scaffold | 0.5 d |
| M13 auth pages | 0.5 d |
| M14 lobby page | 0.5 d |
| M15 table page | 2 d |
| M16 playwright e2e | 1 d |
| M17 agent pages | 0.5 d |
| M18 hardening | 1 d |
| **Total** | **~17.5 d** |

---

## 5. Cross-cutting decisions

- **Single process**: no Redis, no message queue. The `RealtimeHub`
  is in-process; that's fine because the orchestrator's hand state
  is also in-process. Horizontal scaling is Phase 3.
- **Database file location**: read from env `DATABASE_PATH`,
  default `./data/app.db`. Migrations are applied at boot from a
  single SQL file (no migration tool needed for one schema).
- **Logging**: keep Fastify logger off in tests, on (`level: info`)
  in `dev` and `start`. Never log password or auth header values.
- **Secrets**: argon2 / bcrypt parameters, session lifetime,
  cookie name in a single `packages/auth/src/config.ts` constants
  file.
- **`exactOptionalPropertyTypes` is enabled** repo-wide
  (`tsconfig.base.json:13`). Any new optional field handling must
  match the existing `... ? { x } : {}` pattern (see
  `apps/api/src/routes/tables.ts:40`).

---

## 6. What we are explicitly **not** changing

- The pure poker engine (`packages/poker-engine`). Untouched.
- The `MockAgent` strategies and the `TimeoutHandler` semantics.
  We only add new `IAgent` implementations.
- The `HandSummary` / `ReplayEvent` shape. The wire is stable.
- The Phase 1 in-memory + JSONL stores. They remain available
  and are still used by `examples/local-simulation`.
