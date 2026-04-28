import type { FormEvent } from 'react';
import type { ActionType, Card, LegalAction, PendingAction } from './liveTableTypes.js';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set<Card['suit']>(['h', 'd']);

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

  function submitSizedAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sized) return;

    const form = event.currentTarget;
    const amount = Number(new FormData(form).get('amount') ?? defaultAmount);
    onSubmitAction(sized.type, amount);
  }

  return (
    <section className="player-action-panel" aria-label="Player action panel">
      <div className="player-action-summary">
        <div>
          <h2>Your Turn</h2>
          <p className="muted">Choose an action for this hand.</p>
        </div>
        <div className="mini-card-row" aria-label="Your hole cards">
          <PanelCard card={pendingAction.privateState.holeCards[0]} />
          <PanelCard card={pendingAction.privateState.holeCards[1]} />
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
        <form className="sized-action-form" onSubmit={submitSizedAction}>
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
          <span className="muted">
            {sized.minAmount ?? 1}
            {sized.maxAmount !== undefined ? `-${sized.maxAmount}` : '+'}
          </span>
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

  const amount = action.type === 'call'
    ? action.callAmount
    : action.type === 'all-in'
      ? action.maxAmount
      : undefined;
  const label = amount === undefined ? action.type : `${action.type} ${amount}`;

  return (
    <button disabled={disabled} onClick={() => onSubmitAction(action.type, amount)} type="button">
      {label}
    </button>
  );
}

function PanelCard({ card }: { card: Card }) {
  return (
    <span className={`playing-card ${RED_SUITS.has(card.suit) ? 'is-red' : 'is-dark'}`}>
      {card.rank}{SUIT_GLYPH[card.suit]}
    </span>
  );
}
