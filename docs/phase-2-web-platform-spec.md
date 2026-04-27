# Phase 2 — Web Platform Spec

Status: design / not yet implemented
Owner: tech lead
Last updated: 2026-04-26

---

## 1. Goal

Turn the Phase 1 MVP (engine + orchestrator + Fastify API + MockAgents)
into a multi-user web platform where:

- Real users register / log in.
- Users browse a lobby of multiple poker tables.
- Users sit at a table as a human player, or sit one of their own
  registered HTTP Agents.
- Spectators and players see a real-time view of the table that
  respects card-visibility rules.
- The system supports external Agents over HTTP, with strict
  schema validation and timeout-based fallback.

**Non-goals (explicitly out of scope for Phase 2):**

- Real money, payments, on-ramps, deposits, withdrawals, rake.
- Gambling, odds publishing, betting against the house.
- OAuth / SSO / third-party identity.
- Executing user-uploaded code on our servers (all Agents are
  external HTTP/WS endpoints owned by users).
- Mobile native apps.
- Tournaments, multi-table tournaments, sit-and-go.

---

## 2. What we already have (Phase 1 baseline)

Verified by reading the repo. These are reusable as-is or with
small extensions:

| Module | Path | Phase 2 reuse |
|---|---|---|
| Domain types & errors | `packages/shared/src/types.ts`, `errors.ts` | Reuse, extend `TableState.status` enum |
| Zod schemas | `packages/agent-protocol/src/schemas.ts` | Reuse, add new schemas |
| Pure poker rules (deck, hand eval, betting, pots, showdown) | `packages/poker-engine/src/*` | Reuse unchanged |
| Agent interface, MockAgents, TimeoutHandler | `packages/agent-runtime/src/*` | Reuse; **implement** `HttpAgentAdapter`; **add** `HumanAgent` |
| Persistence interfaces (`ITableStore`, `IHandStore`) | `packages/persistence/src/store-interface.ts` | Reuse interfaces; **add** SQLite implementation; **add** new stores (User, Session, UserAgentConfig) |
| `TableOrchestrator` | `packages/table-orchestrator/src/orchestrator.ts` | Extend with seat-as-human / seat-as-agent / leave / action-submit / spectator |
| `HandRunner` | `packages/table-orchestrator/src/hand-runner.ts` | Reuse — already emits `ReplayEvent` via `EventEmitter`; wire that emitter into the WS hub |
| Fastify API | `apps/api/src/server.ts`, `routes/tables.ts`, `routes/simulate.ts` | Extend with auth, lobby, seats, agent CRUD, WS |

What does **not** exist and must be built:

- User accounts, password hashing, session, auth middleware.
- HTTP Agent adapter is a stub (`http-agent-adapter.ts` throws
  `NotImplementedError`).
- WebSocket layer.
- A `HumanAgent` that lets a logged-in user act on their seat.
- Frontend.
- Persistent storage for users, sessions, agent configs, tables, hands.

---

## 3. User stories

1. **Register / login.** A new user signs up with email + password,
   logs in, and lands in the lobby. Session survives a page reload.
2. **Browse lobby.** A logged-in user sees a list of tables with
   current state (status, players seated, blinds, current hand id).
3. **Spectate.** A user opens a table they haven't sat at; they see
   public state in real time. They never see anyone's hole cards.
4. **Sit as human.** While a table is `preparing`, a user clicks
   "sit here" on an empty seat, picks a buy-in, and becomes a
   human player.
5. **Act in turn.** When it's the human's turn, the UI shows legal
   actions (fold/check/call/bet/raise/all-in) computed by the
   server. The user submits one. The server re-validates legality.
6. **Timeout.** If the human doesn't act within
   `defaultTimeoutMs`, the server applies the default action (check
   if legal, else fold).
7. **Leave seat.** A user can mark "sit out next hand" mid-hand,
   or leave immediately if the hand is over.
8. **Manage agents.** A user creates / edits / deletes their HTTP
   Agent configs (`agentName`, `endpointUrl`, optional auth header,
   `timeoutMs`, `description`).
9. **Sit own agent.** While a table is `preparing`, a user picks
   one of their own agents and sits it. The server calls that
   user's HTTP endpoint when it's the agent's turn.
10. **Replay.** After a hand completes, anyone with table access
    can read the hand summary and replay events.

---

## 4. Domain model — additions and changes

### 4.1 New entities

```text
User
  userId            string (uuid)
  email             string (unique, lowercased)
  passwordHash      string (argon2id)
  displayName       string
  createdAt         number
  updatedAt         number

Session
  sessionId         string (uuid, opaque)
  userId            string
  createdAt         number
  expiresAt         number
  lastSeenAt        number

UserAgentConfig
  agentConfigId     string (uuid)
  userId            string (owner)
  agentName         string
  endpointUrl       string (https URL)
  authHeaderName    string | null   (e.g. "Authorization")
  authHeaderValue   string | null   (stored as-is; treated as a secret, never returned in GET responses)
  timeoutMs         number          (1..30000)
  description       string | null
  createdAt         number
  updatedAt         number

Spectator (transient, in-memory)
  tableId           string
  userId            string
  joinedAt          number
```

### 4.2 Changes to existing entities

`TableState.status` (`packages/shared/src/types.ts`) currently enums to
`'waiting' | 'playing'`. Phase 2 needs four product-level statuses.
**Decision:** extend the union to:

```text
'preparing' | 'in_hand' | 'paused' | 'completed'
```

Mapping from Phase 1 internals:
- `waiting` → `preparing` when the table has empty seats and no hand
  has started yet, otherwise `paused` when a hand just ended and
  another can start.
- `playing` → `in_hand`.
- `completed` is set when an admin / cleanup process closes the table
  (no more hands will be played).

`SeatInfo` adds optional ownership and adapter-type metadata so the
orchestrator and the API know how to drive that seat:

```text
SeatInfo (extended)
  seatIndex         number
  agentId           string                       // already exists
  playerId          string                       // already exists
  stack             number                       // already exists
  status            'waiting' | 'sitting-out' | 'active' | ...   // already exists
  ownerUserId       string                       // NEW: who owns this seat (always required in Phase 2)
  adapterType       'human' | 'http' | 'mock'    // NEW
  agentConfigId     string | null                // NEW: only when adapterType === 'http'
  sitOutNextHand    boolean                      // NEW
  joinedAt          number                       // NEW
```

`Table` gains:

```text
allowQueue        boolean (default false; Phase 2 ships with no waitlist — see §10)
maxSpectators     number (default 100)
ownerUserId       string | null  (creator)
```

### 4.3 Persistence boundaries

| Entity | Persisted from day one | Rationale |
|---|---|---|
| User | yes | identity is required |
| Session | yes | survive restart |
| UserAgentConfig | yes | user-owned data |
| Table | yes | survive restart, but in-memory state is the source of truth while a table is hot |
| Seat (as part of Table) | yes | same |
| Hand summary | yes | already done in Phase 1 (file store) |
| ReplayEvent | yes | already done in Phase 1 |
| Spectator list | no (in-memory only) | ephemeral; reconstructed on reconnect |
| `currentGameState` (in-flight hand) | no (in-memory only) | recovered by replaying the hand from `ReplayEvent`s if we ever need to; Phase 2 MVP does not persist mid-hand state |

**Decision:** introduce one SQLite database for all of the above
(except in-flight game state and spectator list). SQLite is the
smallest credible jump from "in-memory + JSONL" that gives us
transactions, indexes, and survives restart in a single file. The
existing `ITableStore` / `IHandStore` interfaces stay; we add a
SQLite implementation behind them and add new stores
(`IUserStore`, `ISessionStore`, `IUserAgentConfigStore`).

---

## 5. Visibility rules (security-critical)

A single rule decides what each connected client may receive:

```text
Spectator (no seat at this table)
  ALLOWED: PublicGameState, public ReplayEvents, hand summaries (with hole cards
           ONLY if they belong to a player who reached showdown — same as
           current HandSummary semantics)
  DENIED:  hole cards of any player who folded before showdown,
           any in-flight private state of any player

HumanPlayer (seat owner === this user, adapterType === 'human')
  ALLOWED: PublicGameState + their own PrivatePlayerState (their hole cards),
           their own legal-actions list when it is their turn

OtherPlayer (seated at this table but not this seat)
  ALLOWED: PublicGameState only

ExternalHttpAgent (owned by some user, sat by that user)
  ALLOWED: AgentDecisionRequest containing PublicGameState + the agent's own
           PrivatePlayerState + legalActions
  DENIED:  any other player's hole cards
  Out-of-band: the agent's HTTP endpoint is called only when it is its turn;
               the request is never broadcast to other connections.
```

The implementation contract is: **never serialize a `PlayerInHand`'s
`holeCards` to anyone except (a) that player, in their own client,
or (b) the post-hand `HandSummary` for hands that reached showdown.**
This invariant lives in the WebSocket fan-out filter
(see implementation plan §3 / `packages/realtime`).

---

## 6. State machines

### 6.1 Table

```
preparing ──(startHand: ≥2 seated, all ready)──▶ in_hand
in_hand   ──(hand completes, seats remain ≥2)──▶ paused
in_hand   ──(hand completes, seats <2)─────────▶ preparing
paused    ──(startHand)────────────────────────▶ in_hand
paused    ──(idle timeout, optional)───────────▶ preparing
any       ──(owner closes)─────────────────────▶ completed
```

Phase 2 MVP: the orchestrator advances `preparing → in_hand →
paused` automatically. `paused → in_hand` is triggered by either
(a) a human "ready" tick if all seated humans clicked ready, or
(b) a fixed delay (e.g. 5s) so practice tables don't wait on user
input. We start with (b); ready-up is a follow-up.

### 6.2 Seat

```
empty ──(sit-as-human)────▶ seated(human, waiting)
empty ──(sit-as-agent)────▶ seated(http,  waiting)
seated ──(hand starts)────▶ active (during hand) | folded | all-in
seated ──(sit-out toggle)─▶ seated(sitOutNextHand=true)
seated ──(leave, hand done)──▶ empty
```

A user **cannot** leave a seat mid-hand. The UI offers
"sit out next hand"; the seat is freed at the end of the
current hand.

### 6.3 Hand (already implemented in `HandRunner`)

`preflop → flop → turn → river → showdown → complete`. Unchanged.

---

## 7. Real-time events

We use one WebSocket connection per browser tab, multiplexed over
topics: `lobby`, `table:<tableId>`, `seat:<userId>:<tableId>`.
The server pushes a tagged envelope:

```ts
type WsEvent =
  | { topic: 'lobby';   type: 'lobby.table_created';   payload: TableSummary }
  | { topic: 'lobby';   type: 'lobby.table_updated';   payload: TableSummary }
  | { topic: 'table';   type: 'table.viewer_joined' | 'table.viewer_left'
                      | 'table.player_seated' | 'table.player_left'
                      | 'hand.started' | 'hand.updated'
                      | 'community_cards.dealt' | 'showdown.started'
                      | 'pot.awarded' | 'hand.completed'
                      | 'agent.timeout' | 'agent.invalid_action'
                      | 'action.received' | 'action.applied';
                      tableId: string; payload: unknown }
  | { topic: 'seat';    type: 'action.requested';
                      tableId: string; userId: string;
                      payload: { handId: string; legalActions: LegalAction[]; deadlineAt: number; privateState: PrivatePlayerState } };
```

`action.requested` on `seat:*` is the only event that contains a
private state. It is delivered to exactly one user's connections.
Everything else is filtered to public state before broadcast.

The underlying source of these events is the `EventEmitter` already
created per hand inside
`packages/table-orchestrator/src/orchestrator.ts:191`. Phase 2
introduces a `RealtimeHub` that subscribes to that emitter and
fans out to WS connections with the per-topic filter.

---

## 8. Action validation pipeline

For both human submissions and external HTTP agent responses, the
server runs the same validation pipeline (already implemented for
agents in `hand-runner.ts:399-430` — extend, don't duplicate):

1. **Schema parse** with `AgentDecisionResponseSchema` (Zod).
   On failure → fallback action, emit `agent.invalid_action`.
2. **Legality check** against `legalActions` from the engine.
   On failure → fallback action, emit `agent.invalid_action`.
3. **Amount bounds check** for `bet` / `raise` (`minAmount`,
   `maxAmount` from `LegalAction`). On failure → fallback.
4. **Apply** via `applyAction` in `poker-engine`.

Fallback rule: `check` if legal, otherwise `fold`. Same as
`hand-runner.ts:432-439`.

For human players, schema parsing is trivial (the REST endpoint
already constructs the response object), but the legality and
amount checks must run identically — never trust the client.

---

## 9. Authentication and session

- Email + password registration. Email is normalized to lowercase
  and stripped of leading/trailing whitespace. Uniqueness enforced
  in the user store.
- Password hashing: **argon2id** (`argon2` npm package; if it can't
  be installed in the target environment, fall back to `bcrypt` ≥
  10 rounds — explicit decision rather than a silent default).
- Login issues an opaque session id and sets it on an HttpOnly
  Secure SameSite=Lax cookie named `apk_sid`. Cookie path `/`.
  Session lifetime: 7 days, sliding (`lastSeenAt` updated on auth
  middleware hits).
- Logout deletes the server-side session row and clears the cookie.
- `GET /auth/me` returns the current user (or 401 if unauthenticated).

CSRF: because we use cookies, all state-changing requests
(`POST` / `PATCH` / `DELETE`) require either a same-origin check
(default `Sec-Fetch-Site: same-origin`, `same-site`, or `none` with
the user-explicit gesture) **plus** a `X-Requested-With: fetch`
header that the frontend always sends and that no naive form post
includes. This is the cheapest CSRF defense compatible with our
stack and acceptable for an internship-scale project. Document the
trade-off; promote to a proper token if the project hardens.

---

## 10. Waitlist (deferred)

The product spec asks for an optional waitlist for users who arrive
mid-hand. Implementing it correctly requires a queue, a fairness
policy, and a "promote to seat at hand boundary" hook. **Phase 2
MVP ships without it.** A user who arrives mid-hand can only
spectate; the UI will show a clear "join is disabled while a hand
is in progress" notice and re-enable the seat-empty buttons on
`hand.completed`. A `waitlist` flag on `Table` is reserved
(`allowQueue: false`) so adding it later is non-breaking.

---

## 11. Frontend

Stack (chosen for minimal surface area):

- Vite + React 18 + TypeScript.
- React Router for routing.
- Native `fetch` and native `WebSocket` (no SWR / Redux / Zustand).
- One `AuthContext` for session, one `RealtimeContext` for the WS.
- Plain CSS modules. No design system. Goal is "usable and
  testable", not pretty.

Pages:

| Path | Auth | Purpose |
|---|---|---|
| `/register` | public | sign up |
| `/login` | public | sign in |
| `/lobby` | required | list tables, create table |
| `/tables/:tableId` | required | spectate, sit, act |
| `/agents` | required | list own HTTP agents |
| `/agents/new` | required | create agent config |
| `/agents/:agentId/edit` | required | edit / delete agent config |

Auth gate: any protected page that loads while unauthenticated
redirects to `/login?next=<original-path>`.

`/tables/:tableId` view rules:
- Always shows public state, current hand id, action log.
- If the user holds a seat at this table: shows that seat's hole
  cards once dealt, and shows an action panel when it is their
  turn (legal actions returned by the server only — disabled
  amount inputs respect `min/max` from `LegalAction`).
- If the table is `preparing` and the user does not hold a seat:
  empty seats render "sit here" buttons (human / one of my
  agents).
- If the table is `in_hand`: seat buttons are disabled with a
  "wait for next hand" tooltip.

---

## 12. Acceptance for the Phase 2 MVP

The MVP is "done" when, in a single browser, the following manual
flow works against a freshly started server with an empty database:

1. Register two users `alice@x.test` / `bob@x.test`.
2. Alice creates a table with default blinds.
3. Bob opens the lobby in a second browser, sees Alice's table,
   and clicks in.
4. Both users sit at empty seats with starting buy-in 1000.
5. Alice creates an HTTP agent config pointing at a local mock
   server, edits its name, and verifies the auth header is not
   echoed back in the GET response.
6. Alice sits her agent at a third seat.
7. The hand starts within 5 seconds; both users see public state
   in real time, Alice and Bob each see only their own hole cards,
   the agent's HTTP endpoint receives a request when it is its
   turn.
8. When it's Bob's turn, his action panel shows legal actions; he
   submits one, the server re-validates, the action is applied.
9. If Bob doesn't act within `defaultTimeoutMs`, the server
   applies check-or-fold and emits `agent.timeout` /
   `action.applied`.
10. The hand completes; both users see the outcome and can hit
    "show replay" to read the `ReplayEvent` log via the existing
    `/api/v1/tables/:tableId/hands/:handId/replay` endpoint.
11. The hand summary endpoint returns hands history for the table.
12. A spectator (a third user, no seat) connecting at any point
    sees public state but never any hole cards, including in
    DOM, network, and WS frames (verified by inspecting the
    browser tools).

That's the bar. Auth, persistence, real-time, human seat,
external HTTP agent, replay — all working end-to-end in one demo.

---

## 13. Out-of-scope reminders

- No tournaments, no rake, no money.
- No OpenClaw integration in core logic. OpenClaw remains a
  documented example of an external agent that can be sat via the
  HTTP adapter just like any other user agent.
- No Kubernetes, no horizontal scaling. Single-process server is
  acceptable for Phase 2 — the in-memory orchestrator state is the
  bottleneck and we ship one process. We do not introduce Redis.
- No CI/CD pipeline beyond `pnpm test`. CI is a Phase 3 concern.
