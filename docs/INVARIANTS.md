# Product Invariants

A flat, machine-checkable list of promises the product makes. Agents and humans use this as the **oracle** for QA: every invariant here can be verified by exercising the product. If it's violated, that's a bug — by definition.

Each invariant has an ID, a one-line statement, a *why* (so future devs know whether it's still load-bearing), and a *how to verify* (so it can be turned into a test or an interactive check). When you add a new feature, add its invariants here **first**. When a bug ships, add the invariant that should have caught it.

> Scope: this is the **contract surface** — what the product promises a user, an agent, or the network. Implementation details belong in code; design rationale belongs in `docs/`; this file is the steady-state guarantee list.

---

## Auth

### INV-A1 — Logout clears every active auth path
After clicking "Log out", **all** session signals must be cleared: cookie session, Supabase JWT in localStorage, and any in-memory React state.

- **Why**: the codebase runs cookie + Supabase auth in parallel (see `apps/web/src/router.tsx:21`). Clearing only one path leaves the user logged in via the other (this exact bug shipped — see PR #50).
- **How to verify**: sign in via the standard flow → open DevTools → click Log out → confirm `localStorage` has no `sb-*` keys, no `apk_sid` cookie, and `useSession()` returns user=null.

### INV-A2 — Protected routes are unreachable when signed out
With no active auth signal, navigating to `/lobby`, `/tables/*`, `/agents`, `/agents/new`, `/agents/:id/edit`, `/simulate` must redirect to `/login?next=<orig>`.

- **Why**: this is the meaningful test of INV-A1. A logout that leaves protected routes accessible is broken regardless of what localStorage says.
- **How to verify**: log out → in the URL bar, type `/agents` → must land on `/login?next=%2Fagents`. Repeat for every protected route.
- **Code**: `apps/web/src/router.tsx:19` (`ProtectedRoute`)

### INV-A3 — `?next=` redirect target is honored after sign-in
Deep-linking flow: visiting a protected URL while signed out lands at `/login?next=<url>`. Successful sign-in must navigate to `<url>`, not the default landing page.

- **Why**: regression risk every time the default landing page changes (see PR #49 temp redirect).
- **How to verify**: while signed out, open `/agents` → redirected to `/login?next=%2Fagents` → sign in → must land on `/agents`, NOT `/werewolf`.

### INV-A4 — Failed sign-in keeps the user on `/login`
Invalid credentials must surface an error message and leave the URL unchanged.

- **How to verify**: enter wrong password → submit → URL still `/login` → error visible.

### INV-A5 — Register flow ends in the same auth state as login
After successful registration, the user must be in the same authenticated state a logged-in user has: protected routes accessible, useSession() truthy, JWT in localStorage.

- **How to verify**: register a new user → navigate to `/agents` → no redirect.

---

## Information isolation (poker)

### INV-P1 — Hole cards never appear in `publicState`
The `AgentDecisionRequest.publicState` shape must not contain hole cards for any player, ever.

- **Why**: the engine and the agent protocol are explicit about this; violating it is a cheating vector.
- **How to verify**: capture any decision request payload from `/api/v1/...` → search payload for `holeCards` outside `privateState` → must be empty.
- **Code**: `packages/agent-protocol/src/schemas.ts:92` (`publicState` vs `privateState`)

### INV-P2 — `privateState` only contains the requesting agent's hole cards
An agent receives only its own hole cards. No other player's cards leak via `privateState`.

- **How to verify**: in a multi-player hand, capture decision requests for two agents → diff their `privateState.holeCards` → must differ; neither must list the other's cards.

### INV-P3 — Public match artifacts redact private fields
`/api/v1/matches/:id`, `/replay`, `/decision-trace`, `/analysis` must not expose any player's hole cards or hole-card events (`hole_cards.dealt`).

- **Why**: spectators and post-match consumers must see the same projection as observers during the match.
- **How to verify**: run any hand → curl `/api/v1/matches/:id/replay` → grep response for `holeCards` → must be empty.
- **Code**: `packages/realtime/src/filter.ts`, `packages/persistence/src/match-artifact-serialization.ts`

### INV-P4 — Decision-trace stores only bounded `reasoningSummary`, never raw chain-of-thought
Per-trace and per-match byte/count caps must be enforced.

- **Why**: protects model IP and prevents unbounded growth.
- **Code**: `packages/persistence/src/match-analysis-summary.ts`

---

## Information isolation (werewolf)

### INV-W1 — Role and private actions stay in `privateState`
Werewolf identity, seer reveals, witch potion state, etc. must never appear in `publicState`.

- **Code**: `packages/agent-protocol/src/werewolf-schemas.ts:178`
- **How to verify**: capture decision request payloads → grep `role` / `seerVision` / `witchPotion` outside `privateState` → must be empty.

### INV-W2 — Spectator stream broadcasts the public projection only
The SSE/stream for spectators must apply the public filter to every event.

- **Why**: spectators must see exactly what a non-participating agent sees, never more.
- **Code**: `apps/api/src/routes/werewolf-stream.ts`, filter at `packages/realtime/src/filter.ts`

### INV-W3 — Validator reason cannot embed private action IDs
Validation errors broadcast to spectators must not include action-internal IDs that would leak the actor's identity.

- **Why**: regression target from PR #20. Action IDs leaked the night-action actor.
- **Code**: validator output paths into broadcast

---

## Authorization

### INV-Z1 — Only the lobby creator can start the match
`POST /api/v1/werewolf-games/:id/start` rejects any user other than `creatorUserId` with 403.

- **Why**: PR #14 fixed this; regressing would let anyone start any lobby.
- **Code**: `apps/api/src/werewolf-lobby-registry.ts:699` (`assertCreatorOnly`)

### INV-Z2 — `creatorUserId` is not in the public lobby projection
The publicly-readable lobby entry (`GET /api/v1/werewolf-games`) omits `creatorUserId`.

- **Why**: PR #22/#23 fixed an info leak. The structural fix is allowlist-style projection.
- **How to verify**: curl any public lobby endpoint → grep response for `creatorUserId` → must be empty.
- **Code**: `apps/api/src/werewolf-lobby-registry.ts:285`

### INV-Z3 — Mutating routes require auth
Every non-GET route under `/api/v1/tables/*`, `/api/v1/agents/*`, `/api/v1/werewolf-games/*` (mutations) requires `requireAuth`.

- **How to verify**: curl any mutating endpoint with no auth → must return 401.
- **Code**: `packages/auth/src/fastify-plugin.ts:87`

### INV-Z4 — Public match read-only routes work anonymously
`/api/v1/matches/:id`, `/replay`, etc. must respond 200 with the public projection for unauthenticated requests.

- **How to verify**: curl unauthenticated → 200 + body.

---

## Lobby + tables (poker)

### INV-L1 — Created tables broadcast `lobby.table_created` and appear in the list
After `POST /api/v1/tables`, the table is visible in `GET /api/v1/tables` and a `lobby.table_created` WS event fires on the `lobby` topic.

- **How to verify**: create a table → poll the list → see it; subscribe to ws → see the event.

### INV-L2 — Deleted tables disappear and the owner is navigated to `/lobby`
After delete, the table is absent from list and the owner's session is navigated back to `/lobby`.

- **Code**: `apps/web/src/pages/TablePage.tsx:260`

### INV-L3 — Seat-occupancy is race-safe under concurrent invites
Two concurrent `inviteAgent` calls for the same seat must produce exactly one occupant; the second returns a deterministic error.

- **Why**: PR #15 — post-await re-check on seat occupancy.

### INV-L4 — Persist failure preserves match completion status
If post-game persistence throws, the lobby entry keeps `status='completed'` (not reverted to a half state).

- **Why**: PR #19.

---

## Werewolf lobby

### INV-WL1 — "Fill with NPCs" produces exactly 9 seats
After clicking Fill with NPCs in a waiting lobby, the lobby has 9 occupants and is ready to start.

- **Code**: `apps/api/src/werewolf-lobby-registry.ts:681`

### INV-WL2 — Late-joining spectators get phase + roster backfill
SSE has no replay buffer, so the lobby snapshot delivered on initial connection must include `currentPhase`, `day/night`, and the full roster (alive/causeOfDeath).

- **Code**: `apps/api/src/werewolf-lobby-registry.ts:96`

### INV-WL3 — Failed pre-match cleanup keeps the lobby reachable
If `/start` fails after seats are claimed, the lobby is not stuck in a contradictory state ("Failed" subtitle + "night 0" phase).

- **Why**: PR #16.

---

## Replay + matches

### INV-R1 — Replay event types are exhaustively classified for the public filter
Adding a new `ReplayEvent.eventType` must fail TypeScript compilation until the new variant is explicitly classified in both `packages/realtime/src/filter.ts` and `packages/persistence/src/match-artifact-serialization.ts`.

- **Why**: PRs #37, #46. Compile-time exhaustiveness guard prevents private fields from silently leaking through new event types.
- **How to verify**: temporarily add a sentinel variant to `PokerReplayEventType` → `pnpm typecheck` → both filters' default arms must fail with `Type '"sentinel.new_variant"' is not assignable to type 'never'`.

### INV-R2 — `eventType` is typed, not string
`ReplayEvent.eventType` is a string-literal union of known variants, never `string`.

- **Code**: `packages/shared/src/types.ts` (`PokerReplayEventType`)

---

## Security headers

### INV-S1 — Agent token responses are not cached
`/api/v1/agent-invites/*`, `/api/v1/werewolf-agents/*` token-issuing responses include `Cache-Control: no-store`.

- **Why**: PR #10, #11. Tokens in shared caches are a CSRF/replay vector.

### INV-S2 — Auth header name validation rejects CR/LF
Configured agent endpoints reject `authHeaderName` / `authHeaderValue` containing `\r` or `\n` at the API edge.

- **Why**: PR #21. Header injection vector.

---

## How to use this doc

**When you ship a feature**: add the invariants here in the same PR. If you can't write the invariant, the feature is underspecified.

**When you ship a fix**: if the bug was a violated invariant, add it here. Future agents now catch it automatically.

**When you run `/qa`**: open this file alongside the test plan. Every invariant becomes an assertion.

**When you build a CI check**: each invariant should be expressible as a property test or end-to-end assertion. If it isn't, the invariant is too vague.

---

## Known gaps in this draft

- **Agent runtime invariants** (timeout boundedness, retry caps, isolation between connections) — not yet captured.
- **Match artifact storage** (provider parity across `memory`/`file`/cloud backends) — partial coverage.
- **WebSocket reconnection contract** (resume token, replay window, max-staleness) — not captured.

Add as you encounter them. The doc is a living artifact, not a one-shot deliverable.
