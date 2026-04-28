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
  onSitHuman: (seatIndex: number) => void;
  onSitAgent: (seatIndex: number, agentConfigId: string) => void;
}

export function SeatManagementPanel({
  model,
  myAgents,
  busySeatIndex,
  onSitHuman,
  onSitAgent,
}: SeatManagementPanelProps) {
  if (!model.canShowSeatControls) return null;

  const openSeats = model.seats.filter(seat => !seat.occupied);
  if (openSeats.length === 0) return null;

  return (
    <section className="seat-management-panel" aria-label="Open seats">
      <div className="section-heading">
        <h2>Open Seats</h2>
        <span className="muted">{openSeats.length} available</span>
      </div>
      <div className="seat-management-grid">
        {openSeats.map(seat => (
          <div className="seat-management-item" key={seat.seatIndex}>
            <strong>Seat {seat.seatIndex + 1}</strong>
            <button
              disabled={busySeatIndex === seat.seatIndex}
              onClick={() => onSitHuman(seat.seatIndex)}
              type="button"
            >
              Sit here
            </button>
            {myAgents.length > 0 ? (
              <select
                aria-label={`Sit agent at seat ${seat.seatIndex}`}
                disabled={busySeatIndex === seat.seatIndex}
                onChange={event => {
                  if (event.target.value) onSitAgent(seat.seatIndex, event.target.value);
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
