import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectTablePageWebSocket,
  deleteTableForPage,
  loadTableHandHistoryForPage,
  loadTableSnapshotForPage,
  TableHandHistoryPanel,
  TableLifecycleControls,
  unwatchTableForPage,
  watchTableForPage,
  type TablePageApiClient,
  type TablePublicHandSummary,
  type TablePublicHandPlayerSummary,
} from '../pages/TablePage.js';
import type { WsMessage } from '../lib/ws.js';
import type { LiveTableEvent, TableSnapshot } from '../live-table/liveTableTypes.js';

const noop = () => undefined;

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderLifecycleControls(
  props: Partial<Parameters<typeof TableLifecycleControls>[0]> = {},
): string {
  return renderToStaticMarkup(
    <TableLifecycleControls
      canManage={false}
      isWatching={false}
      busy={false}
      error={null}
      deleteConfirmOpen={false}
      deleteBusy={false}
      deleteError={null}
      onWatch={noop}
      onUnwatch={noop}
      onRequestDelete={noop}
      onCancelDelete={noop}
      onConfirmDelete={noop}
      {...props}
    />,
  );
}

type PublicPlayerPrivateFieldGuard = {
  holeCards: 'holeCards' extends keyof TablePublicHandPlayerSummary ? true : false;
  handEvaluation: 'handEvaluation' extends keyof TablePublicHandPlayerSummary ? true : false;
};

const publicPlayerPrivateFieldGuard = {
  holeCards: false,
  handEvaluation: false,
} satisfies PublicPlayerPrivateFieldGuard;

const unsafeRuntimePlayer = {
  playerId: 'player-a',
  agentId: 'agent-a',
  seatIndex: 0,
  stackBefore: 1000,
  stackAfter: 850,
  holeCards: 'PRIVATE_HOLE_CARD_SENTINEL',
  handEvaluation: 'PRIVATE_EVALUATION_SENTINEL',
};

const hand: TablePublicHandSummary = {
  handId: 'hand-007',
  tableId: 'table-1',
  handNumber: 7,
  seed: 'seed-7',
  startedAt: 1_777_280_000_000,
  completedAt: 1_777_280_001_000,
  players: [
    unsafeRuntimePlayer,
  ],
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  communityCards: [
    { rank: '2', suit: 'c' },
    { rank: '7', suit: 'd' },
    { rank: 'T', suit: 'h' },
    { rank: 'K', suit: 's' },
  ],
  allActions: [
    {
      actionId: 'a-1',
      handId: 'hand-007',
      playerId: 'player-a',
      phase: 'preflop',
      actionType: 'call',
      amount: 50,
      stackAfter: 950,
      sequence: 1,
      timestamp: 1_777_280_000_100,
    },
    {
      actionId: 'a-2',
      handId: 'hand-007',
      playerId: 'player-b',
      phase: 'flop',
      actionType: 'bet',
      amount: 100,
      stackAfter: 900,
      sequence: 2,
      timestamp: 1_777_280_000_200,
    },
  ],
  results: [
    { playerId: 'player-a', seatIndex: 0, potIndex: 0, winAmount: 0, netChange: -150 },
    { playerId: 'player-b', seatIndex: 1, potIndex: 0, winAmount: 300, netChange: 150 },
  ],
  finalPots: [{ amount: 300, eligiblePlayerIds: ['player-a', 'player-b'] }],
};

const table: TableSnapshot = {
  tableId: 'table-1',
  config: {
    name: 'Runtime Table',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    defaultTimeoutMs: 5000,
  },
  status: 'preparing',
  seats: [null, null, null, null, null, null],
  currentHandId: null,
  handNumber: 0,
  button: 0,
  canManage: true,
};

function createApiClient(overrides: Partial<TablePageApiClient> = {}): TablePageApiClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === '/tables/table-1/hands') return [hand];
      if (path === '/tables/table-1') return table;
      throw new Error(`Unexpected GET ${path}`);
    }),
    post: vi.fn(async () => undefined),
    del: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('TableLifecycleControls', () => {
  it('renders watch and unwatch buttons based on watch state', () => {
    const watchHtml = renderLifecycleControls({ isWatching: false });
    expect(watchHtml).toContain('>Watch table</button>');
    expect(watchHtml).not.toContain('>Unwatch table</button>');

    const unwatchHtml = renderLifecycleControls({ isWatching: true });
    expect(unwatchHtml).toContain('>Unwatch table</button>');
    expect(unwatchHtml).not.toContain('>Watch table</button>');
  });

  it('only renders delete controls when the table can be managed', () => {
    expect(renderLifecycleControls({ canManage: false })).not.toContain('Close table');

    const html = renderLifecycleControls({ canManage: true, deleteConfirmOpen: true });
    expect(html).toContain('Close table');
    expect(html).toContain('Close this table?');
    expect(html).toContain('Delete table');
  });
});

describe('TableHandHistoryPanel', () => {
  it('keeps private fields out of the public player summary type', () => {
    expect(publicPlayerPrivateFieldGuard).toEqual({
      holeCards: false,
      handEvaluation: false,
    });
  });

  it('renders public hand history rows without private card fields', () => {
    const html = renderToStaticMarkup(
      <TableHandHistoryPanel
        hands={[hand]}
        loading={false}
        error={null}
      />,
    );

    expect(html).toContain('Hand 7');
    expect(html).toContain('2 actions');
    expect(html).toContain('4 board cards');
    expect(html).toContain('Net +150');
    expect(html).not.toContain('PRIVATE_HOLE_CARD_SENTINEL');
    expect(html).not.toContain('PRIVATE_EVALUATION_SENTINEL');
  });
});

describe('TablePage runtime seams', () => {
  it('fetches the initial table and hands, then renders fetched hand history', async () => {
    const apiClient = createApiClient();
    const setTable = vi.fn();
    const dispatch = vi.fn();
    const setTableError = vi.fn();
    const setHandHistory = vi.fn();
    const setHandHistoryLoading = vi.fn();
    const setHandHistoryError = vi.fn();

    await loadTableSnapshotForPage({
      tableId: 'table-1',
      apiClient,
      meUserId: 'user-1',
      setTable,
      dispatch,
      setError: setTableError,
    });
    await loadTableHandHistoryForPage({
      tableId: 'table-1',
      apiClient,
      setHandHistory,
      setLoading: setHandHistoryLoading,
      setError: setHandHistoryError,
    });

    expect(apiClient.get).toHaveBeenCalledWith('/tables/table-1');
    expect(apiClient.get).toHaveBeenCalledWith('/tables/table-1/hands');
    expect(setTable).toHaveBeenCalledWith(table);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'snapshot.loaded',
      table,
      meUserId: 'user-1',
    });
    expect(setTableError).toHaveBeenCalledWith(null);
    expect(setHandHistory).toHaveBeenCalledWith([hand]);
    expect(setHandHistoryError).toHaveBeenCalledWith(null);

    const html = renderToStaticMarkup(
      <TableHandHistoryPanel
        hands={setHandHistory.mock.calls[0]![0] as TablePublicHandSummary[]}
        loading={false}
        error={null}
      />,
    );
    expect(html).toContain('Hand 7');
    expect(html).toContain('2 actions');
  });

  it('watches a table, updates local state, and refreshes the table', async () => {
    const apiClient = createApiClient();
    const setBusy = vi.fn();
    const setError = vi.fn();
    const setIsWatching = vi.fn();
    const refreshTable = vi.fn(async () => undefined);

    await watchTableForPage({
      tableId: 'table-1',
      apiClient,
      setBusy,
      setError,
      setIsWatching,
      refreshTable,
    });

    expect(apiClient.post).toHaveBeenCalledWith('/tables/table-1/watch');
    expect(setError).toHaveBeenCalledWith(null);
    expect(setIsWatching).toHaveBeenCalledWith(true);
    expect(refreshTable).toHaveBeenCalledTimes(1);
    expect(setBusy.mock.calls.map(call => call[0])).toEqual([true, false]);
  });

  it('unwatches a table and refreshes the table', async () => {
    const apiClient = createApiClient();
    const setBusy = vi.fn();
    const setError = vi.fn();
    const setIsWatching = vi.fn();
    const refreshTable = vi.fn(async () => undefined);

    await unwatchTableForPage({
      tableId: 'table-1',
      apiClient,
      setBusy,
      setError,
      setIsWatching,
      refreshTable,
    });

    expect(apiClient.del).toHaveBeenCalledWith('/tables/table-1/watch');
    expect(setError).toHaveBeenCalledWith(null);
    expect(setIsWatching).toHaveBeenCalledWith(false);
    expect(refreshTable).toHaveBeenCalledTimes(1);
    expect(setBusy.mock.calls.map(call => call[0])).toEqual([true, false]);
  });

  it('deletes an owner-managed table and navigates to the lobby', async () => {
    const apiClient = createApiClient();
    const setBusy = vi.fn();
    const setError = vi.fn();
    const navigate = vi.fn();

    await deleteTableForPage({
      tableId: 'table-1',
      apiClient,
      setBusy,
      setError,
      navigate,
    });

    expect(apiClient.del).toHaveBeenCalledWith('/tables/table-1');
    expect(setError).toHaveBeenCalledWith(null);
    expect(navigate).toHaveBeenCalledWith('/lobby');
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setBusy).not.toHaveBeenCalledWith(false);
  });

  it('refreshes hand history after a hand.completed websocket event', () => {
    vi.useFakeTimers();
    const wsEvents: { onMessage?: (message: WsMessage) => void } = {};
    const wsClient = {
      on: vi.fn((listener: (message: WsMessage) => void) => {
        wsEvents.onMessage = listener;
        return vi.fn();
      }),
      onStatus: vi.fn(() => vi.fn()),
      subscribe: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
    };
    const refreshTable = vi.fn();
    const refreshHandHistory = vi.fn();
    const dispatch = vi.fn<(event: LiveTableEvent) => void>();

    connectTablePageWebSocket({
      tableId: 'table-1',
      wsClient,
      meUserId: 'user-1',
      dispatch,
      refreshTable,
      refreshHandHistory,
      setIsWatching: vi.fn(),
    });

    expect(wsClient.subscribe).toHaveBeenCalledWith('table:table-1');
    expect(wsClient.connect).toHaveBeenCalledTimes(1);
    expect(wsEvents.onMessage).toBeDefined();
    wsEvents.onMessage!({ topic: 'table:table-1', type: 'hand.completed', payload: {} });
    expect(dispatch).toHaveBeenCalledWith({ type: 'hand.completed' });
    expect(refreshHandHistory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(refreshTable).toHaveBeenCalledTimes(1);
    expect(refreshHandHistory).toHaveBeenCalledTimes(1);
  });
});
