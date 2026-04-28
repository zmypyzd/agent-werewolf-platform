import { useMemo, useState } from 'react';
import type { PokerTableViewModel } from './buildPokerTableViewModel.js';

export interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
}

export interface SeatManagementPanelProps {
  model: PokerTableViewModel;
  myAgents: UserAgentConfigPublic[];
  busySeatIndex: number | null;
  error?: string | null;
  canSitHuman?: boolean;
  onSitHuman: (seatIndex: number, buyIn: number) => void;
  onSitAgent: (seatIndex: number, agentConfigId: string, buyIn: number) => void;
}

export const DEFAULT_SEAT_BUY_IN = 1000;

export function normalizeSeatBuyIn(value: string | number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) return null;
  return numeric;
}

export function SeatManagementPanel({
  model,
  myAgents,
  busySeatIndex,
  error = null,
  canSitHuman = true,
  onSitHuman,
  onSitAgent,
}: SeatManagementPanelProps) {
  const [buyInText, setBuyInText] = useState(String(DEFAULT_SEAT_BUY_IN));
  const selectedBuyIn = useMemo(() => normalizeSeatBuyIn(buyInText), [buyInText]);

  if (!model.canShowSeatControls) return null;

  const openSeats = model.seats.filter(seat => !seat.occupied);
  if (openSeats.length === 0) return null;

  return (
    <section className="seat-management-panel" aria-label="Open seats">
      <div className="section-heading">
        <h2>Open Seats</h2>
        <span className="muted">{openSeats.length} available</span>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <label className="seat-buy-in-control">
        Buy-in chips
        <input
          min="1"
          name="buyIn"
          onChange={event => setBuyInText(event.target.value)}
          step="1"
          type="number"
          value={buyInText}
        />
      </label>
      {selectedBuyIn === null ? (
        <span className="error" role="alert">Enter a positive chip buy-in.</span>
      ) : null}
      <div className="seat-management-grid">
        {openSeats.map(seat => (
          <div className="seat-management-item" key={seat.seatIndex}>
            <strong>Seat {seat.seatIndex + 1}</strong>
            {canSitHuman ? (
              <button
                disabled={busySeatIndex === seat.seatIndex || selectedBuyIn === null}
                onClick={() => {
                  if (selectedBuyIn !== null) onSitHuman(seat.seatIndex, selectedBuyIn);
                }}
                type="button"
              >
                Sit here
              </button>
            ) : null}
            {myAgents.length > 0 ? (
              <select
                aria-label={`Sit agent at seat ${seat.seatIndex + 1}`}
                disabled={busySeatIndex === seat.seatIndex || selectedBuyIn === null}
                onChange={event => {
                  if (event.target.value && selectedBuyIn !== null) {
                    onSitAgent(seat.seatIndex, event.target.value, selectedBuyIn);
                  }
                }}
                value=""
              >
                <option value="">Seat agent</option>
                {myAgents.map(agent => (
                  <option key={agent.agentConfigId} value={agent.agentConfigId}>{agent.agentName}</option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
