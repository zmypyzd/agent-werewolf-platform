import type { WerewolfRoomState, SeatVM } from './werewolfRoomTypes.js';

export interface WerewolfTableSurfaceProps {
  state: WerewolfRoomState;
  onInvite?: (seatIndex: number) => void;
  onFillAll?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

interface SeatCardProps {
  seat: SeatVM;
  highlighted: boolean;
  revealRoles: boolean;
  onInvite?: (seatIndex: number) => void;
}

function SeatCard({ seat, highlighted, revealRoles, onInvite }: SeatCardProps) {
  const isEmpty = seat.occupant.kind === 'empty';
  const dead = !seat.alive;
  const className = [
    'werewolf-seat',
    isEmpty ? 'werewolf-seat-empty' : 'werewolf-seat-occupied',
    dead ? 'werewolf-seat-dead' : '',
    highlighted ? 'werewolf-seat-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-seat-index={seat.seatIndex}>
      <div className="werewolf-seat-id">P{seat.seatIndex + 1}</div>
      {isEmpty ? (
        <button
          className="werewolf-seat-invite"
          onClick={() => onInvite?.(seat.seatIndex)}
          disabled={!onInvite}
        >
          邀请 NPC
        </button>
      ) : (
        <>
          <div className="werewolf-seat-name">
            {seat.occupant.kind === 'npc' ? seat.occupant.displayName : '???'}
          </div>
          {revealRoles && seat.revealedRole ? (
            <div className="werewolf-seat-role">
              {ROLE_LABELS[seat.revealedRole] ?? seat.revealedRole}
            </div>
          ) : null}
          {dead ? <div className="werewolf-seat-status">已淘汰</div> : null}
        </>
      )}
    </div>
  );
}

export function WerewolfTableSurface({
  state,
  onInvite,
  onFillAll,
}: WerewolfTableSurfaceProps) {
  const revealRoles = state.status === 'completed';
  const showFillAll =
    state.status === 'waiting' && state.seats.some((s) => s.occupant.kind === 'empty');
  return (
    <div className="werewolf-table">
      {showFillAll && onFillAll ? (
        <button className="werewolf-fill-all" onClick={onFillAll}>
          一键填满 9 个 NPC
        </button>
      ) : null}
      <div className="werewolf-seats">
        {state.seats.map((seat) => (
          <SeatCard
            key={seat.seatIndex}
            seat={seat}
            highlighted={state.currentActor === seat.playerId}
            revealRoles={revealRoles}
            {...(onInvite ? { onInvite } : {})}
          />
        ))}
      </div>
    </div>
  );
}
