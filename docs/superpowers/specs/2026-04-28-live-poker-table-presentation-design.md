# Live Poker Table Presentation Design

> Privacy update, 2026-04-28: references in this historical spec to
> `table.hole_cards_revealed` are superseded by the frontend product iteration
> privacy policy. Public `table:*` websocket topics must not carry `holeCards`;
> only private `seat:*` topics may deliver the owning user's current hand cards.

## 1. Goal

Upgrade the realtime table route, `/tables/:tableId`, from a utilitarian
seat grid into a product-quality Texas Hold'em table experience suitable for
demo, spectator, and human-player use.

The first implementation targets high-quality 2-6 seat tables. Component and
state boundaries should leave room for 9/10 seat layouts later, but the first
delivery optimizes for the current six-seat product surface.

## 2. Resolved Product Decisions

- Primary target: realtime table page `/tables/:tableId`.
- Chosen approach: rebuild the live game presentation layer, not just restyle
  the existing page.
- Chosen layout: Live Table + Side Rail.
- Spectator behavior: realtime spectators see public table progression only.
  Private hole cards are delivered only on private `seat:*` topics to the
  owning user.
- Player behavior: human action controls are redesigned as part of the table
  experience.
- Seat scope: first version supports 2-6 seats well and keeps extension points
  for larger tables.
- Product framing: this remains entertainment and technical research software.
  No real-money gambling, deposits, withdrawals, betting odds, or financial
  transaction behavior is added.

## 3. Non-Goals

- Do not implement real-money or financial betting behavior.
- Do not make replay `/matches/:matchId` the first UI target.
- Do not rewrite the poker engine or reproduce full betting logic in the
  browser.
- Do not remove public-safe artifact and analysis protections just to support
  live spectator card reveal.
- Do not optimize 9/10 seat layouts in the first implementation.

## 4. Architecture Overview

The presentation layer has three boundaries:

```text
Backend realtime events
        +
REST table snapshot
        ↓
Live table client reducer
        ↓
Poker table view model
        ↓
Poker table UI components
```

The live route is the first consumer. Replay can later use an adapter that
converts match summaries and replay events into the same poker table view
model, but live delivery should not block on full replay state-machine reuse.

## 5. Backend Realtime Event Semantics

The existing public replay filter stays conservative. `replayEventToPublic`
continues to suppress or strip `holeCards` for public replay artifacts, match
API responses, decision traces, and analysis. This avoids broadening private
data exposure across durable public artifacts.

Realtime table visibility keeps private cards on private seat topics only. When
the orchestrator receives the internal `hole_cards.dealt` replay event, it must
publish `seat.hole_cards` only to the owning user's private seat channel. Public
`table:*` topics must not include `holeCards`, including explicit reveal frames.

`seat.action_requested` remains private to the human player's seat owner and is
the only source that enables action submission. It carries action metadata only;
the current user's cards come from `seat.hole_cards`.

### Tests To Change

- Keep the websocket test that asserts spectators never receive `holeCards` on
  table topics.
- Add or keep a websocket test that seated owners receive `seat.hole_cards`
  frames on private topics.
- Preserve match artifact, match replay, decision trace, and analysis tests
  that assert durable public surfaces do not contain `holeCards`.

## 6. Client State Layer

Create a live table state module under `apps/web/src/live-table/`.

Suggested files:

- `liveTableTypes.ts`
- `liveTableReducer.ts`
- `normalizeLiveTableEvent.ts`
- `buildPokerTableViewModel.ts`

The reducer consumes a table snapshot plus normalized websocket events and
produces stable view state.

```ts
interface LiveTableViewState {
  tableId: string;
  tableName: string;
  status: TableStatus;
  handId: string | null;
  handNumber: number;
  phase: HandPhase | null;
  buttonSeatIndex: number;
  seats: LiveSeatView[];
  board: Card[];
  pots: LivePotView[];
  currentActorPlayerId: string | null;
  actionLog: LiveActionLogEntry[];
  pendingAction: PendingAction | null;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'closed';
}
```

Each `LiveSeatView` includes:

```ts
interface LiveSeatView {
  seatIndex: number;
  occupied: boolean;
  playerId: string | null;
  agentId: string | null;
  adapterType: 'human' | 'http' | 'mock' | null;
  stack: number | null;
  status: string | null;
  isButton: boolean;
  isCurrentActor: boolean;
  isMe: boolean;
  holeCards: [Card, Card] | null;
}
```

Reducer behavior:

- `snapshot.loaded`: initializes table metadata and seats from the REST table
  snapshot.
- `hand.started`: resets board, pots, current actor, pending action, hole
  cards, and action log for the new hand.
- `seat.hole_cards`: writes the current user's hole cards into the matching
  seat by `playerId`, `seatIndex`, and `agentId`.
- Public table-topic hole-card payloads are ignored by the normalizer.
- `community_cards.dealt`: appends board cards and updates phase.
- `action.requested`: sets current actor.
- `seat.action_requested`: sets `pendingAction` for the logged-in user.
- `action.applied`: appends a live log row and clears current actor if the
  event indicates the action has resolved.
- `betting_round.complete`: updates pots.
- `pot.awarded`: appends an award log row.
- `hand.completed`: marks the phase complete, clears pending action, and keeps
  final visual state until a fresh snapshot arrives.
- table seating events: trigger a snapshot refresh at the page/controller
  layer rather than trying to rebuild structural table state from partial
  events.

The browser should not recompute the full poker engine state. It should display
server-authored events and use snapshot refreshes for authoritative table
structure and final stacks.

## 7. Poker Table View Model

`buildPokerTableViewModel` converts reducer state into UI-friendly data:

- seat position map for 2-6 occupied or configured seats
- felt table status and phase labels
- board card slots
- total pot amount
- current actor highlight
- visible player hand list for the side rail
- action panel command model for the current user
- empty-seat actions when the table is seatable
- reconnect and error banners

The view model is intentionally presentation-specific. It may duplicate simple
derived fields, but it should not mutate reducer state or call APIs.

## 8. UI Component Design

`TablePage` becomes a thin route shell. It loads auth and `tableId`, wires REST
and websocket data into the reducer, and passes the view model into components.

Suggested component hierarchy:

```text
TablePage
  LiveTableController
    PokerTableLayout
      PokerTableSurface
        PokerFelt
        PlayerSeatNode[]
        CommunityBoard
        PotDisplay
      LiveSideRail
        CurrentActionCard
        VisibleHandsList
        LiveActionLog
        TableStatusPanel
      PlayerActionPanel
      SeatManagementPanel
```

### Desktop Layout

Use Live Table + Side Rail:

```text
[                 Poker table surface                  ][ Side rail ]
[ seats around felt / board / pot / current actor glow  ][ current   ]
[                                                       ][ action    ]
[ Player action panel spans below the table when active              ]
```

### Table Surface

- Full-bleed dark table stage inside the app content area.
- Elliptical green felt table with a contrasting rail.
- Community cards are rendered as cards, not text chips.
- Pot display is centered under the board.
- Seats are positioned around the table for 2-6 players.
- Current actor gets a clear glow/ring.
- Dealer button is attached to the relevant seat.
- Empty seats use subdued seat slots and show sit controls only when the
  table accepts seating.

### Player Seat Node

Each occupied seat renders:

- agent/player label
- seat index
- adapter type
- stack
- status
- two visible hole cards
- dealer button when applicable
- current actor state

Card rendering should use a reusable card component with red suits for hearts
and diamonds, dark suits for clubs and spades, fixed dimensions, and stable
spacing so layout does not shift.

### Live Side Rail

The side rail provides the information that a spectator or player scans while
watching:

- current action: actor, phase, and status
- visible hands: every occupied player and their two cards
- live action log: recent betting and pot award events
- table status: hand number, phase, blinds, connection state

The rail should be dense and operational, not a marketing panel.

### Player Action Panel

The action panel appears only when the logged-in user has a private pending
action.

It includes:

- the user's cards and current stack
- fold, check, call, all-in buttons when legal
- bet or raise amount input when legal
- numeric min/max hints
- a slider or stepper for sized actions when useful
- submit error display scoped to the panel

Action submission is not optimistic beyond disabling controls while the request
is in flight. The visual game state waits for websocket confirmation.

### Mobile Layout

The first version must be usable on mobile:

```text
[compact table status]
[scaled poker table]
[sticky player action panel when active]
[collapsible side rail/log]
```

It does not need to be a pixel-perfect mobile poker client in the first
iteration.

## 9. Visual Direction

The visual target is a game-like Texas Hold'em table with restrained product
controls.

Palette guidance:

- felt green for the table
- warm wood or brass for the table rail and pot accents
- ivory card faces with red and dark suit marks
- neutral side rail surfaces for readability
- limited accent colors for actor state, warnings, and user action affordances

Avoid a one-note green interface. The table can be green, but the surrounding
product shell should use balanced neutrals and warm accents so the app does not
read as a flat single-hue theme.

## 10. Error And Empty States

- Initial table load failure: page-level error with a link back to lobby.
- Websocket reconnecting: keep the last table state and show a side-rail
  reconnect banner.
- Missing private hole-card event for the current user: show two card backs or a
  "cards pending" state for that seat.
- Action submit failure: show error only in `PlayerActionPanel`.
- Unknown or malformed websocket payload: ignore the event and append a safe
  diagnostic row only if it helps the user. Do not crash the table.
- Empty table: show the felt table with empty seats and clear sit controls.

## 11. Testing Plan

Backend:

- `apps/api/src/__tests__/ws.test.ts`
  - spectator never receives `holeCards` or `table.hole_cards_revealed` on
    table topics
  - seated owner receives `seat.hole_cards` on private topics with `playerId`,
    `seatIndex`, `agentId`, and two cards
  - ordinary table events still arrive
- Existing artifact privacy tests stay in place for match record, replay,
  decision trace, and analysis endpoints.

Frontend:

- `apps/web/src/live-table/__tests__/liveTableReducer.test.ts`
  - snapshot initializes seats
  - hand start resets board, pots, cards, actor, and pending action
  - `seat.hole_cards` fills the matching seat
  - public table-topic hole-card reveal payloads normalize to `null`
  - `seat.action_requested` sets pending action only for the local user
  - action and pot events append live log rows
- `apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts`
  - maps 2-6 seats to stable positions
  - derives current actor, total pot, visible hands, and action panel state
- `apps/web/src/__tests__/poker-table-surface.test.tsx`
  - occupied seats show cards
  - current actor is marked
  - empty seats show sit affordances when seatable
  - action panel renders legal actions and amount bounds
- Keep `TablePage` integration coverage focused on wiring, not full engine
  simulation.

Verification commands:

```bash
pnpm --filter api run test -- src/__tests__/ws.test.ts
pnpm --filter web run test
pnpm build
pnpm lint
pnpm test
```

## 12. Implementation Sequence

1. Backend event semantics:
   - emit private `seat.hole_cards` only
   - preserve websocket spectator privacy test coverage
   - preserve durable artifact privacy tests

2. Frontend state layer:
   - add live table types, reducer, event normalization, and view-model builder
   - cover reducer and view model with focused tests

3. UI components:
   - build card, seat, table surface, side rail, and action panel components
   - keep components data-driven through the view model

4. Route integration:
   - refactor `TablePage` into a controller shell
   - wire snapshot load, websocket events, seat actions, and action submission

5. Polish and verification:
   - desktop first, mobile usable
   - run focused tests, then full build/lint/test

## 13. Risks And Mitigations

- Risk: accidental table-topic card reveal changes a major privacy invariant.
  - Mitigation: keep hole cards on private `seat:*` topics only and test table
    topics for absence of `holeCards`.

- Risk: front-end reducer drifts from server truth.
  - Mitigation: use the reducer for presentation only and refresh snapshots on
    structural table events and hand completion.

- Risk: scope grows into replay, engine, and mobile redesign at the same time.
  - Mitigation: deliver live six-seat table first; only design adapters for
    replay reuse.

- Risk: the page becomes visually rich but operationally slow.
  - Mitigation: keep the side rail dense, action panel obvious, and table
    controls stable with fixed dimensions.

## 14. Acceptance Criteria

- `/tables/:tableId` displays a poker-table-style live surface instead of the
  current generic seat grid.
- A spectator subscribed to a live table can see every occupied player's hole
  cards by default.
- A human player still receives private action requests and can submit legal
  actions from the redesigned action panel.
- Public match artifacts, replay API, decision trace API, and analysis API do
  not expose hole cards as part of this change.
- The first version handles 2-6 configured seats with stable desktop layout and
  usable mobile layout.
- Focused backend and frontend tests cover the new event semantics, reducer,
  view model, and poker table surface.
