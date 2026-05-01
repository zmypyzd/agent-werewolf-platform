import type { CSSProperties } from 'react';
import type { ActionType, Card, LiveActionLogEntry } from './liveTableTypes.js';
import type { PokerTableSeatModel, PokerTableViewModel } from './buildPokerTableViewModel.js';
import { PlayerActionPanel } from './PlayerActionPanel.js';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set<Card['suit']>(['h', 'd']);
const PREVIEW_BOARD: Card[] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'h' },
  { rank: 'Q', suit: 'c' },
  { rank: 'J', suit: 'd' },
  { rank: '9', suit: 's' },
];

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
  const currentActor = model.seats.find(seat => seat.isCurrentActor);
  const pendingActionSeat = model.pendingAction
    ? model.seats.find(seat => seat.playerId === model.pendingAction?.privateState.playerId)
    : null;
  const occupiedSeats = model.seats.filter(seat => seat.occupied);
  const heroSeat = model.seats.find(seat => seat.isYou && seat.holeCards);
  const boardCards = model.board.length > 0 ? model.board : PREVIEW_BOARD;
  const isPreviewBoard = model.board.length === 0;
  const anchorSeatIndex = Math.max(0, model.seats.findIndex(seat => seat.isYou));
  const rankedSeats = [...occupiedSeats]
    .sort((left, right) => (right.stack ?? 0) - (left.stack ?? 0))
    .slice(0, 5);
  const actionBySeatIndex = buildSeatActionMap(occupiedSeats, model.actionLog);

  return (
    <div className="poker-table-layout poker-arena-shell">
      <section className="poker-stage" aria-label="Poker table">
        <header className="poker-table-header">
          <div>
            <h1>{model.title}</h1>
            <p className="muted">{model.subtitle}</p>
          </div>
          <span className="table-connection">{model.connectionStatus}</span>
        </header>

        <div className="poker-felt">
          {model.seats.map((seat, index) => (
            <PlayerSeatNode
              key={seat.seatIndex}
              seat={seat}
              style={seatTrackStyle(index, model.seats.length, anchorSeatIndex)}
              lastAction={actionBySeatIndex.get(seat.seatIndex) ?? null}
            />
          ))}
          <div className="community-board" aria-label="Community cards">
            <div className="arena-pot-row">
              <ChipStack />
              <span className="arena-pot-block">
                <strong className="pot-display arena-pot-chip">Pot {model.totalPot}</strong>
                {model.phaseLabel ? (
                  <span className="arena-phase-label">{model.phaseLabel}</span>
                ) : null}
              </span>
              <ChipStack />
            </div>
            <div className={`community-card-row ${isPreviewBoard ? 'is-preview-board' : ''}`.trim()}>
              {boardCards.map((card, index) => (
                <PlayingCard
                  card={card}
                  key={`${card.rank}${card.suit}:${index}`}
                  preview={isPreviewBoard}
                />
              ))}
            </div>
          </div>
          {heroSeat?.holeCards ? (
            <div className="hero-hand-showcase" aria-label="Your poker hand">
              <PlayingCard card={heroSeat.holeCards[0]} className="hero-hole-card-left" />
              <PlayingCard card={heroSeat.holeCards[1]} className="hero-hole-card-right" />
            </div>
          ) : null}
        </div>

        <MobileSeatDock seats={model.seats} currentActorPlayerId={currentActor?.playerId ?? null} />

        <PlayerActionPanel
          pendingAction={model.pendingAction}
          holeCards={pendingActionSeat?.holeCards ?? null}
          submitting={submittingAction}
          error={actionError}
          potAmount={model.totalPot}
          onSubmitAction={onSubmitAction}
        />
      </section>

      <aside className="live-side-rail">
        <nav className="arena-side-tabs" aria-label="Arena side rail tabs">
          <span aria-current="page">Table Info</span>
          <span>Players</span>
          <span>Chat</span>
        </nav>

        <section className="rail-card arena-room-card">
          <h2>Room Info</h2>
          <dl className="arena-stat-list">
            <div>
              <dt>Phase</dt>
              <dd>{model.phaseLabel}</dd>
            </div>
            <div>
              <dt>Pot</dt>
              <dd>{model.totalPot}</dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>{occupiedSeats.length} / {model.seats.length}</dd>
            </div>
          </dl>
        </section>

        <section className="rail-card" aria-label="Current actor">
          <h2>Current Action</h2>
          <p>{currentActor?.displayName ?? 'Waiting'}</p>
          <span className="muted">{model.phaseLabel}</span>
        </section>

        <section className="rail-card">
          <h2>Rankings</h2>
          <ol className="arena-rank-list">
            {rankedSeats.length === 0 ? <li className="muted">No players seated.</li> : null}
            {rankedSeats.map((seat, index) => (
              <li key={seat.seatIndex}>
                <span>{index + 1}</span>
                <strong>{seat.displayName}</strong>
                <em>{seat.stack ?? 0}</em>
              </li>
            ))}
          </ol>
        </section>

        <section className="rail-card">
          <h2>Visible Hands</h2>
          <div className="visible-hands-list">
            {model.visibleHands.length === 0 ? <span className="muted">No active hand.</span> : null}
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
          </div>
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

function MobileSeatDock({
  seats,
  currentActorPlayerId,
}: {
  seats: PokerTableSeatModel[];
  currentActorPlayerId: string | null;
}) {
  return (
    <section className="mobile-seat-dock" aria-label="Seat summary">
      {seats.map(seat => (
        <article
          className={[
            'mobile-seat-card',
            seat.occupied ? 'is-occupied' : 'is-open',
            seat.isYou ? 'is-me' : '',
            seat.playerId === currentActorPlayerId ? 'is-actor' : '',
          ].filter(Boolean).join(' ')}
          key={seat.seatIndex}
        >
          <span className="mobile-seat-index">S{seat.seatIndex + 1}</span>
          <span className="mobile-seat-main">
            <strong>{seat.displayName}</strong>
            <span>{seat.occupied ? `${seat.stack ?? 0} chips` : 'Open seat'}</span>
          </span>
          {seat.isButton ? <span className="seat-badge dealer-button" aria-label="Dealer">D</span> : null}
          {seat.playerId === currentActorPlayerId ? <span className="seat-action-badge seat-action-call">Acting</span> : null}
        </article>
      ))}
    </section>
  );
}

function PlayingCard({ card, preview = false, className }: { card: Card; preview?: boolean; className?: string }) {
  const glyph = SUIT_GLYPH[card.suit];
  const cardClassName = [
    'playing-card',
    RED_SUITS.has(card.suit) ? 'is-red' : 'is-dark',
    preview ? 'is-preview-card' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <span
      aria-label={`${card.rank}${glyph}`}
      className={cardClassName}
      role="img"
    >
      <span className="playing-card-index playing-card-index-top">
        <span>{card.rank}</span>
        <span>{glyph}</span>
      </span>
      <span className="playing-card-face" aria-hidden="true">
        <span className="playing-card-pip">{glyph}</span>
      </span>
      <span className="playing-card-index playing-card-index-bottom" aria-hidden="true">
        <span>{card.rank}</span>
        <span>{glyph}</span>
      </span>
    </span>
  );
}

function CardBack({ label = '?' }: { label?: string }) {
  return (
    <span className="card-back" aria-label={label} role="img">
      <span className="card-back-pattern" aria-hidden="true">{label}</span>
    </span>
  );
}

function ChipStack() {
  return (
    <span className="arena-chip-stack" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

interface SeatLastAction {
  action: string;
  amount: number | null;
}

function PlayerSeatNode({
  seat,
  style,
  lastAction,
}: {
  seat: PokerTableSeatModel;
  style: CSSProperties;
  lastAction: SeatLastAction | null;
}) {
  const className = [
    'player-seat',
    `seat-${seat.position}`,
    seat.occupied ? 'is-occupied' : 'is-open',
    seat.isCurrentActor ? 'is-actor' : '',
    seat.isYou ? 'is-me' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={className} style={style}>
      <div className="seat-avatar" aria-hidden="true">{initialsFor(seat.identityLabel)}</div>
      {seat.isCurrentActor ? (
        <span className="seat-turn-indicator" aria-label="Current player acting">THINKING</span>
      ) : null}
      <div className="seat-content">
        <div className="seat-topline">
          <strong>{seat.identityLabel}</strong>
        </div>
      {seat.occupied ? (
        <>
          <div className="seat-badge-row">
            {seat.adapterLabel ? (
              <span className="seat-badge seat-adapter-badge">{seat.adapterLabel}</span>
            ) : null}
            {seat.isYou ? <span className="seat-badge seat-you-badge">You</span> : null}
            {seat.isButton ? <span className="seat-badge dealer-button" aria-label="Dealer">D</span> : null}
            {seat.status ? <span className="seat-badge seat-status-badge">{seat.status}</span> : null}
          </div>
          <span className="seat-stack">{seat.stack ?? 0}</span>
          {lastAction && !seat.isCurrentActor ? (
            <span className={`seat-action-badge seat-action-${lastAction.action}`}>
              {lastAction.action === 'all-in' ? 'ALL-IN' : lastAction.action.toUpperCase()}
            </span>
          ) : null}
          <div className="mini-card-row seat-card-row">
            {seat.holeCards ? (
              <>
                <PlayingCard card={seat.holeCards[0]} />
                <PlayingCard card={seat.holeCards[1]} />
              </>
            ) : (
              <>
                <CardBack />
                <CardBack />
              </>
            )}
          </div>
        </>
      ) : (
        <span className="seat-meta">Open seat</span>
      )}
      </div>
      {seat.occupied && lastAction !== null && lastAction.amount !== null ? (
        <span className="seat-wager" aria-label={`${seat.displayName} ${lastAction.action} ${lastAction.amount}`}>
          <ChipStack />
          <span className="seat-wager-copy">
            <span className="seat-wager-action">{lastAction.action}</span>
            <strong className="seat-wager-amount">{lastAction.amount}</strong>
          </span>
        </span>
      ) : null}
    </article>
  );
}

function buildSeatActionMap(
  seats: PokerTableSeatModel[],
  actionLog: LiveActionLogEntry[],
): Map<number, SeatLastAction> {
  const actions = new Map<number, SeatLastAction>();

  for (const entry of actionLog) {
    const parsed = parseLastAction(entry.label);
    if (!parsed) continue;

    const seat = seats.find(candidate => candidate.occupied && actorMatchesSeat(parsed.actor, candidate));
    if (!seat) continue;

    actions.set(seat.seatIndex, { action: parsed.action, amount: parsed.amount });
  }

  return actions;
}

function parseLastAction(label: string): { actor: string; action: string; amount: number | null } | null {
  // Monetary actions with an amount
  const wagerMatch = label.match(/^(?<actor>.+?)\s+(?<action>call|raise|bet|all-in)\s+(?<amount>[\d,]+)/i);
  if (wagerMatch) {
    const actor = wagerMatch.groups?.['actor']?.trim();
    const action = wagerMatch.groups?.['action']?.toLowerCase();
    const amount = Number((wagerMatch.groups?.['amount'] ?? '').replaceAll(',', ''));
    if (actor && action && Number.isFinite(amount) && amount > 0) return { actor, action, amount };
  }

  // Non-monetary actions (fold, check)
  const simpleMatch = label.match(/^(?<actor>.+?)\s+(?<action>fold|check)(?:\s|$)/i);
  if (simpleMatch) {
    const actor = simpleMatch.groups?.['actor']?.trim();
    const action = simpleMatch.groups?.['action']?.toLowerCase();
    if (actor && action) return { actor, action, amount: null };
  }

  return null;
}

function actorMatchesSeat(actor: string, seat: PokerTableSeatModel): boolean {
  const normalizedActor = actor.toLowerCase();
  const labels = [
    seat.playerId,
    seat.agentId,
    seat.displayName,
    seat.identityLabel,
  ].filter((candidate): candidate is string => typeof candidate === 'string');

  return labels.some(candidate => candidate.toLowerCase() === normalizedActor);
}

function seatTrackStyle(index: number, seatCount: number, anchorIndex: number): CSSProperties {
  const { x, y } = seatTrackCoordinates(index, seatCount, anchorIndex);
  const wagerOffset = seatWagerOffsetFor(x, y);

  return {
    '--seat-x': formatCssPercent(x),
    '--seat-y': formatCssPercent(y),
    '--seat-wager-x': formatCssPx(wagerOffset.x),
    '--seat-wager-y': formatCssPx(wagerOffset.y),
  } as CSSProperties;
}

// Seat angles in degrees, slot-0 always at the bottom (hero position).
// Designed for the arena's 2:1 landscape oval (x-radius 40%, y-radius 36%).
// Diagonal positions avoid left/right extremes for a natural poker-table look.
const OVAL_SEAT_ANGLES_DEG: Record<number, readonly number[]> = {
  1: [90],
  2: [90, 270],
  3: [90, 210, 330],
  // 4: hero bottom, then upper-left/upper-right so 3 consecutive slots form a triangle;
  //    slot-3 (empty in a 3-bot table) lands at the less-visible top-center gap.
  4: [90, 210, 330, 270],
  5: [90, 162, 234, 306, 18],
  6: [90, 150, 210, 270, 330, 30],
  7: [90, 141, 193, 244, 296, 347, 39],
  8: [90, 135, 180, 225, 270, 315, 0, 45],
  9: [90, 130, 170, 210, 250, 290, 330, 10, 50],
};

function seatTrackCoordinates(index: number, seatCount: number, anchorIndex: number): { x: number; y: number } {
  const slot = (index - anchorIndex + seatCount) % seatCount;
  const count = Math.min(9, Math.max(1, seatCount));
  const angles = OVAL_SEAT_ANGLES_DEG[count] ?? OVAL_SEAT_ANGLES_DEG[9]!;
  const angleDeg = angles[slot % angles.length] ?? 90;
  const angle = (angleDeg * Math.PI) / 180;

  const x = 50 + 40 * Math.cos(angle);
  const y = 50 + 36 * Math.sin(angle);
  return { x, y };
}

function seatWagerOffsetFor(seatX: number, seatY: number): { x: number; y: number } {
  const dx = 50 - seatX;
  const dy = 50 - seatY;
  const isDiagonal = Math.abs(dx) > 16 && Math.abs(dy) > 16;

  return {
    x: Math.abs(dx) > 16 ? Math.sign(dx) * (isDiagonal ? 78 : 102) : 0,
    y: Math.abs(dy) > 16 ? Math.sign(dy) * (isDiagonal ? 46 : 64) : 0,
  };
}

function formatCssPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function formatCssPx(value: number): string {
  return `${Number(value.toFixed(0))}px`;
}

function initialsFor(label: string): string {
  const parts = label
    .split(/[\s-_]+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return label.slice(0, 2).toUpperCase();
}
