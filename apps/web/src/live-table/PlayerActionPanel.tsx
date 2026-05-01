import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ActionType, Card, LegalAction, PendingAction } from './liveTableTypes.js';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set<Card['suit']>(['h', 'd']);

export interface PlayerActionPanelProps {
  pendingAction: PendingAction | null;
  holeCards: [Card, Card] | null;
  submitting: boolean;
  error: string | null;
  now?: number;
  potAmount?: number;
  onSubmitAction: (actionType: ActionType, amount?: number) => void;
}

export type SizedActionValidationResult =
  | { valid: true; amount: number }
  | { valid: false; error: string };

export function PlayerActionPanel({
  pendingAction,
  holeCards,
  submitting,
  error,
  now = Date.now(),
  potAmount,
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

  function choosePresetAmount(amount: number) {
    setAmountText(String(amount));
    setLocalError(null);
  }

  const sizedValidation = sized ? validateSizedActionAmount(sized, amountText) : null;
  const presetAmounts = sized ? buildPresetAmounts(sized, potAmount) : [];
  const shownError = localError ?? error;
  const deadlineLabel = formatDeadline(pendingAction.deadlineAt, now);
  const sizedActionFormId = sized ? `sized-action-${safeDomId(pendingAction.requestId)}` : undefined;
  const sliderAmountText = sized && sizedValidation?.valid
    ? String(sizedValidation.amount)
    : sized
      ? String(minimumSizedActionAmount(sized))
      : '';

  return (
    <section className="player-action-panel arena-action-console" aria-label="Player action panel">
      <div className="player-action-summary">
        <div>
          <h2>Your Turn</h2>
          <p className="muted">Choose an action for this hand.</p>
        </div>
        <div className="player-action-status">
          <div className={`turn-timer ${deadlineLabel === 'Expired' ? 'is-expired' : ''}`} aria-label="Turn timer">
            <span>Turn</span>
            <strong>{deadlineLabel}</strong>
          </div>
          <div className="mini-card-row" aria-label="Your hole cards">
            {holeCards ? (
              <>
                <PanelCard card={holeCards[0]} />
                <PanelCard card={holeCards[1]} />
              </>
            ) : (
              <PanelCardBack label="Cards pending" />
            )}
          </div>
        </div>
      </div>

      <div className="action-button-row arena-direct-actions">
        {pendingAction.legalActions.map(action => (
          isSizedAction(action) ? (
            <button
              className={`action-button action-button-${action.type}`}
              disabled={submitting || sizedValidation?.valid === false}
              form={sizedActionFormId}
              key={action.type}
              type="submit"
            >
              {formatActionLabel(action)}
            </button>
          ) : (
            <ActionButton
              action={action}
              disabled={submitting}
              key={action.type}
              onSubmitAction={onSubmitAction}
            />
          )
        ))}
      </div>

      {sized ? (
        <form className="sized-action-form arena-raise-control" id={sizedActionFormId} onSubmit={submitSizedAction}>
          <label>
            <span className="sized-action-label">{formatActionLabel(sized)} amount</span>
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
          {sized.maxAmount !== undefined ? (
            <input
              aria-label={`${formatActionLabel(sized)} amount slider`}
              className="arena-raise-slider"
              disabled={submitting}
              max={sized.maxAmount}
              min={sized.minAmount ?? 1}
              onChange={updateAmount}
              type="range"
              value={sliderAmountText}
            />
          ) : null}
          <span className="muted sized-action-range">
            {sized.minAmount ?? 1}
            {sized.maxAmount !== undefined ? `-${sized.maxAmount}` : '+'}
          </span>
          {presetAmounts.length > 0 ? (
            <div className="sized-action-presets" aria-label={`${formatActionLabel(sized)} presets`}>
              {presetAmounts.map(amount => (
                <button
                  disabled={submitting}
                  key={amount}
                  onClick={() => choosePresetAmount(amount)}
                  type="button"
                >
                  {formatPresetLabel(sized, amount, potAmount)}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      ) : null}

      {shownError ? <div className="error">{shownError}</div> : null}
    </section>
  );
}

export function formatActionLabel(action: LegalAction): string {
  if (action.type === 'all-in') {
    return action.maxAmount === undefined ? 'All-in' : `All-in ${action.maxAmount}`;
  }

  if (action.type === 'call') {
    return action.callAmount === undefined ? 'Call' : `Call ${action.callAmount}`;
  }

  return ACTION_LABELS[action.type];
}

export function buildPresetAmounts(action: LegalAction, potAmount?: number): number[] {
  if (!isSizedAction(action)) return [];

  const minAmount = minimumSizedActionAmount(action);
  const candidates = [minAmount];

  if (potAmount !== undefined) {
    candidates.push(Math.floor(potAmount));
  }

  if (action.maxAmount !== undefined) {
    candidates.push(Math.floor((minAmount + action.maxAmount) / 2));
    candidates.push(action.maxAmount);
  }

  return [...new Set(candidates)]
    .filter(amount => Number.isFinite(amount))
    .filter(amount => amount >= minAmount)
    .filter(amount => action.maxAmount === undefined || amount <= action.maxAmount)
    .sort((left, right) => left - right);
}

export function formatDeadline(deadlineAt: number, now: number): string {
  if (deadlineAt <= now) return 'Expired';

  const secondsRemaining = Math.ceil((deadlineAt - now) / 1000);
  if (secondsRemaining < 60) return `${secondsRemaining}s`;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

function isSizedAction(action: LegalAction): boolean {
  return action.type === 'raise' || action.type === 'bet';
}

const ACTION_LABELS: Record<ActionType, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  'all-in': 'All-in',
};

function formatPresetLabel(action: LegalAction, amount: number, potAmount?: number): string {
  if (amount === minimumSizedActionAmount(action)) return `Min ${amount}`;
  if (action.maxAmount !== undefined && amount === action.maxAmount) return `All-in ${amount}`;
  if (potAmount !== undefined && amount === Math.floor(potAmount)) return `Pot ${amount}`;
  if (action.maxAmount !== undefined && amount === Math.floor((minimumSizedActionAmount(action) + action.maxAmount) / 2)) {
    return `Mid ${amount}`;
  }

  return String(amount);
}

function safeDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
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

  return (
    <button
      className={`action-button action-button-${action.type}`}
      disabled={disabled}
      onClick={() => onSubmitAction(action.type, amount)}
      type="button"
    >
      {formatActionLabel(action)}
    </button>
  );
}

function PanelCard({ card }: { card: Card }) {
  const glyph = SUIT_GLYPH[card.suit];

  return (
    <span
      aria-label={`${card.rank}${glyph}`}
      className={`playing-card ${RED_SUITS.has(card.suit) ? 'is-red' : 'is-dark'}`}
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

function PanelCardBack({ label }: { label: string }) {
  return (
    <span className="card-back" aria-label={label} role="img">
      <span className="card-back-pattern" aria-hidden="true">{label}</span>
    </span>
  );
}
