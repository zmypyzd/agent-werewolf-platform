import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from '../lib/ws.js';
import { PlayerActionPanel, validateSizedActionAmount } from '../live-table/PlayerActionPanel.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel } from '../live-table/SeatManagementPanel.js';
import { isActionRequestLocked, refreshDelayForLiveEvent, seatDisplayNumber } from '../pages/TablePage.js';
import type { PokerTableViewModel, SeatPosition } from '../live-table/buildPokerTableViewModel.js';

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
    expect(html).toContain('required=""');
    expect(html).toContain('min="100"');
    expect(html).toContain('max="900"');
    expect(html).toContain('value="100"');
    expect(html).toContain('Need a valid raise amount');
  });

  it('uses a valid controlled fallback amount when a sized action omits minAmount', () => {
    const html = renderToStaticMarkup(
      <PlayerActionPanel
        pendingAction={{
          ...model.pendingAction!,
          requestId: 'req-bet-without-min',
          legalActions: [{ type: 'bet', maxAmount: 900 }],
        }}
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

  it('keeps the mobile community board out of the stacked seat path', () => {
    const mobileStack = mobileSeatStackMedia();
    const feltHeight = parseLengthPx(declarationFor('.poker-felt', 'min-height', mobileStack.body));
    const seatHeight = parseLengthPx(declarationFor('.player-seat', 'min-height', mobileStack.body));
    const boardCenter = parseLengthPx(declarationFor('.community-board', 'top', mobileStack.body), feltHeight);
    const boardRange = { top: boardCenter - 58, bottom: boardCenter + 58 };
    const stackedSeatSelectors = [
      '.seat-top-left',
      '.seat-top',
      '.seat-top-right',
      '.seat-right',
      '.seat-bottom-right',
      '.seat-bottom',
      '.seat-bottom-left',
      '.seat-left',
      '.seat-center-left',
    ] as const;

    expect(boardRange.top).toBeGreaterThanOrEqual(0);
    expect(boardRange.bottom).toBeLessThanOrEqual(feltHeight - 12);

    for (const selector of stackedSeatSelectors) {
      const seatTop = topOffsetFor(selector, feltHeight, seatHeight, mobileStack.body);
      const seatRange = { top: seatTop, bottom: seatTop + seatHeight };
      expect(rangesOverlap(boardRange, seatRange), `community board overlaps ${selector}`).toBe(false);
    }
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
});

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

function mobileSeatStackMedia(): { breakpoint: number; body: string } {
  const mediaBlocks = [...styles.matchAll(/@media \(max-width: (?<breakpoint>\d+)px\) \{(?<body>[\s\S]*?)(?=\n@media \(max-width:|\s*$)/g)];
  const media = mediaBlocks.find(match =>
    match.groups?.['body']?.includes('.seat-top-left,') &&
    match.groups['body'].includes('.seat-center-left {')
  );

  const breakpoint = media?.groups?.['breakpoint'];
  const body = media?.groups?.['body'];
  if (!breakpoint || !body) throw new Error('Missing mobile seat stack media query');

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

function rangesOverlap(first: { top: number; bottom: number }, second: { top: number; bottom: number }): boolean {
  return first.top < second.bottom && second.top < first.bottom;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
