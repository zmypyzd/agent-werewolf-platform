import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel } from '../live-table/SeatManagementPanel.js';
import type { PokerTableViewModel, SeatPosition } from '../live-table/buildPokerTableViewModel.js';

const seatPositions: SeatPosition[] = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'center-left',
];

const model: PokerTableViewModel = {
  title: 'Demo Table',
  subtitle: 'hand hand-1 · flop · blinds 25/50',
  phaseLabel: 'flop',
  connectionStatus: 'connected',
  board: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  totalPot: 225,
  seats: seatPositions.map((position, seatIndex) => {
    const occupied = seatIndex === 0 || seatIndex === 1 || seatIndex === 5;

    return {
      seatIndex,
      occupied,
      playerId: occupied ? `p${seatIndex}` : null,
      agentId: occupied ? `agent-${seatIndex}` : null,
      ownerUserId: occupied ? `u${seatIndex}` : null,
      adapterType: occupied ? (seatIndex === 0 ? 'human' : 'mock') : null,
      stack: occupied ? 900 + seatIndex * 100 : null,
      status: occupied ? 'active' : null,
      isButton: seatIndex === 0,
      isCurrentActor: seatIndex === 1,
      isMe: seatIndex === 0,
      holeCards:
        seatIndex === 0
          ? [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }]
          : seatIndex === 1
            ? [{ rank: '8', suit: 'c' }, { rank: '8', suit: 'd' }]
            : null,
      position,
      displayName: occupied ? `agent-${seatIndex}` : `Seat ${seatIndex + 1}`,
    };
  }),
  visibleHands: [
    {
      playerId: 'p0',
      label: 'agent-0',
      cards: [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }],
      cardStatus: 'visible',
    },
    {
      playerId: 'p1',
      label: 'agent-1',
      cards: [{ rank: '8', suit: 'c' }, { rank: '8', suit: 'd' }],
      cardStatus: 'visible',
    },
    {
      playerId: 'p5',
      label: 'agent-5',
      cards: null,
      cardStatus: 'cards pending',
    },
  ],
  actionLog: [{ id: '1', label: 'p1 raise 100' }],
  pendingAction: {
    handId: 'hand-1',
    requestId: 'req-1',
    legalActions: [
      { type: 'fold' },
      { type: 'call', callAmount: 50 },
      { type: 'raise', minAmount: 100, maxAmount: 900 },
    ],
    deadlineAt: 123,
    privateState: {
      playerId: 'p0',
      holeCards: [{ rank: 'A', suit: 'c' }, { rank: 'K', suit: 'c' }],
    },
  },
  canShowSeatControls: true,
};

describe('PokerTableSurface', () => {
  it('renders a felt table with occupied seats, visible cards, board, pot, actor, hands, and live log', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={model}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('class="poker-table-layout"');
    expect(html).toContain('aria-label="Poker table"');
    expect(html).toContain('Demo Table');
    expect(html).toContain('agent-0');
    expect(html).toContain('agent-1');
    expect(html).toContain('Seat 4');
    expect(html).toContain('A♣');
    expect(html).toContain('K♣');
    expect(html).toContain('8♣');
    expect(html).toContain('8♦');
    expect(html).toContain('A♠');
    expect(html).toContain('K♥');
    expect(html).toContain('Q♦');
    expect(html).toContain('Pot 225');
    expect(html).toContain('aria-label="Current actor"');
    expect(html).toContain('agent-1');
    expect(html).toContain('Visible Hands');
    expect(html).toContain('cards pending');
    expect(html).toContain('Live Log');
    expect(html).toContain('p1 raise 100');

    for (const position of seatPositions) {
      expect(html).toContain(`seat-${position}`);
    }
  });

  it('renders human player legal actions with a sized amount input', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={model}
        actionError="Need a valid raise amount"
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('Your Turn');
    expect(html).toContain('fold');
    expect(html).toContain('call 50');
    expect(html).toContain('raise');
    expect(html).toContain('name="amount"');
    expect(html).toContain('min="100"');
    expect(html).toContain('max="900"');
    expect(html).toContain('value="100"');
    expect(html).toContain('Need a valid raise amount');
  });

  it('renders open seat controls for human and configured agents', () => {
    const html = renderToStaticMarkup(
      <SeatManagementPanel
        model={model}
        myAgents={[{ agentConfigId: 'cfg-1', agentName: 'Range Bot', endpointUrl: 'https://bot.test' }]}
        busySeatIndex={3}
        onSitHuman={() => undefined}
        onSitAgent={() => undefined}
      />,
    );

    expect(html).toContain('Open Seats');
    expect(html).toContain('Seat 4');
    expect(html).toContain('Sit here');
    expect(html).toContain('Sit agent at seat 3');
    expect(html).toContain('Range Bot');
    expect(html).toContain('disabled=""');
  });
});
