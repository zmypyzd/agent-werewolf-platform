# Live Poker Table Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/tables/:tableId` into a realtime Texas Hold'em table with player controls and a reusable live table presentation layer.

**Privacy update, 2026-04-28:** this historical plan's spectator-visible
hole-card event is superseded. Public `table:*` websocket topics must not carry
`holeCards`; only private `seat:*` topics may deliver the owning user's current
hand cards.

**Architecture:** Keep hole cards on private seat topics while preserving public-safe artifact filtering. Refactor the web table page into a controller that feeds a reducer, derives a poker table view model, and renders table, side rail, and action components.

**Tech Stack:** TypeScript, Fastify websocket routes, Vitest, React 18, Vite, CSS modules via existing global `styles.css`.

---

## File Structure

Backend:

- Modify `packages/table-orchestrator/src/orchestrator.ts`
  - Emits `table.hole_cards_revealed` on the table topic when internal hole cards are dealt.
  - Keeps existing private `seat.hole_cards` and `seat.action_requested` flows.
- Modify `apps/api/src/__tests__/ws.test.ts`
  - Replaces the spectator no-hole-card invariant with explicit realtime reveal coverage.

Frontend state:

- Create `apps/web/src/live-table/liveTableTypes.ts`
  - Owns the web-local table, card, reducer event, and view model types.
- Create `apps/web/src/live-table/liveTableReducer.ts`
  - Owns state initialization and normalized live event application.
- Create `apps/web/src/live-table/normalizeLiveTableEvent.ts`
  - Converts `WsMessage` into reducer events.
- Create `apps/web/src/live-table/buildPokerTableViewModel.ts`
  - Converts reducer state into UI-friendly seat positions, visible hands, pot totals, and action commands.
- Create `apps/web/src/live-table/__tests__/liveTableReducer.test.ts`
  - Covers snapshot, hand reset, card reveal, pending action, and live log behavior.
- Create `apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts`
  - Covers seat placement and derived display data.

Frontend UI:

- Create `apps/web/src/live-table/PokerTableSurface.tsx`
  - Renders the felt table, player seats, board, pot, and side rail.
- Create `apps/web/src/live-table/PlayerActionPanel.tsx`
  - Renders legal human-player actions.
- Create `apps/web/src/live-table/SeatManagementPanel.tsx`
  - Renders sit/agent-seat controls for empty seats.
- Create `apps/web/src/__tests__/poker-table-surface.test.tsx`
  - Covers occupied seats, visible hole cards, current actor, empty seats, and action panel state.
- Modify `apps/web/src/pages/TablePage.tsx`
  - Becomes the route/controller shell and delegates visual rendering to the new live-table components.
- Modify `apps/web/src/styles.css`
  - Adds poker table, card, side rail, and action panel styles.

---

### Task 1: Backend Realtime Hole Card Reveal Event

**Files:**
- Modify: `apps/api/src/__tests__/ws.test.ts`
- Modify: `packages/table-orchestrator/src/orchestrator.ts`

- [ ] **Step 1: Replace the websocket spectator privacy test with reveal coverage**

In `apps/api/src/__tests__/ws.test.ts`, replace the test named
`a spectator does not receive any frame containing holeCards while a hand runs with mock agents`
with this test:

```ts
  it('a spectator receives revealed hole cards for each player on the table topic', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const spectatorSid = await registerAs('spec@x.test');
    const tableId = await createTable(aliceSid);

    const spec = await connectWs(spectatorSid);
    spec.ws.send(JSON.stringify({ topic: `table:${tableId}`, type: 'subscribe', payload: {} }));
    await new Promise(r => setTimeout(r, 50));

    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/api/v1/tables/${tableId}/agents`, {
        method: 'POST',
        headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
        body: JSON.stringify({
          name: `Bot${i}`,
          adapterType: 'mock',
          strategy: 'always-call',
          buyIn: 1000,
        }),
      });
    }

    await fetch(`${baseUrl}/api/v1/tables/${tableId}/hands/start`, {
      method: 'POST',
      headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
      body: JSON.stringify({}),
    });

    await awaitMessage(spec.messages, m => m['type'] === 'hand.completed', 4000);

    const revealFrames = spec.messages.filter(m => m['type'] === 'table.hole_cards_revealed');
    expect(revealFrames).toHaveLength(2);

    const seenPlayers = new Set<string>();
    for (const frame of revealFrames) {
      expect(frame['topic']).toBe(`table:${tableId}`);
      const payload = frame['payload'] as Record<string, unknown>;
      expect(payload['handId']).toEqual(expect.stringMatching(/^hand-/));
      expect(payload['playerId']).toEqual(expect.stringMatching(/^player-/));
      expect(payload['agentId']).toEqual(expect.stringMatching(/^agent-/));
      expect(typeof payload['seatIndex']).toBe('number');
      expect(payload['holeCards']).toHaveLength(2);
      seenPlayers.add(String(payload['playerId']));
    }

    expect(seenPlayers.size).toBe(2);

    spec.ws.close();
  }, 10_000);
```

- [ ] **Step 2: Run the focused backend test and verify it fails**

Run:

```bash
pnpm --filter api run test -- src/__tests__/ws.test.ts -t "revealed hole cards"
```

Expected: FAIL because no `table.hole_cards_revealed` frames are emitted.

- [ ] **Step 3: Emit `table.hole_cards_revealed` from the orchestrator**

In `packages/table-orchestrator/src/orchestrator.ts`, replace the existing
`if (event.eventType === 'hole_cards.dealt')` block inside the replay-event
handler with:

```ts
        if (event.eventType === 'hole_cards.dealt') {
          const playerId = String(event.data['playerId'] ?? '');
          const seat = tableState.seats.find(s => s?.playerId === playerId);
          const holeCards = event.data['holeCards'];
          if (seat && Array.isArray(holeCards) && holeCards.length === 2) {
            hub.publishTable(tableId, 'table.hole_cards_revealed', {
              handId: event.handId,
              playerId: seat.playerId,
              seatIndex: seat.seatIndex,
              agentId: seat.agentId,
              holeCards,
            });
            hub.publishSeat(seat.ownerUserId, tableId, 'seat.hole_cards', {
              handId: event.handId,
              holeCards,
            });
          }
        }
```

Do not change `packages/realtime/src/filter.ts`; durable public artifact and
analysis surfaces must remain public-safe.

- [ ] **Step 4: Run focused backend tests**

Run:

```bash
pnpm --filter api run test -- src/__tests__/ws.test.ts
pnpm --filter api run test -- src/__tests__/matches.test.ts
```

Expected: PASS. The websocket test should now see reveal events; the match API
tests should continue proving durable public artifacts do not expose
`holeCards`.

- [ ] **Step 5: Commit backend event semantics**

Run:

```bash
git add apps/api/src/__tests__/ws.test.ts packages/table-orchestrator/src/orchestrator.ts
git commit -m "Add realtime spectator hole card reveal event"
```

---

### Task 2: Live Table Reducer And Event Normalization

**Files:**
- Create: `apps/web/src/live-table/liveTableTypes.ts`
- Create: `apps/web/src/live-table/liveTableReducer.ts`
- Create: `apps/web/src/live-table/normalizeLiveTableEvent.ts`
- Create: `apps/web/src/live-table/__tests__/liveTableReducer.test.ts`

- [ ] **Step 1: Write reducer tests**

Create `apps/web/src/live-table/__tests__/liveTableReducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createInitialLiveTableState, liveTableReducer } from '../liveTableReducer.js';
import type { Card, LiveTableEvent, TableSnapshot } from '../liveTableTypes.js';

const cards: [Card, Card] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'h' },
];

const snapshot: TableSnapshot = {
  tableId: 'tbl-1',
  config: {
    name: 'Demo Table',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    defaultTimeoutMs: 1000,
  },
  status: 'preparing',
  seats: [
    {
      seatIndex: 0,
      agentId: 'agent-a',
      playerId: 'player-a',
      stack: 1000,
      status: 'active',
      ownerUserId: 'usr-a',
      adapterType: 'human',
      agentConfigId: null,
      sitOutNextHand: false,
      joinedAt: 1,
    },
    {
      seatIndex: 1,
      agentId: 'agent-b',
      playerId: 'player-b',
      stack: 1000,
      status: 'active',
      ownerUserId: 'usr-b',
      adapterType: 'mock',
      agentConfigId: null,
      sitOutNextHand: false,
      joinedAt: 1,
    },
    null,
    null,
    null,
    null,
  ],
  currentHandId: null,
  handNumber: 0,
  button: 0,
};

function reduce(events: LiveTableEvent[]) {
  return events.reduce(liveTableReducer, createInitialLiveTableState());
}

describe('liveTableReducer', () => {
  it('initializes seats from a table snapshot', () => {
    const state = reduce([{ type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' }]);

    expect(state.tableId).toBe('tbl-1');
    expect(state.tableName).toBe('Demo Table');
    expect(state.seats).toHaveLength(6);
    expect(state.seats[0]).toMatchObject({
      occupied: true,
      playerId: 'player-a',
      agentId: 'agent-a',
      stack: 1000,
      isMe: true,
      isButton: true,
      holeCards: null,
    });
    expect(state.seats[2]).toMatchObject({ occupied: false, seatIndex: 2 });
  });

  it('resets hand state on hand.started', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'table.hole_cards_revealed', handId: 'hand-old', playerId: 'player-a', seatIndex: 0, agentId: 'agent-a', holeCards: cards },
      { type: 'community_cards.dealt', phase: 'flop', cards: [{ rank: 'Q', suit: 'd' }] },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
    ]);

    expect(state.handId).toBe('hand-1');
    expect(state.phase).toBe('preflop');
    expect(state.board).toEqual([]);
    expect(state.pots).toEqual([]);
    expect(state.actionLog).toEqual([]);
    expect(state.pendingAction).toBeNull();
    expect(state.seats[0]!.holeCards).toBeNull();
  });

  it('stores spectator-visible hole cards on the matching seat', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      { type: 'table.hole_cards_revealed', handId: 'hand-1', playerId: 'player-b', seatIndex: 1, agentId: 'agent-b', holeCards: cards },
    ]);

    expect(state.seats[1]!.holeCards).toEqual(cards);
    expect(state.seats[0]!.holeCards).toBeNull();
  });

  it('sets pending action only from private seat action requests', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      {
        type: 'seat.action_requested',
        handId: 'hand-1',
        requestId: 'req-1',
        deadlineAt: 1234,
        legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }],
        privateState: { playerId: 'player-a', holeCards: cards },
      },
    ]);

    expect(state.pendingAction).toMatchObject({
      handId: 'hand-1',
      requestId: 'req-1',
      legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }],
    });
    expect(state.seats[0]!.holeCards).toEqual(cards);
  });

  it('updates board, pots, current actor, and action log from live events', () => {
    const state = reduce([
      { type: 'snapshot.loaded', table: snapshot, meUserId: 'usr-a' },
      { type: 'hand.started', handId: 'hand-1', handNumber: 1 },
      { type: 'action.requested', playerId: 'player-b' },
      { type: 'community_cards.dealt', phase: 'flop', cards: [{ rank: 'Q', suit: 'd' }] },
      { type: 'betting_round.complete', pots: [{ amount: 150 }] },
      { type: 'action.applied', playerId: 'player-b', actionType: 'raise', amount: 100, potTotal: 150 },
      { type: 'pot.awarded', amount: 150, winnerIds: ['player-b'] },
    ]);

    expect(state.currentActorPlayerId).toBeNull();
    expect(state.board).toEqual([{ rank: 'Q', suit: 'd' }]);
    expect(state.phase).toBe('flop');
    expect(state.pots).toEqual([{ amount: 150 }]);
    expect(state.actionLog.map(entry => entry.label)).toEqual([
      'player-b raise 100 (pot 150)',
      'pot awarded 150 to player-b',
    ]);
  });
});
```

- [ ] **Step 2: Run reducer tests and verify they fail**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/liveTableReducer.test.ts
```

Expected: FAIL because the live-table module files do not exist.

- [ ] **Step 3: Create live table types**

Create `apps/web/src/live-table/liveTableTypes.ts`:

```ts
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'c' | 'd' | 'h' | 's';
export interface Card { rank: Rank; suit: Suit }

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type TableStatus = 'preparing' | 'in_hand' | 'paused' | 'completed';
export type SeatAdapterType = 'human' | 'http' | 'mock';

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface LegalAction {
  type: ActionType;
  callAmount?: number;
  minAmount?: number;
  maxAmount?: number;
}

export interface SeatSnapshot {
  seatIndex: number;
  agentId: string;
  playerId: string;
  stack: number;
  status: string;
  ownerUserId: string;
  adapterType: SeatAdapterType;
  agentConfigId: string | null;
  sitOutNextHand: boolean;
  joinedAt: number;
}

export interface TableSnapshot {
  tableId: string;
  config: {
    name: string;
    maxSeats: number;
    blindConfig: BlindConfig;
    defaultTimeoutMs: number;
  };
  status: TableStatus;
  seats: (SeatSnapshot | null)[];
  currentHandId: string | null;
  handNumber: number;
  button: number;
}

export interface LiveSeatView {
  seatIndex: number;
  occupied: boolean;
  playerId: string | null;
  agentId: string | null;
  ownerUserId: string | null;
  adapterType: SeatAdapterType | null;
  stack: number | null;
  status: string | null;
  isButton: boolean;
  isCurrentActor: boolean;
  isMe: boolean;
  holeCards: [Card, Card] | null;
}

export interface PendingAction {
  handId: string;
  requestId: string;
  legalActions: LegalAction[];
  deadlineAt: number;
  privateState: { playerId: string; holeCards: [Card, Card] };
}

export interface LivePotView {
  amount: number;
}

export interface LiveActionLogEntry {
  id: string;
  label: string;
}

export interface LiveTableViewState {
  tableId: string | null;
  tableName: string;
  status: TableStatus | null;
  blindConfig: BlindConfig | null;
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

export type LiveTableEvent =
  | { type: 'snapshot.loaded'; table: TableSnapshot; meUserId: string | null }
  | { type: 'connection.changed'; status: LiveTableViewState['connectionStatus'] }
  | { type: 'hand.started'; handId: string; handNumber: number }
  | { type: 'table.hole_cards_revealed'; handId: string; playerId: string; seatIndex: number; agentId: string; holeCards: [Card, Card] }
  | { type: 'seat.hole_cards'; handId: string; holeCards: [Card, Card] }
  | { type: 'community_cards.dealt'; phase: HandPhase; cards: Card[] }
  | { type: 'action.requested'; playerId: string }
  | { type: 'seat.action_requested'; handId: string; requestId: string; legalActions: LegalAction[]; deadlineAt: number; privateState: { playerId: string; holeCards: [Card, Card] } }
  | { type: 'action.applied'; playerId: string; actionType: ActionType; amount: number; potTotal?: number }
  | { type: 'betting_round.complete'; pots: LivePotView[] }
  | { type: 'pot.awarded'; amount: number; winnerIds: string[] }
  | { type: 'hand.completed' };
```

- [ ] **Step 4: Implement the reducer**

Create `apps/web/src/live-table/liveTableReducer.ts`:

```ts
import type {
  Card,
  LiveActionLogEntry,
  LiveSeatView,
  LiveTableEvent,
  LiveTableViewState,
  SeatSnapshot,
} from './liveTableTypes.js';

export function createInitialLiveTableState(): LiveTableViewState {
  return {
    tableId: null,
    tableName: '',
    status: null,
    blindConfig: null,
    handId: null,
    handNumber: 0,
    phase: null,
    buttonSeatIndex: -1,
    seats: [],
    board: [],
    pots: [],
    currentActorPlayerId: null,
    actionLog: [],
    pendingAction: null,
    connectionStatus: 'connecting',
  };
}

export function liveTableReducer(
  state: LiveTableViewState,
  event: LiveTableEvent,
): LiveTableViewState {
  switch (event.type) {
    case 'snapshot.loaded': {
      const seats = Array.from({ length: event.table.config.maxSeats }, (_, index) =>
        seatFromSnapshot(event.table.seats[index] ?? null, index, event.table.button, event.meUserId),
      );
      return {
        ...state,
        tableId: event.table.tableId,
        tableName: event.table.config.name,
        status: event.table.status,
        blindConfig: event.table.config.blindConfig,
        handId: event.table.currentHandId,
        handNumber: event.table.handNumber,
        buttonSeatIndex: event.table.button,
        seats: markCurrentActor(seats, state.currentActorPlayerId),
      };
    }
    case 'connection.changed':
      return { ...state, connectionStatus: event.status };
    case 'hand.started':
      return {
        ...state,
        handId: event.handId,
        handNumber: event.handNumber,
        phase: 'preflop',
        board: [],
        pots: [],
        currentActorPlayerId: null,
        pendingAction: null,
        actionLog: [],
        seats: state.seats.map(seat => ({ ...seat, isCurrentActor: false, holeCards: null })),
      };
    case 'table.hole_cards_revealed':
      return {
        ...state,
        seats: state.seats.map(seat =>
          seat.playerId === event.playerId || seat.seatIndex === event.seatIndex
            ? { ...seat, holeCards: event.holeCards }
            : seat,
        ),
      };
    case 'seat.hole_cards':
      return {
        ...state,
        seats: state.seats.map(seat => seat.isMe ? { ...seat, holeCards: event.holeCards } : seat),
      };
    case 'community_cards.dealt':
      return { ...state, phase: event.phase, board: [...state.board, ...event.cards] };
    case 'action.requested':
      return {
        ...state,
        currentActorPlayerId: event.playerId,
        seats: markCurrentActor(state.seats, event.playerId),
      };
    case 'seat.action_requested':
      return {
        ...state,
        pendingAction: {
          handId: event.handId,
          requestId: event.requestId,
          legalActions: event.legalActions,
          deadlineAt: event.deadlineAt,
          privateState: event.privateState,
        },
        seats: state.seats.map(seat =>
          seat.isMe ? { ...seat, holeCards: event.privateState.holeCards } : seat,
        ),
      };
    case 'action.applied':
      return {
        ...state,
        currentActorPlayerId: null,
        seats: markCurrentActor(state.seats, null),
        actionLog: appendLog(state.actionLog, formatActionApplied(event)),
      };
    case 'betting_round.complete':
      return { ...state, pots: event.pots };
    case 'pot.awarded':
      return {
        ...state,
        actionLog: appendLog(state.actionLog, `pot awarded ${event.amount} to ${event.winnerIds.join(', ')}`),
      };
    case 'hand.completed':
      return {
        ...state,
        phase: 'complete',
        currentActorPlayerId: null,
        pendingAction: null,
        seats: markCurrentActor(state.seats, null),
      };
    default:
      return state;
  }
}

function seatFromSnapshot(
  seat: SeatSnapshot | null,
  seatIndex: number,
  buttonSeatIndex: number,
  meUserId: string | null,
): LiveSeatView {
  if (!seat) {
    return {
      seatIndex,
      occupied: false,
      playerId: null,
      agentId: null,
      ownerUserId: null,
      adapterType: null,
      stack: null,
      status: null,
      isButton: buttonSeatIndex === seatIndex,
      isCurrentActor: false,
      isMe: false,
      holeCards: null,
    };
  }

  return {
    seatIndex,
    occupied: true,
    playerId: seat.playerId,
    agentId: seat.agentId,
    ownerUserId: seat.ownerUserId,
    adapterType: seat.adapterType,
    stack: seat.stack,
    status: seat.status,
    isButton: buttonSeatIndex === seatIndex,
    isCurrentActor: false,
    isMe: seat.ownerUserId === meUserId,
    holeCards: null,
  };
}

function markCurrentActor(seats: LiveSeatView[], playerId: string | null): LiveSeatView[] {
  return seats.map(seat => ({ ...seat, isCurrentActor: !!playerId && seat.playerId === playerId }));
}

function appendLog(entries: LiveActionLogEntry[], label: string): LiveActionLogEntry[] {
  return [...entries, { id: `${Date.now()}:${entries.length}`, label }].slice(-50);
}

function formatActionApplied(event: Extract<LiveTableEvent, { type: 'action.applied' }>): string {
  const amount = event.amount > 0 ? ` ${event.amount}` : '';
  const pot = event.potTotal === undefined ? '' : ` (pot ${event.potTotal})`;
  return `${event.playerId} ${event.actionType}${amount}${pot}`;
}
```

- [ ] **Step 5: Implement websocket event normalization**

Create `apps/web/src/live-table/normalizeLiveTableEvent.ts`:

```ts
import type { WsMessage } from '../lib/ws.js';
import type { ActionType, Card, HandPhase, LegalAction, LivePotView, LiveTableEvent } from './liveTableTypes.js';

export function normalizeLiveTableEvent(message: WsMessage): LiveTableEvent | null {
  const data = message.payload;
  switch (message.type) {
    case 'hand.started':
      return {
        type: 'hand.started',
        handId: String(data['handId'] ?? ''),
        handNumber: Number(data['handNumber'] ?? 0),
      };
    case 'table.hole_cards_revealed':
      if (!isTwoCards(data['holeCards'])) return null;
      return {
        type: 'table.hole_cards_revealed',
        handId: String(data['handId'] ?? ''),
        playerId: String(data['playerId'] ?? ''),
        seatIndex: Number(data['seatIndex'] ?? -1),
        agentId: String(data['agentId'] ?? ''),
        holeCards: data['holeCards'],
      };
    case 'seat.hole_cards':
      if (!isTwoCards(data['holeCards'])) return null;
      return { type: 'seat.hole_cards', handId: String(data['handId'] ?? ''), holeCards: data['holeCards'] };
    case 'community_cards.dealt':
      return {
        type: 'community_cards.dealt',
        phase: String(data['phase'] ?? 'preflop') as HandPhase,
        cards: Array.isArray(data['cards']) ? data['cards'] as Card[] : [],
      };
    case 'action.requested':
      return { type: 'action.requested', playerId: String(data['playerId'] ?? '') };
    case 'seat.action_requested':
      if (!isTwoCards((data['privateState'] as Record<string, unknown> | undefined)?.['holeCards'])) return null;
      return {
        type: 'seat.action_requested',
        handId: String(data['handId'] ?? ''),
        requestId: String(data['requestId'] ?? ''),
        legalActions: Array.isArray(data['legalActions']) ? data['legalActions'] as LegalAction[] : [],
        deadlineAt: Number(data['deadlineAt'] ?? 0),
        privateState: data['privateState'] as { playerId: string; holeCards: [Card, Card] },
      };
    case 'action.applied':
      return {
        type: 'action.applied',
        playerId: String(data['playerId'] ?? ''),
        actionType: String(data['actionType'] ?? 'check') as ActionType,
        amount: Number(data['amount'] ?? 0),
        ...(data['potTotal'] === undefined ? {} : { potTotal: Number(data['potTotal']) }),
      } as LiveTableEvent;
    case 'betting_round.complete':
      return {
        type: 'betting_round.complete',
        pots: Array.isArray(data['pots']) ? data['pots'] as LivePotView[] : [],
      };
    case 'pot.awarded':
      return {
        type: 'pot.awarded',
        amount: Number(data['amount'] ?? 0),
        winnerIds: Array.isArray(data['winnerIds']) ? data['winnerIds'].map(String) : [],
      };
    case 'hand.completed':
      return { type: 'hand.completed' };
    default:
      return null;
  }
}

function isTwoCards(value: unknown): value is [Card, Card] {
  return Array.isArray(value) && value.length === 2;
}
```

- [ ] **Step 6: Run reducer tests**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/liveTableReducer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit reducer layer**

Run:

```bash
git add apps/web/src/live-table/liveTableTypes.ts apps/web/src/live-table/liveTableReducer.ts apps/web/src/live-table/normalizeLiveTableEvent.ts apps/web/src/live-table/__tests__/liveTableReducer.test.ts
git commit -m "Add live table reducer"
```

---

### Task 3: Poker Table View Model

**Files:**
- Create: `apps/web/src/live-table/buildPokerTableViewModel.ts`
- Create: `apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts`

- [ ] **Step 1: Write view model tests**

Create `apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPokerTableViewModel } from '../buildPokerTableViewModel.js';
import type { LiveTableViewState } from '../liveTableTypes.js';

const baseState: LiveTableViewState = {
  tableId: 'tbl-1',
  tableName: 'Demo Table',
  status: 'in_hand',
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  handId: 'hand-1',
  handNumber: 3,
  phase: 'flop',
  buttonSeatIndex: 0,
  seats: [
    { seatIndex: 0, occupied: true, playerId: 'p0', agentId: 'a0', ownerUserId: 'u0', adapterType: 'human', stack: 900, status: 'active', isButton: true, isCurrentActor: false, isMe: true, holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }] },
    { seatIndex: 1, occupied: true, playerId: 'p1', agentId: 'a1', ownerUserId: 'u1', adapterType: 'mock', stack: 1100, status: 'active', isButton: false, isCurrentActor: true, isMe: false, holeCards: [{ rank: '8', suit: 'c' }, { rank: '8', suit: 'd' }] },
    { seatIndex: 2, occupied: false, playerId: null, agentId: null, ownerUserId: null, adapterType: null, stack: null, status: null, isButton: false, isCurrentActor: false, isMe: false, holeCards: null },
    { seatIndex: 3, occupied: false, playerId: null, agentId: null, ownerUserId: null, adapterType: null, stack: null, status: null, isButton: false, isCurrentActor: false, isMe: false, holeCards: null },
  ],
  board: [{ rank: 'Q', suit: 'd' }],
  pots: [{ amount: 150 }, { amount: 75 }],
  currentActorPlayerId: 'p1',
  actionLog: [{ id: '1', label: 'p1 raise 100' }],
  pendingAction: null,
  connectionStatus: 'connected',
};

describe('buildPokerTableViewModel', () => {
  it('derives table labels, pot total, visible hands, and actor state', () => {
    const model = buildPokerTableViewModel(baseState, { seatable: true });

    expect(model.title).toBe('Demo Table');
    expect(model.subtitle).toBe('hand hand-1 · flop · blinds 25/50');
    expect(model.totalPot).toBe(225);
    expect(model.seats[0]!.position).toBe('top-left');
    expect(model.seats[1]!.position).toBe('top-right');
    expect(model.seats[1]!.isCurrentActor).toBe(true);
    expect(model.visibleHands.map(hand => hand.playerId)).toEqual(['p0', 'p1']);
    expect(model.visibleHands[0]!.cards).toHaveLength(2);
    expect(model.canShowSeatControls).toBe(true);
  });

  it('uses cards pending labels for occupied seats without revealed cards', () => {
    const state: LiveTableViewState = {
      ...baseState,
      seats: baseState.seats.map((seat, index) => index === 1 ? { ...seat, holeCards: null } : seat),
    };

    const model = buildPokerTableViewModel(state, { seatable: false });

    expect(model.visibleHands.find(hand => hand.playerId === 'p1')!.cards).toBeNull();
    expect(model.visibleHands.find(hand => hand.playerId === 'p1')!.cardStatus).toBe('cards pending');
    expect(model.canShowSeatControls).toBe(false);
  });
});
```

- [ ] **Step 2: Run view model tests and verify they fail**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/buildPokerTableViewModel.test.ts
```

Expected: FAIL because `buildPokerTableViewModel.ts` does not exist.

- [ ] **Step 3: Implement the view model builder**

Create `apps/web/src/live-table/buildPokerTableViewModel.ts`:

```ts
import type { Card, LiveSeatView, LiveTableViewState } from './liveTableTypes.js';

export type SeatPosition = 'top-left' | 'top-right' | 'right' | 'bottom-right' | 'bottom-left' | 'left';

export interface PokerTableSeatModel extends LiveSeatView {
  position: SeatPosition;
  displayName: string;
}

export interface VisibleHandModel {
  playerId: string;
  label: string;
  cards: [Card, Card] | null;
  cardStatus: 'visible' | 'cards pending';
}

export interface PokerTableViewModel {
  title: string;
  subtitle: string;
  phaseLabel: string;
  connectionStatus: LiveTableViewState['connectionStatus'];
  board: Card[];
  totalPot: number;
  seats: PokerTableSeatModel[];
  visibleHands: VisibleHandModel[];
  actionLog: LiveTableViewState['actionLog'];
  pendingAction: LiveTableViewState['pendingAction'];
  canShowSeatControls: boolean;
}

const POSITION_MAP: Record<number, SeatPosition[]> = {
  2: ['top-left', 'bottom-right'],
  3: ['top-left', 'right', 'bottom-left'],
  4: ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
  5: ['top-left', 'top-right', 'right', 'bottom-right', 'bottom-left'],
  6: ['top-left', 'top-right', 'right', 'bottom-right', 'bottom-left', 'left'],
};

export function buildPokerTableViewModel(
  state: LiveTableViewState,
  options: { seatable: boolean },
): PokerTableViewModel {
  const seats = state.seats.map((seat, index) => ({
    ...seat,
    position: positionFor(state.seats.length, index),
    displayName: seat.agentId ?? `Seat ${seat.seatIndex}`,
  }));
  const blindLabel = state.blindConfig ? `${state.blindConfig.smallBlind}/${state.blindConfig.bigBlind}` : '--';
  const phaseLabel = state.phase ?? 'waiting';

  return {
    title: state.tableName || 'Poker Table',
    subtitle: `hand ${state.handId ?? '--'} · ${phaseLabel} · blinds ${blindLabel}`,
    phaseLabel,
    connectionStatus: state.connectionStatus,
    board: state.board,
    totalPot: state.pots.reduce((sum, pot) => sum + pot.amount, 0),
    seats,
    visibleHands: seats
      .filter(seat => seat.occupied && seat.playerId)
      .map(seat => ({
        playerId: seat.playerId!,
        label: seat.displayName,
        cards: seat.holeCards,
        cardStatus: seat.holeCards ? 'visible' : 'cards pending',
      })),
    actionLog: state.actionLog,
    pendingAction: state.pendingAction,
    canShowSeatControls: options.seatable,
  };
}

function positionFor(totalSeats: number, index: number): SeatPosition {
  const normalizedTotal = Math.min(6, Math.max(2, totalSeats));
  return (POSITION_MAP[normalizedTotal] ?? POSITION_MAP[6])![index] ?? 'left';
}
```

- [ ] **Step 4: Run view model tests**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/buildPokerTableViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all live-table unit tests**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/liveTableReducer.test.ts src/live-table/__tests__/buildPokerTableViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit view model**

Run:

```bash
git add apps/web/src/live-table/buildPokerTableViewModel.ts apps/web/src/live-table/__tests__/buildPokerTableViewModel.test.ts
git commit -m "Add poker table view model"
```

---

### Task 4: Poker Table Surface Components

**Files:**
- Create: `apps/web/src/live-table/PokerTableSurface.tsx`
- Create: `apps/web/src/live-table/PlayerActionPanel.tsx`
- Create: `apps/web/src/live-table/SeatManagementPanel.tsx`
- Create: `apps/web/src/__tests__/poker-table-surface.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write poker table surface tests**

Create `apps/web/src/__tests__/poker-table-surface.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import type { PokerTableViewModel } from '../live-table/buildPokerTableViewModel.js';

const model: PokerTableViewModel = {
  title: 'Demo Table',
  subtitle: 'hand hand-1 · flop · blinds 25/50',
  phaseLabel: 'flop',
  connectionStatus: 'connected',
  board: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }, { rank: 'Q', suit: 'd' }],
  totalPot: 225,
  seats: [
    { seatIndex: 0, occupied: true, playerId: 'p0', agentId: 'agent-a', ownerUserId: 'u0', adapterType: 'human', stack: 900, status: 'active', isButton: true, isCurrentActor: false, isMe: true, holeCards: [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }], position: 'top-left', displayName: 'agent-a' },
    { seatIndex: 1, occupied: true, playerId: 'p1', agentId: 'agent-b', ownerUserId: 'u1', adapterType: 'mock', stack: 1100, status: 'active', isButton: false, isCurrentActor: true, isMe: false, holeCards: [{ rank: '8', suit: 'c' }, { rank: '8', suit: 'd' }], position: 'top-right', displayName: 'agent-b' },
    { seatIndex: 2, occupied: false, playerId: null, agentId: null, ownerUserId: null, adapterType: null, stack: null, status: null, isButton: false, isCurrentActor: false, isMe: false, holeCards: null, position: 'right', displayName: 'Seat 2' },
  ],
  visibleHands: [
    { playerId: 'p0', label: 'agent-a', cards: [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }], cardStatus: 'visible' },
    { playerId: 'p1', label: 'agent-b', cards: [{ rank: '8', suit: 'c' }, { rank: '8', suit: 'd' }], cardStatus: 'visible' },
  ],
  actionLog: [{ id: '1', label: 'p1 raise 100' }],
  pendingAction: {
    handId: 'hand-1',
    requestId: 'req-1',
    legalActions: [{ type: 'fold' }, { type: 'call', callAmount: 50 }, { type: 'raise', minAmount: 100, maxAmount: 900 }],
    deadlineAt: 123,
    privateState: { playerId: 'p0', holeCards: [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }] },
  },
  canShowSeatControls: true,
};

describe('PokerTableSurface', () => {
  it('renders a felt table with occupied seats, visible cards, board, and pot', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={model}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('class="poker-table-layout"');
    expect(html).toContain('Demo Table');
    expect(html).toContain('agent-a');
    expect(html).toContain('agent-b');
    expect(html).toContain('A♣');
    expect(html).toContain('K♣');
    expect(html).toContain('8♣');
    expect(html).toContain('8♦');
    expect(html).toContain('A♠');
    expect(html).toContain('K♥');
    expect(html).toContain('Q♦');
    expect(html).toContain('Pot 225');
    expect(html).toContain('aria-label="Current actor"');
    expect(html).toContain('Visible Hands');
    expect(html).toContain('p1 raise 100');
  });

  it('renders human player legal actions from pending action state', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={model}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('Your Turn');
    expect(html).toContain('fold');
    expect(html).toContain('call 50');
    expect(html).toContain('raise');
    expect(html).toContain('min="100"');
    expect(html).toContain('max="900"');
  });
});
```

- [ ] **Step 2: Run component test and verify it fails**

Run:

```bash
pnpm --filter web run test -- src/__tests__/poker-table-surface.test.tsx
```

Expected: FAIL because `PokerTableSurface.tsx` does not exist.

- [ ] **Step 3: Implement `PlayerActionPanel`**

Create `apps/web/src/live-table/PlayerActionPanel.tsx`:

```tsx
import type { ActionType, LegalAction, PendingAction } from './liveTableTypes.js';
import { PlayingCard } from './PokerTableSurface.js';

export interface PlayerActionPanelProps {
  pendingAction: PendingAction | null;
  submitting: boolean;
  error: string | null;
  onSubmitAction: (actionType: ActionType, amount?: number) => void;
}

export function PlayerActionPanel({
  pendingAction,
  submitting,
  error,
  onSubmitAction,
}: PlayerActionPanelProps) {
  if (!pendingAction) return null;
  const sized = pendingAction.legalActions.find(action => action.type === 'raise' || action.type === 'bet');
  const defaultAmount = sized?.minAmount ?? 0;

  return (
    <section className="player-action-panel">
      <div>
        <h2>Your Turn</h2>
        <div className="mini-card-row">
          <PlayingCard card={pendingAction.privateState.holeCards[0]} />
          <PlayingCard card={pendingAction.privateState.holeCards[1]} />
        </div>
      </div>
      <div className="action-button-row">
        {pendingAction.legalActions.map(action => (
          <ActionButton
            action={action}
            disabled={submitting}
            key={action.type}
            onSubmitAction={onSubmitAction}
          />
        ))}
      </div>
      {sized ? (
        <form
          className="sized-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const amount = Number(new FormData(form).get('amount') ?? defaultAmount);
            onSubmitAction(sized.type, amount);
          }}
        >
          <label>
            {sized.type}
            <input
              name="amount"
              type="number"
              min={sized.minAmount ?? 1}
              max={sized.maxAmount}
              defaultValue={defaultAmount}
              disabled={submitting}
            />
          </label>
          <button disabled={submitting} type="submit">{sized.type}</button>
        </form>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
    </section>
  );
}

function ActionButton({
  action,
  disabled,
  onSubmitAction,
}: {
  action: LegalAction;
  disabled: boolean;
  onSubmitAction: (actionType: ActionType, amount?: number) => void;
}) {
  if (action.type === 'raise' || action.type === 'bet') return null;
  const amount = action.type === 'call' ? action.callAmount : action.type === 'all-in' ? action.maxAmount : undefined;
  return (
    <button disabled={disabled} onClick={() => onSubmitAction(action.type, amount)} type="button">
      {action.type}{amount ? ` ${amount}` : ''}
    </button>
  );
}
```

- [ ] **Step 4: Implement `SeatManagementPanel`**

Create `apps/web/src/live-table/SeatManagementPanel.tsx`:

```tsx
import type { PokerTableViewModel } from './buildPokerTableViewModel.js';

export interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
}

export interface SeatManagementPanelProps {
  model: PokerTableViewModel;
  myAgents: UserAgentConfigPublic[];
  busySeatIndex: number | null;
  onSitHuman: (seatIndex: number) => void;
  onSitAgent: (seatIndex: number, agentConfigId: string) => void;
}

export function SeatManagementPanel({
  model,
  myAgents,
  busySeatIndex,
  onSitHuman,
  onSitAgent,
}: SeatManagementPanelProps) {
  if (!model.canShowSeatControls) return null;
  const emptySeats = model.seats.filter(seat => !seat.occupied);
  if (emptySeats.length === 0) return null;

  return (
    <section className="seat-management-panel">
      <h2>Open Seats</h2>
      <div className="seat-management-grid">
        {emptySeats.map(seat => (
          <div className="seat-management-card" key={seat.seatIndex}>
            <strong>Seat {seat.seatIndex}</strong>
            <button disabled={busySeatIndex === seat.seatIndex} onClick={() => onSitHuman(seat.seatIndex)} type="button">
              Sit here
            </button>
            {myAgents.length > 0 ? (
              <select
                aria-label={`Sit agent at seat ${seat.seatIndex}`}
                disabled={busySeatIndex === seat.seatIndex}
                onChange={event => {
                  if (event.target.value) onSitAgent(seat.seatIndex, event.target.value);
                }}
                value=""
              >
                <option value="">Seat agent</option>
                {myAgents.map(agent => (
                  <option key={agent.agentConfigId} value={agent.agentConfigId}>{agent.agentName}</option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement `PokerTableSurface`**

Create `apps/web/src/live-table/PokerTableSurface.tsx`:

```tsx
import type { ActionType, Card } from './liveTableTypes.js';
import type { PokerTableSeatModel, PokerTableViewModel } from './buildPokerTableViewModel.js';
import { PlayerActionPanel } from './PlayerActionPanel.js';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set<Card['suit']>(['h', 'd']);

export interface PokerTableSurfaceProps {
  model: PokerTableViewModel;
  actionError: string | null;
  submittingAction: boolean;
  onSubmitAction: (actionType: ActionType, amount?: number) => void;
}

export function PokerTableSurface({
  model,
  actionError,
  submittingAction,
  onSubmitAction,
}: PokerTableSurfaceProps) {
  return (
    <div className="poker-table-layout">
      <section className="poker-stage" aria-label="Poker table">
        <div className="poker-table-header">
          <div>
            <h1>{model.title}</h1>
            <p className="muted">{model.subtitle}</p>
          </div>
          <span className="table-connection">{model.connectionStatus}</span>
        </div>
        <div className="poker-felt">
          {model.seats.map(seat => <PlayerSeatNode key={seat.seatIndex} seat={seat} />)}
          <div className="community-board" aria-label="Community cards">
            {model.board.length === 0 ? (
              <span className="card-back">Board</span>
            ) : (
              model.board.map((card, index) => <PlayingCard card={card} key={`${card.rank}${card.suit}:${index}`} />)
            )}
            <strong className="pot-display">Pot {model.totalPot}</strong>
          </div>
        </div>
        <PlayerActionPanel
          pendingAction={model.pendingAction}
          submitting={submittingAction}
          error={actionError}
          onSubmitAction={onSubmitAction}
        />
      </section>
      <aside className="live-side-rail">
        <section className="rail-card" aria-label="Current actor">
          <h2>Current Action</h2>
          <p>{model.seats.find(seat => seat.isCurrentActor)?.displayName ?? 'Waiting'}</p>
          <span className="muted">{model.phaseLabel}</span>
        </section>
        <section className="rail-card">
          <h2>Visible Hands</h2>
          {model.visibleHands.map(hand => (
            <div className="visible-hand-row" key={hand.playerId}>
              <strong>{hand.label}</strong>
              <div className="mini-card-row">
                {hand.cards ? (
                  <>
                    <PlayingCard card={hand.cards[0]} />
                    <PlayingCard card={hand.cards[1]} />
                  </>
                ) : (
                  <span className="muted">{hand.cardStatus}</span>
                )}
              </div>
            </div>
          ))}
        </section>
        <section className="rail-card">
          <h2>Live Log</h2>
          <ol className="live-log-list">
            {model.actionLog.length === 0 ? <li className="muted">No actions yet.</li> : null}
            {model.actionLog.map(entry => <li key={entry.id}>{entry.label}</li>)}
          </ol>
        </section>
      </aside>
    </div>
  );
}

export function PlayingCard({ card }: { card: Card }) {
  return (
    <span className={`playing-card ${RED_SUITS.has(card.suit) ? 'is-red' : 'is-dark'}`}>
      {card.rank}{SUIT_GLYPH[card.suit]}
    </span>
  );
}

function PlayerSeatNode({ seat }: { seat: PokerTableSeatModel }) {
  return (
    <article className={`player-seat seat-${seat.position}${seat.isCurrentActor ? ' is-actor' : ''}`}>
      <div className="seat-topline">
        <strong>{seat.displayName}</strong>
        {seat.isButton ? <span className="dealer-button">D</span> : null}
      </div>
      {seat.occupied ? (
        <>
          <span className="muted">Seat {seat.seatIndex} · {seat.adapterType}</span>
          <span>{seat.stack ?? 0} chips</span>
          <div className="mini-card-row">
            {seat.holeCards ? (
              <>
                <PlayingCard card={seat.holeCards[0]} />
                <PlayingCard card={seat.holeCards[1]} />
              </>
            ) : (
              <>
                <span className="card-back">?</span>
                <span className="card-back">?</span>
              </>
            )}
          </div>
        </>
      ) : (
        <span className="muted">Open seat</span>
      )}
    </article>
  );
}
```

- [ ] **Step 6: Add poker table styles**

Append this CSS to `apps/web/src/styles.css`:

```css
.poker-table-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  gap: 16px;
  align-items: start;
}

.poker-stage {
  min-width: 0;
}

.poker-table-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.poker-table-header h1 {
  margin: 0;
}

.table-connection {
  border: 1px solid #c6d3df;
  border-radius: 999px;
  padding: 5px 10px;
  color: #264156;
  background: #f4f8fb;
  font-size: 12px;
  font-weight: 700;
}

.poker-felt {
  position: relative;
  min-height: 520px;
  border-radius: 18px;
  background: linear-gradient(145deg, #101820, #17212a);
  overflow: hidden;
  border: 1px solid #273748;
}

.poker-felt::before {
  content: "";
  position: absolute;
  left: 9%;
  right: 9%;
  top: 18%;
  bottom: 18%;
  border-radius: 999px;
  background: #136b4d;
  border: 12px solid #7b562d;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.12), 0 24px 44px rgba(0,0,0,.35);
}

.community-board {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 280px;
  min-height: 86px;
}

.pot-display {
  position: absolute;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 999px;
  background: #d6a13a;
  color: #1f1606;
  padding: 5px 14px;
  white-space: nowrap;
}

.player-seat {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: 4px;
  width: 168px;
  min-height: 110px;
  padding: 10px;
  border: 1px solid #35495a;
  border-radius: 10px;
  background: #1d2b36;
  color: #edf4f8;
  box-shadow: 0 12px 26px rgba(0,0,0,.26);
}

.player-seat.is-actor {
  border-color: #e1b34d;
  box-shadow: 0 0 0 3px rgba(225,179,77,.28), 0 12px 26px rgba(0,0,0,.28);
}

.seat-topline {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.dealer-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #f4efe5;
  color: #251b10;
  font-weight: 800;
}

.seat-top-left { left: 24%; top: 18px; }
.seat-top-right { right: 24%; top: 18px; }
.seat-right { right: 18px; top: 205px; }
.seat-bottom-right { right: 24%; bottom: 18px; }
.seat-bottom-left { left: 24%; bottom: 18px; }
.seat-left { left: 18px; top: 205px; }

.playing-card,
.card-back {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 38px;
  height: 52px;
  border-radius: 6px;
  border: 1px solid #d7dde4;
  background: #fffdf8;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.playing-card.is-red {
  color: #b41f35;
}

.playing-card.is-dark {
  color: #15191d;
}

.card-back {
  background: repeating-linear-gradient(45deg, #28415a, #28415a 4px, #1d3147 4px, #1d3147 8px);
  color: #dce7ef;
}

.mini-card-row {
  display: flex;
  gap: 5px;
  align-items: center;
}

.live-side-rail {
  display: grid;
  gap: 12px;
}

.rail-card,
.player-action-panel,
.seat-management-panel {
  border: 1px solid #d8dee6;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.rail-card h2,
.player-action-panel h2,
.seat-management-panel h2 {
  margin: 0 0 10px;
  font-size: 16px;
}

.visible-hand-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid #eef1f4;
}

.live-log-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.player-action-panel {
  margin-top: 12px;
  display: grid;
  gap: 12px;
}

.action-button-row,
.sized-action-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
}

.sized-action-form label {
  max-width: 160px;
}

.seat-management-panel {
  margin-top: 12px;
}

.seat-management-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.seat-management-card {
  display: grid;
  gap: 8px;
  border: 1px solid #e4e8ee;
  border-radius: 8px;
  padding: 10px;
}

@media (max-width: 900px) {
  .poker-table-layout {
    grid-template-columns: 1fr;
  }

  .poker-felt {
    min-height: 560px;
  }

  .live-side-rail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .poker-felt {
    min-height: 720px;
  }

  .player-seat {
    width: 150px;
  }

  .seat-top-left,
  .seat-top-right,
  .seat-right,
  .seat-bottom-right,
  .seat-bottom-left,
  .seat-left {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }

  .seat-top-left { top: 14px; }
  .seat-top-right { top: 134px; }
  .seat-right { top: 254px; }
  .seat-bottom-right { top: 374px; bottom: auto; }
  .seat-bottom-left { top: 494px; bottom: auto; }
  .seat-left { top: 614px; }

  .community-board {
    top: 48%;
  }
}
```

- [ ] **Step 7: Run component test**

Run:

```bash
pnpm --filter web run test -- src/__tests__/poker-table-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI components**

Run:

```bash
git add apps/web/src/live-table/PokerTableSurface.tsx apps/web/src/live-table/PlayerActionPanel.tsx apps/web/src/live-table/SeatManagementPanel.tsx apps/web/src/__tests__/poker-table-surface.test.tsx apps/web/src/styles.css
git commit -m "Add poker table surface components"
```

---

### Task 5: Route Integration In `TablePage`

**Files:**
- Modify: `apps/web/src/pages/TablePage.tsx`
- Modify: `apps/web/src/lib/ws.ts`

- [ ] **Step 1: Add websocket connection status callbacks**

Modify `apps/web/src/lib/ws.ts` so `WsClient` exposes connection status
listeners. Add this type near `type Listener`:

```ts
type StatusListener = (status: 'connecting' | 'connected' | 'reconnecting' | 'closed') => void;
```

Add this property to the class:

```ts
  private readonly statusListeners = new Set<StatusListener>();
```

In `connect()`, before creating `new WebSocket`, add:

```ts
    this.emitStatus(this.ws ? 'reconnecting' : 'connecting');
```

In `ws.onopen`, before resubscribing topics, add:

```ts
      this.emitStatus('connected');
```

In `scheduleReconnect()`, before setting the timer, add:

```ts
    this.emitStatus('reconnecting');
```

Add this public method:

```ts
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }
```

Add this private method:

```ts
  private emitStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'closed'): void {
    for (const listener of this.statusListeners) listener(status);
  }
```

In `close()`, after `this.closed = true`, add:

```ts
    this.emitStatus('closed');
```

- [ ] **Step 2: Refactor `TablePage` imports**

In `apps/web/src/pages/TablePage.tsx`, replace the `CardView` function and
local seat-grid presentation components with imports from the live-table
modules. Keep local API-facing types that are still needed for forms.

Add these imports:

```ts
import { buildPokerTableViewModel } from '../live-table/buildPokerTableViewModel.js';
import { createInitialLiveTableState, liveTableReducer } from '../live-table/liveTableReducer.js';
import { normalizeLiveTableEvent } from '../live-table/normalizeLiveTableEvent.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel } from '../live-table/SeatManagementPanel.js';
import type { ActionType, LiveTableEvent, TableSnapshot } from '../live-table/liveTableTypes.js';
```

- [ ] **Step 3: Replace scattered display state with reducer state**

Inside `TablePage`, replace these state declarations:

```ts
  const [phase, setPhase] = useState<HandPhase | null>(null);
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [pots, setPots] = useState<Array<{ amount: number }>>([]);
  const [currentActorPlayerId, setCurrentActorPlayerId] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const [myHoleCards, setMyHoleCards] = useState<[Card, Card] | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
```

with:

```ts
  const [liveState, dispatchLive] = useState(createInitialLiveTableState);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [busySeatIndex, setBusySeatIndex] = useState<number | null>(null);
```

Add this helper in the component:

```ts
  const dispatch = useCallback((event: LiveTableEvent) => {
    dispatchLive(current => liveTableReducer(current, event));
  }, []);
```

- [ ] **Step 4: Dispatch snapshots from `refreshTable`**

In `refreshTable`, after `setTable(data);`, add:

```ts
      dispatch({
        type: 'snapshot.loaded',
        table: data as TableSnapshot,
        meUserId: user?.userId ?? null,
      });
```

Update `refreshTable` dependencies to include `dispatch` and `user?.userId`.

- [ ] **Step 5: Replace websocket switch with normalized events**

Replace the body of the websocket message callback with:

```ts
      if (!m.topic.endsWith(tableId)) return;

      switch (m.type) {
        case 'table.player_seated':
        case 'table.player_left':
        case 'table.viewer_joined':
        case 'table.viewer_left':
          void refreshTable();
          return;
        default:
          break;
      }

      const normalized = normalizeLiveTableEvent(m);
      if (normalized) {
        dispatch(normalized);
        if (normalized.type === 'hand.completed') void refreshTable();
      }
```

After `ws.subscribe(...)`, subscribe to status:

```ts
    const offStatus = ws.onStatus(status => dispatch({ type: 'connection.changed', status }));
```

Update cleanup:

```ts
    return () => { off(); offStatus(); ws.close(); };
```

- [ ] **Step 6: Add action and seating handlers**

Add these handlers inside `TablePage`:

```ts
  const submitAction = useCallback(async (actionType: ActionType, amount?: number) => {
    if (!tableId || !liveState.pendingAction) return;
    setSubmittingAction(true);
    setActionError(null);
    try {
      await api.post(`/tables/${tableId}/actions`, {
        handId: liveState.pendingAction.handId,
        actionType,
        ...(amount !== undefined ? { amount } : {}),
      });
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to submit action');
    } finally {
      setSubmittingAction(false);
    }
  }, [liveState.pendingAction, tableId]);

  const sitHuman = useCallback(async (seatIndex: number) => {
    if (!tableId) return;
    setBusySeatIndex(seatIndex);
    try {
      await api.post(`/tables/${tableId}/seats`, { seatIndex, buyIn: 1000 });
      await refreshTable();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to sit');
    } finally {
      setBusySeatIndex(null);
    }
  }, [refreshTable, tableId]);

  const sitAgent = useCallback(async (seatIndex: number, agentConfigId: string) => {
    if (!tableId) return;
    setBusySeatIndex(seatIndex);
    try {
      await api.post(`/tables/${tableId}/seats/agent`, { seatIndex, buyIn: 1000, agentConfigId });
      await refreshTable();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to seat agent');
    } finally {
      setBusySeatIndex(null);
    }
  }, [refreshTable, tableId]);
```

- [ ] **Step 7: Replace the rendered seat grid with the poker surface**

After `const seatable = table.status === 'preparing' || table.status === 'paused';`,
add:

```ts
  const tableModel = buildPokerTableViewModel(liveState, { seatable });
```

Replace the old `CommunityRow`, `SeatGrid`, `pendingAction`, and `ActionLog`
rendered sections with:

```tsx
      <PokerTableSurface
        model={tableModel}
        actionError={actionError}
        submittingAction={submittingAction}
        onSubmitAction={submitAction}
      />

      <SeatManagementPanel
        model={tableModel}
        myAgents={myAgents}
        busySeatIndex={busySeatIndex}
        onSitHuman={sitHuman}
        onSitAgent={sitAgent}
      />
```

Keep `SeatControls` and `StartHandButton` for the first pass, rendering them
below the new surface.

Remove unused local functions after TypeScript reports them unused:

- `CardView`
- `CommunityRow`
- `SeatGrid`
- `SeatBody`
- `SeatEmpty`
- `ActionPanel`
- `ActionLog`

- [ ] **Step 8: Run focused web tests and lint**

Run:

```bash
pnpm --filter web run test -- src/__tests__/poker-table-surface.test.tsx src/live-table/__tests__/liveTableReducer.test.ts src/live-table/__tests__/buildPokerTableViewModel.test.ts
pnpm lint
```

Expected: PASS. If lint reports unused local types in `TablePage.tsx`, remove
the unused type definitions after confirming they are not referenced.

- [ ] **Step 9: Commit route integration**

Run:

```bash
git add apps/web/src/pages/TablePage.tsx apps/web/src/lib/ws.ts
git commit -m "Wire live poker table into table page"
```

---

### Task 6: End-To-End Verification And Polish

**Files:**
- Modify only files touched by previous tasks if verification finds issues.

- [ ] **Step 1: Run focused backend verification**

Run:

```bash
pnpm --filter api run test -- src/__tests__/ws.test.ts src/__tests__/matches.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused frontend verification**

Run:

```bash
pnpm --filter web run test -- src/live-table/__tests__/liveTableReducer.test.ts src/live-table/__tests__/buildPokerTableViewModel.test.ts src/__tests__/poker-table-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full repository verification**

Run:

```bash
pnpm build
pnpm lint
pnpm test
```

Expected: PASS. If `pnpm test` fails inside the sandbox with `listen EPERM`,
rerun `pnpm test` with escalated permissions because websocket tests bind
`127.0.0.1`.

- [ ] **Step 4: Manual smoke test**

Start the app:

```bash
pnpm dev:api
pnpm --filter web dev -- --host 127.0.0.1
```

Open:

```text
http://localhost:5173/lobby
```

Manual flow:

1. Register or log in.
2. Create a table with up to six seats.
3. Seat at least two mock agents or one human plus one mock agent.
4. Open the table page.
5. Start a hand.
6. Confirm the felt table renders seats around the table.
7. Confirm every occupied seat shows two hole cards after the hand starts.
8. Confirm the side rail shows visible hands and live log events.
9. If using a human seat, confirm the action panel appears only for the human player's pending action.

- [ ] **Step 5: Commit polish fixes**

If Step 3 or Step 4 requires fixes, commit them:

```bash
git add apps/api/src/__tests__/ws.test.ts packages/table-orchestrator/src/orchestrator.ts apps/web/src/live-table apps/web/src/pages/TablePage.tsx apps/web/src/lib/ws.ts apps/web/src/styles.css
git commit -m "Polish live poker table presentation"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Backend realtime reveal event: Task 1.
  - Preserve durable artifact privacy: Task 1 focused `matches.test.ts` verification.
  - Client reducer and event normalization: Task 2.
  - Poker table view model: Task 3.
  - Poker table, side rail, action panel, seat controls: Task 4.
  - `/tables/:tableId` route integration: Task 5.
  - Verification and manual smoke: Task 6.
- Type consistency:
  - `table.hole_cards_revealed` is the event name in backend, reducer, normalizer, and tests.
  - `holeCards` uses `[Card, Card]` throughout frontend types and event payloads.
  - `pendingAction` remains sourced only from `seat.action_requested`.
- Scope control:
  - Replay route reuse is deferred to a later adapter.
  - The poker engine is not reimplemented in the browser.
  - First visual layout targets 2-6 seats.
