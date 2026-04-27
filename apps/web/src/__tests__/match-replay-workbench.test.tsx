import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HandSummary, ReplayEvent } from '../lib/matchArtifacts.js';
import { ReplayWorkbench } from '../pages/MatchReplayWorkbench.js';

const hand: HandSummary = {
  handId: 'hand-1',
  tableId: 'tbl-1',
  handNumber: 1,
  seed: 'seed-1',
  startedAt: 1,
  completedAt: 100,
  players: [
    { playerId: 'bot-a', agentId: 'agent-a', seatIndex: 0, stackBefore: 1000, stackAfter: 950 },
    { playerId: 'bot-b', agentId: 'agent-b', seatIndex: 1, stackBefore: 1000, stackAfter: 1150 },
  ],
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  communityCards: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  allActions: [
    {
      actionId: 'action-1',
      handId: 'hand-1',
      playerId: 'bot-a',
      phase: 'preflop',
      actionType: 'call',
      amount: 50,
      stackAfter: 950,
      sequence: 0,
      timestamp: 10,
    },
    {
      actionId: 'action-2',
      handId: 'hand-1',
      playerId: 'bot-b',
      phase: 'flop',
      actionType: 'raise',
      amount: 150,
      stackAfter: 1150,
      sequence: 1,
      timestamp: 20,
    },
  ],
  results: [
    { playerId: 'bot-a', seatIndex: 0, potIndex: 0, winAmount: 0, netChange: -50 },
    { playerId: 'bot-b', seatIndex: 1, potIndex: 0, winAmount: 200, netChange: 150 },
  ],
  finalPots: [{ amount: 200, eligiblePlayerIds: ['bot-b'] }],
};

const replayEvents: ReplayEvent[] = [{
  eventId: 'event-1',
  handId: 'hand-1',
  tableId: 'tbl-1',
  sequence: 1,
  eventType: 'action.applied',
  timestamp: 1,
  data: { actionId: 'action-1', phase: 'preflop' },
}];

describe('ReplayWorkbench', () => {
  it('renders hand rail, public board, action timeline, and inspector', () => {
    const html = renderToStaticMarkup(
      <ReplayWorkbench
        hands={[hand]}
        replayEvents={replayEvents}
        finalStacks={{ 'bot-a': 950, 'bot-b': 1150 }}
        selectedHandId="hand-1"
        selectedActionId="hand-1:1"
        replayLoading={false}
        replayError={null}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />,
    );

    expect(html).toContain('Replay Workbench');
    expect(html).toContain('Hand 1');
    expect(html).toContain('AS');
    expect(html).toContain('KH');
    expect(html).toContain('QD');
    expect(html).toContain('bot-b');
    expect(html).toContain('raise');
    expect(html).toContain('150');
    expect(html).toContain('Selected Action');
    expect(html).toContain('Only aggregate analysis is available for this action.');
  });

  it('renders explicit empty states without private surfaces', () => {
    const html = renderToStaticMarkup(
      <ReplayWorkbench
        hands={[]}
        replayEvents={[]}
        finalStacks={{}}
        selectedHandId={null}
        selectedActionId={null}
        replayLoading={false}
        replayError={null}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />,
    );

    expect(html).toContain('No hands recorded.');
    expect(html).toContain('No hand selected.');
    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
  });
});
