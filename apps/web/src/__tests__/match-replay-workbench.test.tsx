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
  data: {
    actionId: 'action-1',
    phase: 'preflop',
    holeCards: ['AS', 'KS'],
    rawChainOfThought: 'secret',
    keyObservations: ['secret'],
    consideredActions: [{ reason: 'secret' }],
  },
}];

describe('ReplayWorkbench', () => {
  it('renders hand rail, public board, action timeline, and inspector', () => {
    const html = renderToStaticMarkup(
      <ReplayWorkbench
        hands={[hand]}
        replayEvents={replayEvents}
        finalStacks={{ 'bot-a': 950, 'bot-b': 1150 }}
        selectedHandId="hand-1"
        selectedActionId="hand-1:0"
        replayLoading={false}
        replayError={null}
        onSelectHand={() => undefined}
        onSelectAction={() => undefined}
      />,
    );

    expect(html).toContain('Replay Workbench');
    expect(html).toContain('aria-label="Replay controls"');
    expect(html).toContain('Previous');
    expect(html).toContain('Play');
    expect(html).toContain('Next');
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Action position"');
    expect(html).toContain('Street filter');
    expect(html).toContain('aria-pressed="true" class="street-filter-button"');
    expect(html).toContain('aria-label="Final stacks"');
    expect(html).toContain('aria-label="Hands"');
    expect(html).toContain('aria-label="Community cards"');
    expect(html).toContain('Hand 1');
    expect(html).toContain('3 board cards');
    expect(html).toContain('biggest net 150');
    expect(html).toContain('AS');
    expect(html).toContain('KH');
    expect(html).toContain('QD');
    expect(html).toContain('bot-b');
    expect(html).toContain('raise');
    expect(html).toContain('150');
    expect(html).toContain('Selected Action');
    expect(html).toContain('aria-pressed="true" class="timeline-row"');
    expect(html).toContain('<div><dt>Player</dt><dd>bot-a</dd></div>');
    expect(html).toContain('<div><dt>Action</dt><dd>call</dd></div>');
    expect(html).toContain('<div><dt>Amount</dt><dd>50</dd></div>');
    expect(html).toContain('<div><dt>Street</dt><dd>preflop</dd></div>');
    expect(html).toContain('<div><dt>Event</dt><dd>event-1</dd></div>');
    expect(html).toContain('Only aggregate analysis is available for this action.');
    expect(html).not.toContain('holeCards');
    expect(html).not.toContain('rawChainOfThought');
    expect(html).not.toContain('keyObservations');
    expect(html).not.toContain('consideredActions');
    expect(html).not.toContain('secret');
  });

  it('falls back to the first action when selection is empty or stale', () => {
    const zeroAmountHand: HandSummary = {
      ...hand,
      allActions: [
        {
          ...hand.allActions[0]!,
          actionType: 'check',
          amount: 0,
        },
        hand.allActions[1]!,
      ],
    };

    for (const selectedActionId of [null, 'stale-action']) {
      const html = renderToStaticMarkup(
        <ReplayWorkbench
          hands={[zeroAmountHand]}
          replayEvents={replayEvents}
          finalStacks={{ 'bot-a': 950, 'bot-b': 1150 }}
          selectedHandId="hand-1"
          selectedActionId={selectedActionId}
          replayLoading={false}
          replayError={null}
          onSelectHand={() => undefined}
          onSelectAction={() => undefined}
        />,
      );

      expect(html).toContain('aria-pressed="true" class="timeline-row"');
      expect(html).toContain(
        '<span>1</span><strong>bot-a</strong><span>check</span><span></span><span>preflop</span>',
      );
      expect(html).toContain('<div><dt>Player</dt><dd>bot-a</dd></div>');
      expect(html).toContain('<div><dt>Action</dt><dd>check</dd></div>');
      expect(html).toContain('<div><dt>Amount</dt><dd>n/a</dd></div>');
      expect(html).toContain('<div><dt>Event</dt><dd>event-1</dd></div>');
    }
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
