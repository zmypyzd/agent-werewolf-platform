# Phase 2 — HTTP & WebSocket API

Pair this with `phase-2-web-platform-spec.md` (product) and
`phase-2-web-platform-implementation-plan.md` (sequencing).

Conventions:

- Base path: `/api/v1` (matches Phase 1).
- All bodies are JSON (`Content-Type: application/json`).
- All success responses follow `{ "data": <T> }`. All errors follow
  the existing `{ "error": { code, message, statusCode } }` shape
  produced by the Fastify error handler in
  `apps/api/src/server.ts:19`.
- Auth is by HttpOnly cookie `apk_sid`. State-changing verbs
  (`POST` / `PATCH` / `DELETE`) additionally require the
  `X-Requested-With: fetch` header (CSRF defense — see spec §9).
- All Zod schemas live in `packages/agent-protocol/src/schemas.ts`
  and are exported alongside the inferred types. Names below are
  the schemas to add or reuse.

## 0. Status codes

| Code | When |
|---|---|
| 200 | success |
| 201 | resource created |
| 204 | success, no body |
| 400 | `SCHEMA_VALIDATION_FAILED`, `INVALID_ACTION`, `INVALID_CONFIG`, `NOT_ENOUGH_PLAYERS` |
| 401 | unauthenticated |
| 403 | authenticated but not authorized |
| 404 | `*_NOT_FOUND` |
| 409 | `TABLE_FULL`, `HAND_IN_PROGRESS`, `EMAIL_TAKEN`, `SEAT_TAKEN` |
| 429 | rate limit (only `/auth/login`) |
| 500 | `INTERNAL_ERROR` |
| 501 | `NOT_IMPLEMENTED` |

The error code list extends the existing map at
`apps/api/src/server.ts:21-34` with `EMAIL_TAKEN` (409),
`SEAT_TAKEN` (409), `UNAUTHENTICATED` (401), `FORBIDDEN` (403).

---

## 1. Auth

### `POST /api/v1/auth/register` — public

Body (`RegisterRequestSchema`):
```json
{
  "email": "alice@example.test",
  "password": "at-least-8-chars",
  "displayName": "alice"
}
```
Rules: email lowercased + trimmed; uniqueness enforced; password
length ≥ 8 (Zod min(8)); `displayName` 1..40 chars.

Response 201:
```json
{ "data": { "user": { "userId": "...", "email": "...", "displayName": "..." } } }
```
Sets the session cookie. Errors: 409 `EMAIL_TAKEN`, 400
`SCHEMA_VALIDATION_FAILED`.

### `POST /api/v1/auth/login` — public, rate-limited

Body (`LoginRequestSchema`):
```json
{ "email": "alice@example.test", "password": "..." }
```
Response 200: same shape as register. Errors: 401
`UNAUTHENTICATED` (credentials wrong — uniform message, do not
reveal whether the email exists), 429 if rate limit exceeded.

### `POST /api/v1/auth/logout` — auth required

Body: empty. Response 204. Deletes server-side session and clears
cookie. Idempotent.

### `GET /api/v1/auth/me` — auth required

Response 200:
```json
{ "data": { "user": { "userId": "...", "email": "...", "displayName": "..." } } }
```
401 if unauthenticated.

---

## 2. Lobby

### `GET /api/v1/tables` — auth required

Response 200:
```json
{
  "data": [
    {
      "tableId": "tbl-...",
      "tableName": "...",
      "status": "preparing" | "in_hand" | "paused" | "completed",
      "seatedCount": 2,
      "maxSeats": 6,
      "spectatorCount": 4,
      "blinds": { "smallBlind": 25, "bigBlind": 50, "ante": 0 },
      "canSit": true,
      "currentHandId": "hand-005-..." | null
    }
  ]
}
```
The `canSit` flag is `status === 'preparing' || status === 'paused'`
and there is at least one empty seat.

### `POST /api/v1/tables` — auth required

Body: existing `CreateTableRequestSchema` from
`packages/agent-protocol/src/schemas.ts:180`. **Add** an optional
`maxSpectators` field (default 100). Response 201 with the full
`TableState`. The creator becomes `ownerUserId`. Broadcasts
`lobby.table_created`.

### `GET /api/v1/tables/:tableId` — auth required

Response 200 with the full `TableState` (post-Phase-2 shape — see
spec §4.2). Hole cards are always absent. Agent
`UserAgentConfig` references inside seats list only the
`agentName` and `agentConfigId`, never the auth header value.

---

## 3. Spectating

### `POST /api/v1/tables/:tableId/watch` — auth required

Body: empty. Response 204. Registers the user as a spectator (the
WS will need to be subscribed to `table:<tableId>` separately).
This endpoint exists so the server can enforce `maxSpectators` and
reject excess viewers with 409 `TABLE_FULL`. Idempotent for the
same user.

### `DELETE /api/v1/tables/:tableId/watch` — auth required

Body: empty. Response 204. Unregisters spectator. Idempotent.

---

## 4. Human player seats

### `POST /api/v1/tables/:tableId/seats` — auth required

Body (new `SitAsHumanRequestSchema`):
```json
{ "seatIndex": 2, "buyIn": 1000 }
```

Pre-conditions enforced server-side:
- Table status is `preparing` or `paused`.
- `seatIndex` is empty.
- User is not already seated at this table.
- `buyIn` is in the table's allowed range (Phase 2 MVP: positive
  integer, no upper bound).

Response 201 with `SeatInfo`. Errors: 409 `SEAT_TAKEN`, 409
`HAND_IN_PROGRESS`, 403 `FORBIDDEN` (already seated elsewhere on
this table).

Broadcasts `table.player_seated` and `lobby.table_updated`.

### `DELETE /api/v1/tables/:tableId/seats/me` — auth required

Body: empty. Behaviour:
- If the table is `preparing` or `paused`: seat is freed
  immediately. Response 204.
- If the table is `in_hand` and the user is in the current hand:
  marks `sitOutNextHand = true` and returns 200 with
  `{ data: { sitOutNextHand: true } }`. The seat is freed at
  `hand.completed`.

Broadcasts `table.player_left` (and `lobby.table_updated`) at the
moment the seat is actually freed.

### `POST /api/v1/tables/:tableId/actions` — auth required

Body (new `SubmitActionRequestSchema`):
```json
{ "handId": "hand-005-...", "actionType": "raise", "amount": 150 }
```

Pre-conditions:
- The user holds a seat at this table whose `adapterType === 'human'`.
- It is currently the user's turn for the named hand (must equal
  the open `requestId`'s hand).
- The action validates against the open `legalActions` for the
  user's seat.

Server pipeline (mirrors `hand-runner.ts:399-430`):
1. Schema validation.
2. The orchestrator looks up the user's `HumanAgent`. If no
   pending request: 409 `INVALID_ACTION` (`no_pending_request`).
3. Legality / amount-bounds check against the open `legalActions`.
   Failure: 400 `INVALID_ACTION`.
4. `humanAgent.submit(action)` resolves the pending decision.

Response 202: `{ "data": { "accepted": true } }`. The actual
`action.applied` event arrives over WebSocket.

---

## 5. User agent configs

### `GET /api/v1/me/agents` — auth required

Response 200:
```json
{
  "data": [
    {
      "agentConfigId": "...",
      "agentName": "...",
      "endpointUrl": "https://...",
      "authHeaderName": "Authorization" | null,
      "hasAuthHeader": true,
      "timeoutMs": 5000,
      "description": "...",
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```
`authHeaderValue` is **never** returned. `hasAuthHeader` is `true`
iff a value is stored.

### `POST /api/v1/me/agents` — auth required

Body (new `CreateUserAgentConfigRequestSchema`):
```json
{
  "agentName": "...",
  "endpointUrl": "https://...",
  "authHeaderName": "Authorization" | null,
  "authHeaderValue": "Bearer ..." | null,
  "timeoutMs": 5000,
  "description": "..."
}
```
Validations: `endpointUrl` is a valid URL; `https://` required
unless host is `localhost` or `127.0.0.1`; `timeoutMs` 100..30000;
`agentName` 1..40 chars; `description` 0..500 chars.

Response 201 with the GET-shape config (no auth header value).

### `GET /api/v1/me/agents/:agentId` — auth required

Response 200 with the GET-shape config. 404 if not owned by the
caller (do not leak existence by returning 403).

### `PATCH /api/v1/me/agents/:agentId` — auth required

Body: any subset of the create body. Empty `authHeaderValue` =
remove (set to null); omitted = leave unchanged.

Response 200 with the updated GET-shape config.

### `DELETE /api/v1/me/agents/:agentId` — auth required

Response 204. Cannot delete an agent currently sat at any table —
returns 409 `AGENT_IN_USE`.

### `POST /api/v1/tables/:tableId/seats/agent` — auth required

Body (new `SitAsAgentRequestSchema`):
```json
{ "seatIndex": 2, "buyIn": 1000, "agentConfigId": "..." }
```

Pre-conditions:
- Same as `seats` for human (status, seat empty, etc.).
- The named `agentConfigId` belongs to the caller. Otherwise 404.

The server constructs an `HttpAgentAdapter` from the stored config
and sits it via `orchestrator.addAgent` with `ownerUserId`,
`adapterType = 'http'`, `agentConfigId`.

Response 201 with `SeatInfo`.

---

## 6. Hand data (read-only)

These reuse the Phase 1 endpoints in
`apps/api/src/routes/tables.ts:142-162`, with auth added:

- `GET /api/v1/tables/:tableId/state` — auth required. In Phase 2
  returns a `PublicGameState | null` (filtered) — no hole cards.
  This is meant for "reload the page mid-hand" recovery.
- `GET /api/v1/tables/:tableId/hands` — auth required. List of
  `HandSummary` for the table. Hole cards present only on
  showdown hands (existing behaviour).
- `GET /api/v1/tables/:tableId/hands/:handId` — auth required.
- `GET /api/v1/tables/:tableId/hands/:handId/replay` — auth
  required. Returns ordered `ReplayEvent[]`.

For Phase 2, history endpoints are open to any authenticated user
(no per-table ACL beyond auth). If we want history to be private
to participants, that is a follow-up — note in the test plan.

---

## 7. WebSocket

### Endpoint

`GET /ws` over the same host/port as the API. Auth is the same
session cookie. Unauthenticated upgrade requests are rejected with
HTTP 401 before the handshake completes.

### Message envelope

Server → client and client → server share the envelope:
```ts
type WsMessage = {
  topic: 'lobby' | `table:${string}` | `seat:${string}:${string}`;
  type: string;
  payload: unknown;
};
```
Validate with Zod (`WsClientMessageSchema`,
`WsServerMessageSchema`) — drop unknown messages, log nothing
sensitive.

### Client → server

| type | topic | payload |
|---|---|---|
| `subscribe` | `lobby` | `{}` |
| `subscribe` | `table:<id>` | `{}` |
| `unsubscribe` | any | `{}` |
| `ping` | — | `{}` (server replies `pong`) |

The `seat:<userId>:<tableId>` topic is not user-subscribable; the
server auto-subscribes the connection's user when the user holds a
seat at that table.

### Server → client

| topic | type | payload (key fields) |
|---|---|---|
| `lobby` | `lobby.table_created` | `TableSummary` |
| `lobby` | `lobby.table_updated` | `TableSummary` |
| `table:<id>` | `table.viewer_joined` | `{ userId, displayName }` |
| `table:<id>` | `table.viewer_left` | `{ userId }` |
| `table:<id>` | `table.player_seated` | `{ seat: SeatInfo }` |
| `table:<id>` | `table.player_left` | `{ seatIndex, userId, reason }` |
| `table:<id>` | `hand.started` | `ReplayEvent['data']` (already emitted in `hand-runner.ts:34-44`) |
| `table:<id>` | `hand.updated` | `{ phase, currentActorIndex, currentRoundMinBet, minRaiseAmount }` (sent on every action so spectators can render) |
| `table:<id>` | `community_cards.dealt` | `{ phase, cards }` |
| `table:<id>` | `action.requested` | `{ playerId, seatIndex, legalActions, deadlineAt }` (no private state — that goes to `seat:`) |
| `table:<id>` | `action.received` | `{ playerId, actionType, amount, wasTimeout, wasInvalid }` |
| `table:<id>` | `action.applied` | full applied action excluding any private fields |
| `table:<id>` | `showdown.started` | `{ players: [{ playerId, seatIndex }] }` (no `holeCards` — they are revealed via `pot.awarded` results) |
| `table:<id>` | `pot.awarded` | as in `hand-runner.ts:90-97` |
| `table:<id>` | `hand.completed` | `{ handId, handNumber, durationMs, results, finalStacks }` |
| `table:<id>` | `agent.timeout` | `{ agentId, requestId, elapsedMs }` |
| `table:<id>` | `agent.invalid_action` | `{ agentId, requestId, received, reason, fallbackAction }` |
| `seat:<userId>:<tableId>` | `seat.hole_cards` | `{ handId, holeCards }` (only at deal time) |
| `seat:<userId>:<tableId>` | `seat.action_requested` | `{ handId, requestId, legalActions, deadlineAt, privateState }` |
| `seat:<userId>:<tableId>` | `seat.action_resolved` | `{ requestId, outcome: 'submitted' | 'timeout' | 'invalid' }` |

Notes on the table topic vs. the seat topic:

- `action.requested` on `table:<id>` is the **public** signal "it's
  player X's turn". It contains no private cards. Any spectator
  may receive it.
- `seat.action_requested` on `seat:<userId>:<tableId>` is the
  **private** signal that includes the user's hole cards and the
  `requestId` they need to echo when calling
  `POST /tables/:tableId/actions`. Only the seated user receives
  it.

The realtime hub filter (`packages/realtime/src/filter.ts`) is
the single place where any `holeCards`-bearing payload is split
into a public form (cards stripped) and a private form (cards
kept) before fan-out.

---

## 8. Schema additions to `packages/agent-protocol`

Add to `packages/agent-protocol/src/schemas.ts`:

```ts
// Auth
export const RegisterRequestSchema = z.object({
  email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(40),
});
export const LoginRequestSchema = z.object({
  email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});
export const PublicUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
});

// Seats
export const SitAsHumanRequestSchema = z.object({
  seatIndex: z.number().int().min(0).max(8),
  buyIn: z.number().int().positive(),
});
export const SitAsAgentRequestSchema = SitAsHumanRequestSchema.extend({
  agentConfigId: z.string(),
});
export const SubmitActionRequestSchema = z.object({
  handId: z.string(),
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
});

// Agent configs
export const UserAgentConfigPublicSchema = z.object({
  agentConfigId: z.string(),
  agentName: z.string(),
  endpointUrl: z.string(),
  authHeaderName: z.string().nullable(),
  hasAuthHeader: z.boolean(),
  timeoutMs: z.number().int(),
  description: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const CreateUserAgentConfigRequestSchema = z.object({
  agentName: z.string().min(1).max(40),
  endpointUrl: z.string().url(),
  authHeaderName: z.string().min(1).max(80).nullable(),
  authHeaderValue: z.string().min(1).max(2048).nullable(),
  timeoutMs: z.number().int().min(100).max(30000),
  description: z.string().max(500).nullable(),
});
export const PatchUserAgentConfigRequestSchema =
  CreateUserAgentConfigRequestSchema.partial();

// Lobby
export const TableSummarySchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  status: z.enum(['preparing','in_hand','paused','completed']),
  seatedCount: z.number().int().nonnegative(),
  maxSeats: z.number().int().min(2).max(9),
  spectatorCount: z.number().int().nonnegative(),
  blinds: BlindConfigSchema,
  canSit: z.boolean(),
  currentHandId: z.string().nullable(),
});

// WebSocket envelopes
export const WsClientMessageSchema = z.object({
  topic: z.string(),
  type: z.enum(['subscribe','unsubscribe','ping']),
  payload: z.record(z.unknown()).default({}),
});
export const WsServerMessageSchema = z.object({
  topic: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
});
```

`exactOptionalPropertyTypes` is enabled — when the API constructs
`SeatInfo` payloads, optional fields must be **omitted** rather
than set to `undefined` (see existing pattern at
`apps/api/src/routes/tables.ts:40`).

---

## 9. Auth requirements per endpoint (summary)

| Endpoint | Auth | CSRF header | Notes |
|---|---|---|---|
| `POST /auth/register` | no | yes | rate-limit recommended |
| `POST /auth/login` | no | yes | rate-limit |
| `POST /auth/logout` | yes | yes | |
| `GET /auth/me` | yes | no | |
| `GET /tables` | yes | no | |
| `POST /tables` | yes | yes | stamps `ownerUserId` |
| `GET /tables/:id` | yes | no | |
| `POST /tables/:id/watch` | yes | yes | |
| `DELETE /tables/:id/watch` | yes | yes | |
| `POST /tables/:id/seats` | yes | yes | |
| `DELETE /tables/:id/seats/me` | yes | yes | |
| `POST /tables/:id/actions` | yes | yes | |
| `POST /tables/:id/seats/agent` | yes | yes | |
| `GET /me/agents` | yes | no | |
| `POST /me/agents` | yes | yes | |
| `GET /me/agents/:id` | yes | no | |
| `PATCH /me/agents/:id` | yes | yes | |
| `DELETE /me/agents/:id` | yes | yes | |
| `GET /tables/:id/state` | yes | no | |
| `GET /tables/:id/hands` | yes | no | |
| `GET /tables/:id/hands/:handId` | yes | no | |
| `GET /tables/:id/hands/:handId/replay` | yes | no | |
| `WS /ws` | yes (cookie) | n/a | |

---

## 10. Backwards compatibility with Phase 1

The existing endpoints in `apps/api/src/routes/tables.ts` and
`routes/simulate.ts` continue to exist for
`examples/local-simulation` and the `pnpm demo` script. We:

- Keep `POST /tables`, `GET /tables`, `GET /tables/:id`,
  `POST /tables/:id/agents`, `POST /tables/:id/hands/start`,
  `POST /simulate` working but require auth.
- Migrate the Phase 1 integration test in
  `apps/api/src/__tests__/api.integration.test.ts` to log in first.
- The `addAgent` flow with `adapterType: 'mock'` becomes admin/dev
  only — guard by an `ALLOW_MOCK_AGENTS=1` env in non-test
  environments. Phase 2 production should not surface mock agents
  to the UI; they remain a developer convenience.
