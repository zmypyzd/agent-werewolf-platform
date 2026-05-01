import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from '../lib/ws.js';
import {
  PlayerActionPanel,
  buildPresetAmounts,
  formatActionLabel,
  formatDeadline,
  validateSizedActionAmount,
} from '../live-table/PlayerActionPanel.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel, normalizeSeatBuyIn } from '../live-table/SeatManagementPanel.js';
import {
  buildAgentSeatRequestBody,
  buildHumanSeatRequestBody,
  isActionRequestLocked,
  refreshDelayForLiveEvent,
  seatDisplayNumber,
} from '../pages/TablePage.js';
import type { PokerTableViewModel, SeatPosition } from '../live-table/buildPokerTableViewModel.js';
import type { SeatAdapterType } from '../live-table/liveTableTypes.js';

const styles = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css'), 'utf8');

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
      identityLabel: occupied ? `agent-${seatIndex}` : `Seat ${seatIndex + 1}`,
      adapterLabel: occupied ? adapterLabelFor(seatIndex === 0 ? 'human' : 'mock') : null,
      isYou: seatIndex === 0,
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
      { type: 'all-in', maxAmount: 900 },
    ],
    deadlineAt: 123,
    privateState: {
      playerId: 'p0',
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

    expect(html).toContain('poker-table-layout');
    expect(html).toContain('poker-arena-shell');
    expect(html).toContain('aria-label="Poker table"');
    expect(html).toContain('arena-pot-chip');
    expect(html).toContain('Demo Table');
    expect(html).toContain('agent-0');
    expect(html).toContain('agent-1');
    expect(html).toContain('Seat 4');
    expect(html).toContain('Human');
    expect(html).toContain('Mock Agent');
    expect(html).toContain('You');
    expect(html).toContain('aria-label="Dealer"');
    expect(html).toContain('active');
    expect(html).toContain('class="seat-stack">900</span>');
    expect(html).toContain('A♣');
    expect(html).toContain('K♣');
    expect(html).toContain('8♣');
    expect(html).toContain('8♦');
    expect(html).toContain('aria-label="A♣"');
    expect(html).toContain('class="playing-card-index playing-card-index-top"');
    expect(html).toContain('class="playing-card-pip"');
    expect(html).toContain('class="playing-card-face"');
    expect(html).not.toContain('playing-card-face-rank');
    expect(html).toContain('class="playing-card-index playing-card-index-bottom"');
    expect(html).toContain('class="card-back-pattern"');
    expect(html).toContain('seat-card-row');
    expect(html).toContain('class="hero-hand-showcase"');
    expect(html).toContain('aria-label="Your poker hand"');
    expect(html).toContain('hero-hole-card-left');
    expect(html).toContain('hero-hole-card-right');
    expect(html).toContain('A♠');
    expect(html).toContain('K♥');
    expect(html).toContain('Q♦');
    expect(html).toContain('Pot 225');
    expect(html).toContain('class="arena-chip-stack"');
    expect(html).toContain('class="seat-wager"');
    expect(html).toContain('aria-label="agent-1 raise 100"');
    expect(html).toContain('class="seat-wager-action">raise</span>');
    expect(html).toContain('class="seat-wager-amount">100</strong>');
    expect(html).toContain('aria-label="Current actor"');
    expect(html).toContain('agent-1');
    expect(html).toContain('aria-label="Current player acting"');
    expect(html).toContain('seat-turn-indicator');
    expect(html).toContain('THINKING');
    expect(html).toContain('class="arena-side-tabs"');
    expect(html).toContain('Table Info');
    expect(html).toContain('Players');
    expect(html).toContain('Chat');
    expect(html).toContain('class="arena-rank-list"');
    expect(html).toContain('class="mobile-seat-dock"');
    expect(html).toContain('aria-label="Seat summary"');
    expect(html).toContain('Visible Hands');
    expect(html).toContain('cards pending');
    expect(html).toContain('Live Log');
    expect(html).toContain('p1 raise 100');

    for (const position of seatPositions) {
      expect(html).toContain(`seat-${position}`);
    }
  });

  it('anchors the current user at the bottom and distributes seats on the oval track', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={model}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );
    const seatMatches = [...html.matchAll(/<article class="(?<className>[^"]*player-seat[^"]*)" style="(?<style>[^"]*)">/g)];

    expect(seatMatches).toHaveLength(model.seats.length);
    expect(seatMatches[0]?.groups?.['className']).toContain('is-me');
    expect(seatMatches[0]?.groups?.['style']).toContain('--seat-x:50%');
    expect(seatMatches[0]?.groups?.['style']).toContain('--seat-y:86%');
    expect(seatMatches[0]?.groups?.['style']).toContain('--seat-wager-x:0px');
    expect(seatMatches[0]?.groups?.['style']).toContain('--seat-wager-y:-64px');
    expect(new Set(seatMatches.map(match => match.groups?.['style'])).size).toBe(model.seats.length);
  });

  it('shows muted sample card faces on an empty board so the table preview exposes the card design', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={{ ...model, board: [] }}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('community-card-row is-preview-board');
    expect(html).toContain('is-preview-card');
    expect(html).toContain('aria-label="A♠"');
    expect(html).toContain('aria-label="K♥"');
    expect(html).toContain('aria-label="Q♣"');
    expect(html).toContain('aria-label="J♦"');
    expect(html).toContain('aria-label="9♠"');
  });

  it('fans the current player hole cards as a natural overlapping hand', () => {
    const heroHandBlock = styles.slice(
      styles.indexOf('.hero-hand-showcase {'),
      styles.indexOf('.hero-hole-card-left {'),
    );
    const leftCardBlock = styles.slice(
      styles.indexOf('.hero-hole-card-left {'),
      styles.indexOf('.hero-hole-card-right {'),
    );
    const rightCardBlock = styles.slice(
      styles.indexOf('.hero-hole-card-right {'),
      styles.indexOf('.hero-hand-showcase .playing-card-index {'),
    );

    expect(declarationFor('.hero-hand-showcase', 'display', heroHandBlock)).toBe('block');
    expect(declarationFor('.hero-hand-showcase', 'width', heroHandBlock)).toBe('138px');
    expect(declarationFor('.hero-hand-showcase .playing-card', 'position', heroHandBlock)).toBe('absolute');
    expect(declarationFor('.hero-hand-showcase .playing-card', 'transform-origin', heroHandBlock)).toBe('50% 94%');
    expect(declarationFor('.hero-hole-card-left', 'transform', leftCardBlock)).toContain('translate(-73%, 4px) rotate(-7deg)');
    expect(declarationFor('.hero-hole-card-right', 'transform', rightCardBlock)).toContain('translate(-25%, 1px) rotate(6deg)');
  });

  it('emphasizes the current actor with a timer ring and pulsing seat state', () => {
    const actorSeatBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .player-seat.is-actor {'),
      styles.indexOf('.poker-arena-shell .player-seat.is-actor .seat-avatar {'),
    );
    const actorAvatarBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .player-seat.is-actor .seat-avatar {'),
      styles.indexOf('.poker-arena-shell .player-seat.is-actor .seat-avatar::before {'),
    );
    const actorAvatarRingBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .player-seat.is-actor .seat-avatar::before {'),
      styles.indexOf('.seat-turn-indicator {'),
    );
    const indicatorBlock = styles.slice(
      styles.indexOf('.seat-turn-indicator {'),
      styles.indexOf('@keyframes arenaSeatPulse'),
    );

    expect(declarationFor('.poker-arena-shell .player-seat.is-actor', 'animation', actorSeatBlock)).toContain('arenaSeatPulse');
    expect(declarationFor('.poker-arena-shell .player-seat.is-actor .seat-avatar', 'background', actorAvatarBlock)).toContain('conic-gradient');
    expect(declarationFor('.poker-arena-shell .player-seat.is-actor .seat-avatar::before', 'animation', actorAvatarRingBlock)).toContain('arenaTurnRing');
    expect(declarationFor('.seat-turn-indicator', 'position', indicatorBlock)).toBe('absolute');
    expect(styles).toContain('@keyframes arenaSeatPulse');
    expect(styles).toContain('@keyframes arenaTurnRing');
  });

  it('places recent player wager chips near the matching seat from the action log', () => {
    const html = renderToStaticMarkup(
      <PokerTableSurface
        model={{
          ...model,
          actionLog: [
            { id: '1', label: 'p0 call 50 (pot 75)' },
            { id: '2', label: 'agent-1 raise 100 (pot 175)' },
            { id: '3', label: 'unknown raise 500' },
          ],
        }}
        actionError={null}
        submittingAction={false}
        onSubmitAction={() => undefined}
      />,
    );
    const wagerMatches = [...html.matchAll(/class="seat-wager"/g)];

    expect(wagerMatches).toHaveLength(2);
    expect(html).toContain('aria-label="agent-0 call 50"');
    expect(html).toContain('aria-label="agent-1 raise 100"');
    expect(html).not.toContain('aria-label="unknown raise 500"');
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
    expect(html).toContain('arena-action-console');
    expect(html).toContain('arena-direct-actions');
    expect(html).toContain('Fold');
    expect(html).toContain('Call 50');
    expect(html).toContain('Raise');
    expect(html).toContain('All-in 900');
    expect(html).toContain('action-button-fold');
    expect(html).toContain('action-button-call');
    expect(html).toContain('action-button-raise');
    expect(html).not.toContain('>fold<');
    expect(html).not.toContain('>call 50<');
    expect(html).toContain('name="amount"');
    expect(html).toContain('arena-raise-control');
    expect(html).toContain('class="arena-raise-slider"');
    expect(html).toContain('type="range"');
    expect(html).toContain('required=""');
    expect(html).toContain('min="100"');
    expect(html).toContain('max="900"');
    expect(html).toContain('value="100"');
    expect(html).toContain('Min 100');
    expect(html).toContain('Mid 500');
    expect(html).toContain('All-in 900');
    expect(html).toContain('Turn timer');
    expect(html).toContain('Expired');
    expect(html).toContain('Need a valid raise amount');

    const buttonRow = html.match(/<div class="action-button-row arena-direct-actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(buttonRow).toContain('Fold');
    expect(buttonRow).toContain('Call 50');
    expect(buttonRow).toContain('Raise');
    expect(buttonRow.indexOf('Fold')).toBeLessThan(buttonRow.indexOf('Call 50'));
    expect(buttonRow.indexOf('Call 50')).toBeLessThan(buttonRow.indexOf('Raise'));
    expect(buttonRow.indexOf('Raise')).toBeLessThan(buttonRow.indexOf('All-in 900'));
  });

  it('renders check and all-in direct action labels in title case', () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel
        pendingAction={{
          ...model.pendingAction!,
          requestId: 'req-check-all-in',
          legalActions: [{ type: 'fold' }, { type: 'check' }, { type: 'all-in', maxAmount: 900 }],
        }}
        holeCards={model.seats[0]!.holeCards}
        error={null}
        submitting={false}
        now={0}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('Fold');
    expect(html).toContain('Check');
    expect(html).toContain('All-in 900');
  });

  it('uses a valid controlled fallback amount when a sized action omits minAmount', () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel
        pendingAction={{
          ...model.pendingAction!,
          requestId: 'req-bet-without-min',
          legalActions: [{ type: 'bet', maxAmount: 900 }],
        }}
        holeCards={model.seats[0]!.holeCards}
        error={null}
        submitting={false}
        onSubmitAction={() => undefined}
      />,
    );

    expect(html).toContain('name="amount"');
    expect(html).toContain('required=""');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="900"');
    expect(html).toContain('value="1"');
  });

  it('validates sized action amount text before submission', () => {
    const raiseAction = { type: 'raise', minAmount: 100, maxAmount: 900 } as const;

    expect(validateSizedActionAmount(raiseAction, '')).toMatchObject({ valid: false });
    expect(validateSizedActionAmount(raiseAction, 'not-a-number')).toMatchObject({ valid: false });
    expect(validateSizedActionAmount(raiseAction, '99')).toMatchObject({ valid: false });
    expect(validateSizedActionAmount(raiseAction, '901')).toMatchObject({ valid: false });
    expect(validateSizedActionAmount(raiseAction, '100')).toEqual({ valid: true, amount: 100 });
  });

  it('formats legal action labels for direct and sized actions', () => {
    expect(formatActionLabel({ type: 'fold' })).toBe('Fold');
    expect(formatActionLabel({ type: 'check' })).toBe('Check');
    expect(formatActionLabel({ type: 'call', callAmount: 50 })).toBe('Call 50');
    expect(formatActionLabel({ type: 'raise', minAmount: 100, maxAmount: 900 })).toBe('Raise');
    expect(formatActionLabel({ type: 'all-in', maxAmount: 900 })).toBe('All-in 900');
  });

  it('builds valid distinct preset amounts for sized actions', () => {
    expect(buildPresetAmounts({ type: 'raise', minAmount: 100, maxAmount: 900 })).toEqual([100, 500, 900]);
    expect(buildPresetAmounts({ type: 'bet', minAmount: 100, maxAmount: 900 }, 225)).toEqual([100, 225, 500, 900]);
    expect(buildPresetAmounts({ type: 'bet', minAmount: 100, maxAmount: 900 }, 500)).toEqual([100, 500, 900]);
    expect(buildPresetAmounts({ type: 'bet', minAmount: 100, maxAmount: 900 }, 1200)).toEqual([100, 500, 900]);
    expect(buildPresetAmounts({ type: 'call', callAmount: 50 }, 225)).toEqual([]);
  });

  it('formats expired and compact turn deadlines', () => {
    expect(formatDeadline(1000, 1000)).toBe('Expired');
    expect(formatDeadline(75_000, 10_000)).toBe('1:05');
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
    expect(html).toContain('name="buyIn"');
    expect(html).toContain('value="1000"');
    expect(html).toContain('min="1"');
    expect(html).toContain('Buy-in chips');
    expect(html).toContain('Sit here');
    expect(html).toContain('Sit agent at seat 4');
    expect(html).toContain('Range Bot');
    expect(html).toContain('disabled=""');
  });

  it('can hide human sit controls and show inline seat errors', () => {
    const html = renderToStaticMarkup(
      <SeatManagementPanel
        model={model}
        myAgents={[{ agentConfigId: 'cfg-1', agentName: 'Range Bot', endpointUrl: 'https://bot.test' }]}
        busySeatIndex={null}
        error="Already seated at this table"
        canSitHuman={false}
        onSitHuman={() => undefined}
        onSitAgent={() => undefined}
      />,
    );

    expect(html).toContain('Already seated at this table');
    expect(html).not.toContain('Sit here');
    expect(html).toContain('Sit agent at seat 4');
  });

  it('normalizes seat buy-in input to a positive integer chip stack', () => {
    expect(normalizeSeatBuyIn('1000')).toBe(1000);
    expect(normalizeSeatBuyIn('42.9')).toBeNull();
    expect(normalizeSeatBuyIn('0')).toBeNull();
    expect(normalizeSeatBuyIn('-10')).toBeNull();
    expect(normalizeSeatBuyIn('not-a-number')).toBeNull();
  });

  it('stacks seats before the desktop top row can overlap', () => {
    const narrowestTwoColumnFeltWidth = 981 - 48 - 16 - 340;
    const seatWidth = parseLengthPx(declarationFor('.player-seat', 'width'));
    const topSeatSelectors = ['.seat-top-left', '.seat-top', '.seat-top-right'] as const;
    const horizontalRanges = topSeatSelectors.map(selector =>
      horizontalRangeFor(selector, narrowestTwoColumnFeltWidth, seatWidth),
    );

    for (let index = 1; index < horizontalRanges.length; index += 1) {
      const previous = horizontalRanges[index - 1]!;
      const current = horizontalRanges[index]!;
      expect(current.left - previous.right, `${previous.selector} overlaps ${current.selector}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('uses a dedicated mobile seat summary instead of stacking seats through the felt', () => {
    const mobileBlock = mobileArenaMedia();
    const mobileDockBlock = cssBlockFor('.mobile-seat-dock', mobileBlock.body);
    const hiddenSeatBlock = cssBlockFor('.poker-arena-shell .poker-felt .player-seat', mobileBlock.body);
    const feltHeight = parseLengthPx(declarationFor('.poker-arena-shell .poker-felt', 'min-height', mobileBlock.body));

    expect(mobileBlock.breakpoint).toBe(860);
    expect(feltHeight).toBeLessThanOrEqual(460);
    expect(hiddenSeatBlock).toContain('display: none');
    expect(mobileDockBlock).toContain('display: grid');
    expect(mobileBlock.body).not.toContain('.seat-center-left { top: 1066px; }');
  });

  it('keeps the desktop left rail seats separated in the nine-seat layout', () => {
    const feltMinHeight = parseLengthPx(declarationFor('.poker-felt', 'min-height'));
    const seatMinHeight = parseLengthPx(declarationFor('.player-seat', 'min-height'));
    const leftRailSelectors = ['.seat-left', '.seat-center-left', '.seat-bottom-left'] as const;

    expect(leftRailSelectors.map(selector => declarationFor(selector, 'left'))).toEqual(['18px', '18px', '18px']);

    const verticalRanges = leftRailSelectors.map(selector => {
      const top = topOffsetFor(selector, feltMinHeight, seatMinHeight);
      return { selector, top, bottom: top + seatMinHeight };
    });

    for (let index = 1; index < verticalRanges.length; index += 1) {
      const previous = verticalRanges[index - 1]!;
      const current = verticalRanges[index]!;
      expect(current.top - previous.bottom, `${previous.selector} overlaps ${current.selector}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the arena layout from squeezing the game table controls', () => {
    const arenaShellBlock = styles.slice(
      styles.indexOf('.poker-arena-shell {'),
      styles.indexOf('.poker-arena-shell .poker-stage'),
    );
    const stageBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .poker-stage {'),
      styles.indexOf('.poker-arena-shell .poker-table-header {'),
    );
    const tableHeaderBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .poker-table-header {'),
      styles.indexOf('.poker-arena-shell .poker-table-header h1 {'),
    );
    const sideRailBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .live-side-rail {'),
      styles.indexOf('.poker-arena-shell .live-side-rail .rail-card {'),
    );
    const sideRailCardBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .live-side-rail .rail-card {'),
      styles.indexOf('.poker-arena-shell .live-side-rail .rail-card:first-of-type {'),
    );
    const seatWagerBlock = styles.slice(
      styles.indexOf('.seat-wager {'),
      styles.indexOf('.seat-wager .arena-chip-stack {'),
    );
    const actionButtonRowBlock = styles.slice(
      styles.indexOf('.arena-action-console .action-button-row {'),
      styles.indexOf('.arena-raise-control {'),
    );
    const actionStatusCardsBlock = styles.slice(
      styles.indexOf('.arena-action-console .player-action-status .mini-card-row {'),
      styles.indexOf('.arena-action-console .turn-timer {'),
    );
    const raiseControlBlock = styles.slice(
      styles.indexOf('.arena-raise-control {'),
      styles.indexOf('.arena-raise-control label {'),
    );
    const raiseControlLabelBlock = styles.slice(
      styles.indexOf('.arena-raise-control label {'),
      styles.indexOf('.arena-raise-control .sized-action-label {'),
    );
    const feltBlock = styles.slice(
      styles.indexOf('.poker-arena-shell .poker-felt {'),
      styles.indexOf('.poker-arena-shell .poker-felt::before {'),
    );
    const presetBlock = styles.slice(
      styles.indexOf('.arena-action-console .sized-action-presets {'),
      styles.indexOf('.arena-action-console .sized-action-presets button {'),
    );
    const responsiveCutover = styles.match(/@media \(max-width: (?<breakpoint>\d+)px\) \{\s*\.poker-arena-shell\s*\{\s*grid-template-columns: 1fr;/);

    expect(declarationFor('.poker-arena-shell', 'grid-template-columns', arenaShellBlock)).toContain('minmax(960px, 1fr)');
    expect(declarationFor('.poker-arena-shell .poker-stage', 'position', stageBlock)).toBe('relative');
    expect(declarationFor('.poker-arena-shell .poker-table-header', 'position', tableHeaderBlock)).toBe('absolute');
    expect(declarationFor('.poker-arena-shell .poker-table-header', 'width', tableHeaderBlock)).toBe('280px');
    expect(declarationFor('.poker-arena-shell .live-side-rail', 'gap', sideRailBlock)).toBe('0');
    expect(declarationFor('.poker-arena-shell .live-side-rail', 'border-radius', sideRailBlock)).toBe('8px');
    expect(declarationFor('.poker-arena-shell .live-side-rail .rail-card', 'background', sideRailCardBlock)).toBe('transparent');
    expect(declarationFor('.poker-arena-shell .live-side-rail .rail-card', 'box-shadow', sideRailCardBlock)).toBe('none');
    expect(declarationFor('.seat-wager', 'position', seatWagerBlock)).toBe('absolute');
    expect(declarationFor('.seat-wager', 'display', seatWagerBlock)).toBe('inline-flex');
    expect(declarationFor('.seat-wager', 'top', seatWagerBlock)).toBe('50%');
    expect(declarationFor('.seat-wager', 'transform', seatWagerBlock)).toContain('var(--seat-wager-x');
    expect(declarationFor('.poker-arena-shell .poker-felt', 'min-height', feltBlock)).toBe('560px');
    expect(declarationFor('.arena-action-console .action-button-row', 'grid-template-columns', actionButtonRowBlock)).toContain('repeat(4, minmax(118px, 1fr))');
    expect(declarationFor('.arena-action-console .player-action-status .mini-card-row', 'display', actionStatusCardsBlock)).toBe('none');
    expect(declarationFor('.arena-raise-control', 'grid-template-columns', raiseControlBlock)).toBe('1fr');
    expect(declarationFor('.arena-raise-control label', 'max-width', raiseControlLabelBlock)).toBe('none');
    expect(declarationFor('.arena-action-console .sized-action-presets', 'grid-template-columns', presetBlock)).toContain('repeat(4, minmax(0, 1fr))');
    expect(Number(responsiveCutover?.groups?.['breakpoint'] ?? 0)).toBeGreaterThanOrEqual(1360);
  });
});

describe('WsClient status callbacks', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('notifies listeners when connecting, connected, reconnecting, and closed', () => {
    const statuses: string[] = [];
    const client = new WsClient('ws://unit.test/ws');
    client.onStatus(status => statuses.push(status));

    client.connect();
    expect(statuses).toEqual(['connecting']);

    FakeWebSocket.instances[0]!.open();
    expect(statuses).toEqual(['connecting', 'connected']);

    FakeWebSocket.instances[0]!.serverClose();
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting']);

    client.close();
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'closed']);
  });

  it('keeps reconnect retries in reconnecting status until open', () => {
    const statuses: string[] = [];
    const client = new WsClient('ws://unit.test/ws');
    client.onStatus(status => statuses.push(status));

    client.connect();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.serverClose();
    vi.advanceTimersByTime(1000);

    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting']);

    FakeWebSocket.instances[1]!.open();
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });
});

describe('TablePage route integration', () => {
  it('refreshes snapshots on hand start and delays hand completion refreshes', () => {
    expect(refreshDelayForLiveEvent({ type: 'hand.started', handNumber: 7 })).toBe(0);
    expect(refreshDelayForLiveEvent({ type: 'hand.completed' })).toBe(50);
    expect(refreshDelayForLiveEvent({ type: 'action.requested', playerId: 'player-1' })).toBeNull();
  });

  it('tracks submitted request ids so a successful pending action cannot be resubmitted', () => {
    expect(isActionRequestLocked(null, null, false)).toBe(false);
    expect(isActionRequestLocked('req-1', 'req-1', false)).toBe(true);
    expect(isActionRequestLocked('req-2', 'req-1', false)).toBe(false);
    expect(isActionRequestLocked('req-2', 'req-1', true)).toBe(true);
  });

  it('uses one-based seat numbering in the page seat summary', () => {
    expect(seatDisplayNumber(0)).toBe(1);
    expect(seatDisplayNumber(8)).toBe(9);
  });

  it('builds seat request bodies from the selected chip buy-in', () => {
    expect(buildHumanSeatRequestBody(2, 1500)).toEqual({ seatIndex: 2, buyIn: 1500 });
    expect(buildAgentSeatRequestBody(3, 'cfg-7', 750)).toEqual({
      seatIndex: 3,
      buyIn: 750,
      agentConfigId: 'cfg-7',
    });
  });
});

function adapterLabelFor(adapterType: SeatAdapterType): 'Human' | 'HTTP Agent' | 'Mock Agent' {
  if (adapterType === 'human') return 'Human';
  if (adapterType === 'http') return 'HTTP Agent';
  return 'Mock Agent';
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  close(): void {
    this.serverClose();
  }
}

function cssBlockFor(selector: string, source = styles): string {
  const matches = [...source.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]*)\\}`, 'g'))];
  const match = source === styles ? matches[0] : matches.at(-1);
  const block = match?.groups?.['body'];
  if (!block) throw new Error(`Missing CSS block for ${selector}`);

  return block;
}

function declarationFor(selector: string, property: string, source = styles): string {
  const block = cssBlockFor(selector, source);

  const declaration = block.match(new RegExp(`${property}\\s*:\\s*(?<value>[^;]+);?`))?.groups?.['value'];
  if (!declaration) throw new Error(`Missing ${property} declaration for ${selector}`);

  return declaration.trim();
}

function topOffsetFor(selector: string, containerHeight: number, elementHeight: number, source = styles): number {
  const block = cssBlockFor(selector, source);

  const top = block.match(/top\s*:\s*(?<value>[^;]+);?/)?.groups?.['value'];
  if (top) return parseLengthPx(top, containerHeight);

  const bottom = block.match(/bottom\s*:\s*(?<value>[^;]+);?/)?.groups?.['value'];
  if (bottom) return containerHeight - parseLengthPx(bottom, containerHeight) - elementHeight;

  throw new Error(`Missing vertical positioning for ${selector}`);
}

function horizontalRangeFor(selector: string, containerWidth: number, elementWidth: number) {
  const block = cssBlockFor(selector);
  const left = block.match(/left\s*:\s*(?<value>[^;]+);?/)?.groups?.['value'];
  const right = block.match(/right\s*:\s*(?<value>[^;]+);?/)?.groups?.['value'];
  const transform = block.match(/transform\s*:\s*(?<value>[^;]+);?/)?.groups?.['value'];

  if (left) {
    const offset = parseLengthPx(left, containerWidth) - (transform?.includes('translateX(-50%)') ? elementWidth / 2 : 0);
    return { selector, left: offset, right: offset + elementWidth };
  }

  if (right) {
    const offset = containerWidth - parseLengthPx(right, containerWidth) - elementWidth;
    return { selector, left: offset, right: offset + elementWidth };
  }

  throw new Error(`Missing horizontal positioning for ${selector}`);
}

function mobileArenaMedia(): { breakpoint: number; body: string } {
  const mediaBlocks = [...styles.matchAll(/@media \(max-width: (?<breakpoint>\d+)px\) \{(?<body>[\s\S]*?)(?=\n@media \(max-width:|\s*$)/g)];
  const media = mediaBlocks.find(match =>
    match.groups?.['breakpoint'] === '860' &&
    match.groups?.['body']?.includes('.poker-arena-shell .poker-felt .player-seat')
  );

  const breakpoint = media?.groups?.['breakpoint'];
  const body = media?.groups?.['body'];
  if (!breakpoint || !body) throw new Error('Missing mobile arena media query');

  return {
    breakpoint: Number(breakpoint),
    body,
  };
}

function parseLengthPx(value: string, percentBase = 0): number {
  const trimmed = value.trim();
  if (trimmed.endsWith('px')) return Number(trimmed.slice(0, -2));
  if (trimmed.endsWith('%')) return Number(trimmed.slice(0, -1)) / 100 * percentBase;
  throw new Error(`Unsupported CSS length: ${value}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
