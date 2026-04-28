import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  TableHandHistoryPanel,
  TableLifecycleControls,
  type TablePublicHandSummary,
} from '../pages/TablePage.js';

const noop = () => undefined;

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

const hand: TablePublicHandSummary = {
  handId: 'hand-007',
  tableId: 'table-1',
  handNumber: 7,
  seed: 'seed-7',
  startedAt: 1_777_280_000_000,
  completedAt: 1_777_280_001_000,
  players: [
    {
      playerId: 'player-a',
      agentId: 'agent-a',
      seatIndex: 0,
      stackBefore: 1000,
      stackAfter: 850,
      holeCards: [{ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' }],
      handEvaluation: { rank: 'pair' },
    } as unknown as TablePublicHandSummary['players'][number],
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
    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('handEvaluation');
  });
});
