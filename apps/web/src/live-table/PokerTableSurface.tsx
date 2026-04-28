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
  const currentActor = model.seats.find(seat => seat.isCurrentActor);

  return (
    <div className="poker-table-layout">
      <section className="poker-stage" aria-label="Poker table">
        <header className="poker-table-header">
          <div>
            <h1>{model.title}</h1>
            <p className="muted">{model.subtitle}</p>
          </div>
          <span className="table-connection">{model.connectionStatus}</span>
        </header>

        <div className="poker-felt">
          {model.seats.map(seat => <PlayerSeatNode key={seat.seatIndex} seat={seat} />)}
          <div className="community-board" aria-label="Community cards">
            <div className="community-card-row">
              {model.board.length === 0 ? (
                <span className="card-back">Board</span>
              ) : (
                model.board.map((card, index) => (
                  <PlayingCard card={card} key={`${card.rank}${card.suit}:${index}`} />
                ))
              )}
            </div>
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
          <p>{currentActor?.displayName ?? 'Waiting'}</p>
          <span className="muted">{model.phaseLabel}</span>
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

function PlayingCard({ card }: { card: Card }) {
  return (
    <span className={`playing-card ${RED_SUITS.has(card.suit) ? 'is-red' : 'is-dark'}`}>
      {card.rank}{SUIT_GLYPH[card.suit]}
    </span>
  );
}

function PlayerSeatNode({ seat }: { seat: PokerTableSeatModel }) {
  const className = [
    'player-seat',
    `seat-${seat.position}`,
    seat.occupied ? 'is-occupied' : 'is-open',
    seat.isCurrentActor ? 'is-actor' : '',
    seat.isYou ? 'is-me' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={className}>
      <div className="seat-topline">
        <strong>{seat.identityLabel}</strong>
      </div>
      {seat.occupied ? (
        <>
          <div className="seat-badge-row">
            <span className="seat-badge seat-adapter-badge">{seat.adapterLabel}</span>
            {seat.isYou ? <span className="seat-badge seat-you-badge">You</span> : null}
            {seat.isButton ? <span className="seat-badge dealer-button" aria-label="Dealer">D</span> : null}
            {seat.status ? <span className="seat-badge seat-status-badge">{seat.status}</span> : null}
          </div>
          <span className="seat-stack">{seat.stack ?? 0} chips</span>
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
        <span className="seat-meta">Open seat</span>
      )}
    </article>
  );
}
