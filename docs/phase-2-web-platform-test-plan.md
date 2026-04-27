# Phase 2 — Test Plan

Pair this with `phase-2-web-platform-spec.md`,
`phase-2-web-platform-implementation-plan.md`,
`phase-2-web-platform-api.md`.

This plan covers what to test, where the tests live, how to run
them, and what counts as "covered". Phase 1 already runs Vitest
across the workspace (`vitest.workspace.ts`); we extend it.

---

## 1. Test pyramid

```
                  ┌──────────────────────┐
                  │  Playwright e2e       │   1 happy-path scenario,
                  │  apps/web/e2e         │   driven through the UI
                  └─────────┬────────────┘
              ┌─────────────┴───────────────┐
              │  API integration tests       │   per-route Fastify-injected
              │  apps/api/src/__tests__      │   tests + a full backend e2e
              └─────────────┬───────────────┘
                ┌───────────┴────────────┐
                │  Package unit tests     │   per package, Vitest
                │  packages/*/src/__tests__│
                └─────────────────────────┘
```

Coverage targets (statement coverage, reported by Vitest's V8
coverage and gated locally — not a CI gate yet):

| Package | Target |
|---|---|
| `poker-engine` | 95% (already high) |
| `agent-runtime` | 90% (new code: `HumanAgent`, `HttpAgentAdapter`) |
| `auth` (new) | 90% |
| `realtime` (new) | 85% |
| `persistence` | 85% |
| `table-orchestrator` | 85% |
| `apps/api` | route-level integration tests for every endpoint in the API doc |
| `apps/web` | one Playwright e2e + component tests for action panel + auth context |

---

## 2. Unit tests by package

### 2.1 `packages/poker-engine`

Existing tests stay. **No new tests required** — the engine is
unchanged in Phase 2. Verify:
```
pnpm --filter @agent-poker/poker-engine run test
```

### 2.2 `packages/agent-runtime` (new tests)

#### `HumanAgent`
- `requestDecision` returns a pending promise; `submit` resolves
  it with the matching `requestId`.
- `submit` with a mismatched `requestId` rejects with an
  `InvalidActionError`.
- `cancel()` rejects the pending promise; subsequent `submit` is
  a no-op.
- Wrapping in `TimeoutHandler` returns the fallback if `submit`
  is never called (existing fallback semantics — no new code in
  `TimeoutHandler`).

#### `HttpAgentAdapter`
- Happy path: stub HTTP server returns a valid
  `AgentDecisionResponse`; adapter returns parsed object.
- Malformed JSON / missing fields → adapter throws → wrapping
  `TimeoutHandler` returns fallback.
- Non-2xx response → throws.
- Hangs past `timeoutMs` → adapter throws (the `AbortController`
  fires); `TimeoutHandler` returns fallback.
- Auth header is sent when configured; absent header field is not
  sent at all (assert via the stub server's request log).
- Adapter never logs the auth header value in test output (capture
  console writes, assert no leak).

Run:
```
pnpm --filter @agent-poker/agent-runtime run test
```

### 2.3 `packages/persistence`

#### Memory stores (existing)
- Keep current tests.

#### SQLite stores (new)
- Each store: create / read / update / delete round-trip in an
  in-memory SQLite db (`:memory:`).
- `IUserStore.findByEmail` is case-insensitive (the route
  lowercases first; the store also lowercases for safety).
- `email` uniqueness violation surfaces as a typed error the auth
  route can map to `EMAIL_TAKEN`.
- `ISessionStore.find` returns null for an expired session.
- `IUserAgentConfigStore.update` does not mutate `userId` or
  `agentConfigId`.
- `endpointUrl` is stored verbatim; reading back returns the same
  string (no trailing-slash normalisation surprise).

Run:
```
pnpm --filter @agent-poker/persistence run test
```

### 2.4 `packages/auth` (new)

- `hashPassword` + `verifyPassword` round-trip; wrong password
  fails; hash is non-empty.
- Hashing twice with the same input yields different hashes (salt
  works).
- Session lifecycle: create, validate, touch, expire.
- Cookie helper sets `HttpOnly`, `SameSite=Lax`,
  `Secure` (only when `NODE_ENV === 'production'`).
- `assertSameOriginAndFetchHeader` rejects requests missing the
  `X-Requested-With` header on a `POST` (returns the typed CSRF
  error). Allows the same header set on `POST`. Allows any `GET`.

Run:
```
pnpm --filter @agent-poker/auth run test
```

### 2.5 `packages/realtime` (new)

- Hub: subscribe / publish / unsubscribe.
- Filter: `replayEventToPublic(event)` strips `holeCards` from
  any payload that contains them. Property test: random payloads
  with embedded `holeCards` always come out clean.
- Filter: `replayEventToPrivate(event, userId)` keeps only the
  hole cards belonging to `userId`.
- A simulated full hand of `ReplayEvent`s, fanned out through the
  filter to a (a) spectator, (b) seated user A, (c) seated user
  B. Assert: no spectator frame contains any `holeCards` field;
  user A's frames contain only A's hole cards; user B's frames
  contain only B's hole cards.

Run:
```
pnpm --filter @agent-poker/realtime run test
```

### 2.6 `packages/table-orchestrator`

Existing tests stay (after updating signatures to pass
`ownerUserId`). Add:

- Status machine: `preparing → in_hand → paused → in_hand → ...`
  transitions are emitted on the orchestrator's emitter.
- `addAgent` rejects when a user tries to seat an agent they
  don't own (caller passes a foreign `agentConfigId`).
- `submitHumanAction`: routes to the correct `HumanAgent`,
  rejects when no pending request, rejects when called by a
  different user.
- `sit-out next hand`: setting the flag mid-hand frees the seat
  exactly once, at `hand.completed`.
- Mid-hand visibility: a player who folds keeps `holeCards` in
  the engine for showdown calculation but does not appear in any
  emitted public event with their cards (assert by inspecting
  `replayEvents` collected during the run).

Run:
```
pnpm --filter @agent-poker/table-orchestrator run test
```

---

## 3. API integration tests (`apps/api`)

Use `Fastify.inject()` against `buildServer()` for each test
file. Use an ephemeral SQLite db (`:memory:` per test, or a temp
file with `afterEach` cleanup). Phase 1's
`apps/api/src/__tests__/api.integration.test.ts` is the template.

Required test files:

- `auth.test.ts` — register / login / me / logout. Includes
  - duplicate email → 409,
  - bad password → 401 (uniform message),
  - me without cookie → 401,
  - logout twice → 204 both times.
- `csrf.test.ts` — every mutating route returns 403 without
  `X-Requested-With: fetch`.
- `lobby.test.ts` — list/create tables, summaries reflect
  current state.
- `seats.test.ts` —
  - sit during `preparing` succeeds,
  - sit during `in_hand` returns 409 `HAND_IN_PROGRESS`,
  - leaving mid-hand returns 200 with `sitOutNextHand: true`,
  - leaving when seat is empty / not yours → 404 / 403.
- `actions.test.ts` —
  - submit a legal action → 202; subsequent action submission
    on the same `requestId` → 409,
  - illegal `actionType` for the legal-actions list → 400,
  - amount under min → 400,
  - submitting another user's `handId` → 403,
  - timeout: don't submit; assert the WS receives `agent.timeout`
    and the orchestrator advances.
- `me-agents.test.ts` —
  - CRUD round-trip,
  - `authHeaderValue` never returned,
  - non-https endpoint outside localhost → 400,
  - delete an agent that's currently sat → 409 `AGENT_IN_USE`,
  - access another user's agent → 404.
- `ws.test.ts` —
  - connect without cookie → 401 on upgrade,
  - subscribe to lobby, create a table from another connection,
    receive `lobby.table_created`,
  - subscribe to `table:<id>`, sit at a seat, receive
    `table.player_seated`,
  - run a hand with two `HumanAgent`s; record every frame to
    each connection; assert visibility rules.
- `e2e.test.ts` (M11) — the full demo from spec §12.

Run:
```
pnpm --filter api run test
```

---

## 4. Frontend tests (`apps/web`)

### Component tests (Vitest + React Testing Library)

- `AuthContext` correctly reflects `/auth/me` 200 and 401.
- `ActionPanel` renders only the legal actions returned by the
  server. The amount input respects `minAmount` / `maxAmount` and
  cannot submit out-of-range values.
- A spectator view never renders a non-self hole-card element
  (test by inspecting the rendered DOM with property-based fake
  events).

### Playwright e2e (M16)

Single test, two browser contexts (Alice and Bob) plus a Node
fixture stub that serves an HTTP agent. Runs the §12 demo to
completion. Verifies (in the DOM and the network panel via
Playwright's `page.on('websocket')`):
- Bob's hole cards are not present in any WS frame received by
  Alice.
- Alice's hole cards are not present in any WS frame received by
  Bob.
- Spectator (third context, no seat) sees neither.

Run:
```
pnpm --filter web run e2e
```

---

## 5. Property / fuzz tests

Two narrow property suites where they pay off:

- `replayEventToPublic` (in `packages/realtime`): for any randomly
  generated `ReplayEvent` payload (with `holeCards` planted at any
  depth), the filtered output contains no `holeCards` keys.
  Implemented with `fast-check`.
- `computeLegalActions` round-trip: any sequence of legal actions
  applied through `applyAction` keeps stack invariants
  (no negative stacks, total chips conserved). This is a Phase 1
  invariant we should pin for safety even without changing the
  engine.

---

## 6. Manual / smoke checks

Before declaring an MVP, run through:

- Two browsers, two users, full demo flow (spec §12).
- Inspect the network panel: no password, no auth header value
  appears in any response body or WS frame.
- Start the server, restart it, and confirm a registered user
  can still log in (persistence works).
- Kill an HTTP agent process mid-hand; verify the table does not
  crash and the agent receives `agent.timeout` until the next
  action.

---

## 7. Environment / config for tests

- `NODE_ENV=test` for all suites.
- `DATABASE_PATH=:memory:` or a per-test temp file in `os.tmpdir()`.
- `ALLOW_MOCK_AGENTS=1` (lets Phase 1 tests keep adding mock
  agents).
- No external network. Tests that need an HTTP agent endpoint
  spin up a local Fastify on `127.0.0.1:0` and tear it down in
  `afterEach`.

---

## 8. Test-running cheat sheet

| Goal | Command |
|---|---|
| Everything | `pnpm test` |
| One package | `pnpm --filter @agent-poker/<pkg> run test` |
| One file | `pnpm --filter @agent-poker/<pkg> run test -- <pattern>` |
| Watch | `pnpm test:watch` |
| Coverage | `pnpm test:coverage` |
| Backend e2e only | `pnpm --filter api run test -- e2e.test` |
| Web e2e | `pnpm --filter web run e2e` |
| Local simulation (smoke) | `pnpm demo` |
| Type-check the world | `pnpm lint` |

---

## 9. What we are deliberately not testing in Phase 2

- Concurrency at scale (many simultaneous tables, thousands of
  WS connections). Phase 2 ships single-process; load testing is
  Phase 3.
- Browser support beyond the latest Chrome / Safari / Firefox.
- Internationalization. The UI is English-only.
- Accessibility audit beyond keyboard reachability of the action
  panel.
- Disaster recovery (DB corruption, split brain). The single
  SQLite file is backed up by ops out-of-band.
