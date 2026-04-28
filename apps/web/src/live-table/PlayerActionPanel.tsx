import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ActionType, Card, LegalAction, PendingAction } from './liveTableTypes.js';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set<Card['suit']>(['h', 'd']);

export interface PlayerActionPanelProps {
  pendingAction: PendingAction | null;
  submitting: boolean;
  error: string | null;
  onSubmitAction: (actionType: ActionType, amount?: number) => void;
}

export type SizedActionValidationResult =
  | { valid: true; amount: number }
  | { valid: false; error: string };

export function PlayerActionPanel({
  pendingAction,
  submitting,
  error,
  onSubmitAction,
}: PlayerActionPanelProps) {
  const sized = pendingAction?.legalActions.find(action => action.type === 'raise' || action.type === 'bet') ?? null;
  const defaultAmountText = sized ? String(defaultSizedActionAmount(sized)) : '';
  const [amountText, setAmountText] = useState(defaultAmountText);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setAmountText(defaultAmountText);
    setLocalError(null);
  }, [pendingAction?.requestId, defaultAmountText]);

  if (!pendingAction) return null;

  function submitSizedAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sized) return;

    const validation = validateSizedActionAmount(sized, amountText);
    if (!validation.valid) {
      setLocalError(validation.error);
      return;
    }

    setLocalError(null);
    onSubmitAction(sized.type, validation.amount);
  }

  function updateAmount(event: ChangeEvent<HTMLInputElement>) {
    setAmountText(event.target.value);
    setLocalError(null);
  }

  const sizedValidation = sized ? validateSizedActionAmount(sized, amountText) : null;
  const shownError = localError ?? error;

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
              value={amountText}
              required
              disabled={submitting}
              aria-invalid={localError ? true : undefined}
              onChange={updateAmount}
            />
          </label>
          <span className="muted">
            {sized.minAmount ?? 1}
            {sized.maxAmount !== undefined ? `-${sized.maxAmount}` : '+'}
          </span>
          <button disabled={submitting || sizedValidation?.valid === false} type="submit">{sized.type}</button>
        </form>
      ) : null}

      {shownError ? <div className="error">{shownError}</div> : null}
    </section>
  );
}

export function validateSizedActionAmount(
  action: LegalAction,
  amountText: string,
): SizedActionValidationResult {
  const minAmount = minimumSizedActionAmount(action);
  const trimmed = amountText.trim();

  if (!trimmed) {
    return { valid: false, error: 'Enter an amount.' };
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return { valid: false, error: 'Enter a valid amount.' };
  }

  if (amount < minAmount) {
    return { valid: false, error: `Minimum is ${minAmount}.` };
  }

  if (action.maxAmount !== undefined && amount > action.maxAmount) {
    return { valid: false, error: `Maximum is ${action.maxAmount}.` };
  }

  return { valid: true, amount };
}

function minimumSizedActionAmount(action: LegalAction): number {
  return action.minAmount ?? 1;
}

function defaultSizedActionAmount(action: LegalAction): number {
  return minimumSizedActionAmount(action);
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
