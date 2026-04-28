# Frontend Product Iterations Design

Date: 2026-04-28
Status: Implemented with post-review privacy hardening

## 1. Goal

Turn the current MVP web client into a coherent agent poker product surface.
The frontend should expose the important backend capabilities, make the live
Texas Hold'em table feel like the core experience, and make replay/analysis
useful for evaluating agents.

The product remains an entertainment and technical research platform. It must
not add real-money gambling, deposits, withdrawals, betting odds, cash prizes,
payments, wallets, or financial transaction behavior.

## 2. Current Backend Coverage

The frontend already covers these backend capabilities:

- Auth: register, login, logout, and current user session refresh.
- Lobby basics: list tables, create table, receive lobby websocket updates.
- Table basics: load table snapshot, subscribe to table websocket updates.
- Seats and actions: human seat, HTTP agent seat, leave seat, start hand, submit
  human action.
- Agent config: list, create, edit, and delete HTTP agent configs.
- Match artifacts: list matches, open a match, load replay events, load analysis
  summary.

The frontend does not yet cover or weakly covers these backend capabilities:

- `POST /simulate`: no UI flow for generating match artifacts.
- `DELETE /tables/:tableId`: no close/delete table control.
- `POST /tables/:tableId/agents` and `DELETE /tables/:tableId/agents/:agentId`:
  no UI for demo mock agents.
- `POST /tables/:tableId/watch` and `DELETE /tables/:tableId/watch`: no explicit
  watch/unwatch state.
- `GET /tables/:tableId/state`: backend currently returns `null` by design, so
  current-state inspection is backend-dependent and deferred.
- `GET /tables/:tableId/hands`, `GET /tables/:tableId/hands/:handId`, and
  `GET /tables/:tableId/hands/:handId/replay`: no table-local single-hand
  replay entry point. Table hand-history responses must use public-safe DTOs
  that strip `players[].holeCards` and `players[].handEvaluation` before the
  browser receives data.
- `GET /matches/:matchId/decision-trace`: no UI entry point. This should stay
  public-safe and avoid raw chain-of-thought, private cards, and detailed
  reasoning fields such as key observations or considered actions.
- `GET /health`: no service status indicator.
- Create table form omits `ante`, `seed`, `defaultTimeoutMs`, and
  `maxSpectators`.
- Seat buy-in is hard-coded to `1000`.

## 3. Product Positioning

Comparable poker products suggest two useful patterns:

- Modern poker lobbies favor dark, high-readability, high-density screens with
  grouped table/stake rows, clear status, and quick join/watch actions.
- Replay and analysis products favor a direct review loop: choose or generate a
  hand, step through public action, inspect board/pot/result context, and see
  agent/player performance summaries.

This project should not copy casino monetization patterns. The right product is
an agent competition and review workspace:

- Lobby / Table Ops
- Live Table
- Agent Lab
- Replay / Analysis Studio

## 4. Information Architecture

Add a consistent app shell across authenticated and public pages:

- Primary navigation: Lobby, Agents, Replays. Simulate joins the primary nav in
  the same iteration that `/simulate` is implemented, or Iteration 1 must create
  a real placeholder route before linking to it.
- Secondary context actions live in page headers: create table, close table,
  start hand, run simulation, new agent.
- Public replay pages still work without auth where the backend allows it, but
  auth-only actions remain guarded by existing session handling.

Routes:

- Existing: `/lobby`, `/tables/:tableId`, `/agents`, `/agents/new`,
  `/agents/:agentId/edit`, `/matches`, `/matches/:matchId`.
- New: `/simulate`.
- Optional later route: `/tables/:tableId/hands/:handId` if table-local hand
  replay becomes too large for the table page.

## 5. Visual Direction

Use a restrained product-console style, not a marketing landing page:

- Dark app background with light content panels where dense data needs scanning.
- Poker table remains visually rich and dark-felt focused.
- Lists use styled rows/cards with status chips and clear primary actions.
- Buttons, inputs, tables, cards, pills, alerts, empty states, and focus states
  share global CSS classes instead of repeated inline styles.
- Avoid one-note casino gold or single-hue palettes. Green felt is reserved for
  the table surface; operational pages should use neutral surfaces with
  controlled accent colors.

## 6. Ten Iteration Plan

### Iteration 1: App Shell And Design Tokens

Create a shared app shell and global visual primitives.

Scope:

- `styles.css`
- page wrappers in all current pages
- route navigation links

Acceptance:

- Common navigation appears across primary product pages. It must not link to a
  missing `/simulate` route.
- Main buttons, links, inputs, cards, tables, status chips, empty states, and
  error states have consistent styles.
- Major inline table styles are replaced by reusable classes.
- 375px mobile width has no horizontal overflow.

### Iteration 2: Lobby As Table Ops

Turn `LobbyPage` from a raw table into a table operations screen.

Scope:

- `LobbyPage.tsx`
- lobby-related CSS

Acceptance:

- Table rows/cards show status chip, player count, spectator count, blinds,
  current hand, and join/watch action.
- Active or joinable tables are visually prioritized.
- Loading, empty, and error states are explicit.
- Create table form remains available and responsive.

### Iteration 3: Complete Table Creation Controls

Expose backend table creation fields and validate them in the UI.

Scope:

- `CreateTableForm`
- focused tests for form validation

Acceptance:

- User can set ante, seed, timeout, max spectators, max seats, and blinds.
- Big blind must be greater than or equal to small blind.
- Numeric controls enforce backend bounds where known.
- Submitted body matches `CreateTableRequestSchema`.

### Iteration 4: Table Lifecycle Controls

Expose missing lifecycle controls on the live table page.

Scope:

- `TablePage.tsx`
- table control panel component

Acceptance:

- User can explicitly watch/unwatch a table.
- Owner can close/delete a table when allowed by backend. The implementation
  must first add or consume an explicit management signal such as `canManage` or
  `ownerUserId`; the UI must not show destructive table controls to every user
  and rely only on a 403 response.
- Start hand, leave seat, sit out next hand, watch state, and table metadata are
  grouped in a clear control area.
- Table hand history section lists completed hands only after the response is
  public-safe. It must not render `players[].holeCards` or hand evaluations from
  raw table hand summaries. Any future authenticated player-specific private
  hand view requires an explicit separate contract.

### Iteration 5: Seat Identity And Table Readability

Improve player/agent identity and table comprehension.

Scope:

- `buildPokerTableViewModel.ts`
- `PokerTableSurface.tsx`
- `SeatManagementPanel.tsx`
- table CSS

Acceptance:

- Seats display stable human/HTTP/mock badges, "you" marker, dealer button,
  stack, status, and current actor highlight.
- Empty seats show clear sit-human and sit-agent paths.
- Buy-in is user-controlled instead of fixed to `1000`.
- Seat labels are more informative than only `Seat N` when backend data allows.

### Iteration 6: Player Action Panel

Make human decision submission feel like poker software, not raw API controls.

Scope:

- `PlayerActionPanel.tsx`
- action-panel tests

Acceptance:

- Action labels are title-cased and sized consistently.
- Fold/check/call/bet/raise/all-in have clear priority and disabled states.
- Bet/raise shows min/max, presets, and all-in context.
- Deadline/turn timer state is visible from `deadlineAt`.
- Validation errors identify the exact invalid amount.

### Iteration 7: Simulation Studio

Add a UI for `POST /simulate` so users can generate replayable matches.

Scope:

- New `SimulatePage.tsx`
- router
- API helper types where useful

Acceptance:

- User can configure name, seats, blinds, ante, seed, timeout, number of hands,
  mock agent names, strategies, and buy-ins.
- The page respects the 20-hand cap.
- On success, user can navigate directly to the generated match replay.
- Errors are shown inline with retry available.
- The primary navigation gains the Simulate item in this iteration if it was not
  added as a working placeholder earlier.

### Iteration 8: Agent Lab Productization

Make agent setup understandable and safer.

Scope:

- `AgentsPage.tsx`
- `AgentEditPage.tsx`
- optional modal/confirmation component

Acceptance:

- Agent list uses scan-friendly cards or styled rows with status metadata.
- Edit page explains endpoint contract without exposing secrets.
- Auth header value remains write-only.
- Delete confirmation is an in-app dialog, not native `confirm`.
- After create/edit, users have a clear path back to Lobby or a table.

### Iteration 9: Replay Player

Turn static replay inspection into a step-through player.

Scope:

- `MatchReplayWorkbench.tsx`
- `matchReplayView.ts`

Acceptance:

- Replay tab supports previous/next action, play/pause, and action scrubber.
- Selected action updates board/action/result context.
- Street filters or markers make preflop/flop/turn/river scanning easier.
- Left/right keyboard shortcuts step actions when focus is not in an input.

### Iteration 10: Analysis Report And QA

Make analysis actionable and verify the product surfaces.

Scope:

- `MatchAnalysisDashboard.tsx`
- `apps/web/e2e`
- focused component tests

Acceptance:

- Agent comparison supports sorting by decision count, latency, timeouts,
  invalid actions, fallbacks, or missing reasoning.
- Timeout/invalid/fallback metrics use warning styles.
- Analysis can point users toward relevant hands/actions when data allows.
- E2E or browser QA covers Lobby, Simulation, Agent CRUD, Replay/Analysis, live
  table desktop, and mobile responsive layouts.

## 7. Privacy And Security Boundaries

- Do not display raw chain-of-thought.
- Do not display private state hashes as if they are user-facing explanations.
- Durable public match artifacts should stay public-safe.
- Public table websocket topics must never carry `holeCards`. Only private
  `seat.hole_cards` messages may carry the owning user's current hand cards;
  `seat.action_requested` carries action metadata only.
- Public table states, hand summaries, match summaries, and match index entries
  must not expose deterministic deck seeds, because seed plus public hand
  metadata can reconstruct hidden cards.
- The web websocket normalizer must ignore any public table-topic hole-card
  reveal frame if one appears from an older server or stale test fixture.
- `/tables/:tableId/hands/start` must be owner-only and return the same
  public-safe hand summary shape as table hand-history routes.
- `/matches/:matchId/decision-trace` must redact detailed reasoning summaries
  and `privateStateHash` from public responses while retaining non-secret public
  metrics and public-state hashes needed for review tooling.
- Public match detail must not expose artifact file hashes for private summary
  or trace files; those hashes can become offline verification oracles for
  guessed private seeds/state.
- Agent endpoint documentation must state that responses echo `requestId` and
  `agentId`, because the adapter enforces that contract.
- Table-local hand-history UI must be public-safe by default. If a future
  authenticated personal-hand view is added, it must clearly scope private cards
  to the owning player.
- `authHeaderValue` remains write-only.
- Spectator behavior must align with final backend privacy policy: spectators
  see public table progression only, never private hole cards.
- No real-money, payments, deposits, withdrawals, betting odds, prizes, or
  financial language.

## 8. Testing Strategy

Use focused tests during iterations and full verification before completion:

- Component tests for form validation, action panel behavior, table view model,
  replay player state, and analysis sorting.
- API helper tests for any new typed helper.
- Existing live-table and replay tests must remain green.
- API privacy tests cover table hand-history, `/hands/start`, public match
  decision traces, deterministic seed redaction, websocket table-topic frames,
  action-request payloads, and owner-only start-hand permission.
- Browser QA or Playwright where available for desktop/mobile layout checks.

Final verification target:

- `pnpm --filter web run test`
- `pnpm --filter web run build`
- `pnpm lint`
- Browser smoke test for the web app if the environment supports running the
  dev server.

## 9. Implementation Decisions

- This iteration hardens backend hole-card privacy semantics. The UI may display
  private hole cards only from `seat.hole_cards` frames delivered to the owning
  user; it must not fetch, infer, persist, or render hidden cards from public
  table channels, action-request frames, deterministic seeds, or private-state
  hashes. Durable public match artifact pages remain public-safe.
- Table hand history requires a safe display boundary before implementation.
  Preferred implementation: add backend public-safe table hand-history responses
  that strip `players[].holeCards` and `players[].handEvaluation` before the
  browser receives them. A web-local sanitizer can remain as a defensive layer,
  but it is not sufficient as the primary privacy boundary.
- Owner-only table management requires an explicit permission source. Preferred
  implementation: derive `canManage` in the route shell by comparing an exposed
  owner signal to the current user, or add a backend `canManage` field before
  rendering destructive controls.
- `/tables/:tableId/state` is not a frontend iteration target until the backend
  returns a non-null state.
- Table-local hand history starts as an embedded panel on `/tables/:tableId`.
  A dedicated `/tables/:tableId/hands/:handId` route is deferred until the
  embedded panel becomes too large.
- `/matches/:matchId/decision-trace` remains a backend artifact endpoint in this
  iteration. The analysis UI can surface aggregate timeout, invalid-action,
  fallback, latency, risk, and intent metrics without raw decision trace detail.
