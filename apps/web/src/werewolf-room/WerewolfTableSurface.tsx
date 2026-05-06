import type { WerewolfRoomState, SeatVM, WerewolfRole } from './werewolfRoomTypes.js';

export interface WerewolfTableSurfaceProps {
  state: WerewolfRoomState;
  onInvite?: (seatIndex: number) => void;
  onFillAll?: () => void;
}

// Oval arc seat positions: 9 seats evenly spaced, rx=38%, ry=31%, cx=50%, cy=50%
// Starting from top-center, clockwise.
const SEAT_POSITIONS: ReadonlyArray<{ left: string; top: string }> = [
  { left: '50.0%', top: '19.0%' },  // P1 — top center
  { left: '74.4%', top: '26.3%' },  // P2 — top right
  { left: '87.4%', top: '44.6%' },  // P3 — right
  { left: '82.9%', top: '65.5%' },  // P4 — bottom right
  { left: '63.0%', top: '79.1%' },  // P5 — bottom right of center
  { left: '37.0%', top: '79.1%' },  // P6 — bottom left of center
  { left: '17.1%', top: '65.5%' },  // P7 — bottom left
  { left: '12.6%', top: '44.6%' },  // P8 — left
  { left: '25.6%', top: '26.3%' },  // P9 — top left
];

const ROLE_EMOJI: Record<WerewolfRole, string> = {
  werewolf: '⚔️',
  villager: '👤',
  seer:     '🔮',
  witch:    '💊',
  hunter:   '🏹',
};

const ROLE_LABELS: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer:     '预言家',
  witch:    '女巫',
  hunter:   '猎人',
};

interface SeatCardProps {
  seat: SeatVM;
  pos: { left: string; top: string };
  thinking: boolean;
  speaking: boolean;
  revealRoles: boolean;
  onInvite?: (seatIndex: number) => void;
}

function SeatCard({ seat, pos, thinking, speaking, revealRoles, onInvite }: SeatCardProps) {
  const isEmpty = seat.occupant.kind === 'empty';
  const dead = !seat.alive && !isEmpty;
  const isWolf = seat.revealedRole === 'werewolf';

  const cardClass = [
    'ww-seat',
    isEmpty ? 'is-empty' : '',
    dead ? 'is-dead' : '',
    thinking ? 'is-thinking' : '',
    speaking ? 'is-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const roleEmoji = revealRoles && seat.revealedRole
    ? ROLE_EMOJI[seat.revealedRole]
    : '👤';

  const badgeClass = ['ww-seat-role-badge', isWolf && revealRoles ? 'is-wolf' : '']
    .filter(Boolean)
    .join(' ');

  let statusText: string;
  if (dead) {
    statusText = revealRoles && seat.revealedRole
      ? `✝ ${ROLE_LABELS[seat.revealedRole]}`
      : '✝ 已淘汰';
  } else if (thinking) {
    statusText = 'thinking…';
  } else if (speaking) {
    statusText = 'speaking…';
  } else {
    statusText = 'waiting';
  }

  const statusClass = [
    'ww-seat-status',
    dead ? 'is-dead' : '',
    thinking ? 'is-thinking' : '',
    speaking ? 'is-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cardClass}
      style={{ left: pos.left, top: pos.top }}
      data-seat-index={seat.seatIndex}
    >
      <div className={badgeClass}>{roleEmoji}</div>
      <div className="ww-seat-id">P{seat.seatIndex + 1}</div>
      {isEmpty ? (
        <>
          <div className="ww-seat-name" style={{ color: 'var(--ww-text-dim)' }}>empty</div>
          <button
            className="ww-seat-invite"
            onClick={() => onInvite?.(seat.seatIndex)}
            disabled={!onInvite}
          >
            邀请 NPC
          </button>
        </>
      ) : (
        <>
          <div className="ww-seat-name">
            {seat.occupant.kind === 'npc' ? seat.occupant.displayName : '???'}
          </div>
          <div className={statusClass}>{statusText}</div>
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
    state.status === 'waiting' &&
    state.seats.some((s) => s.occupant.kind === 'empty');

  const isNight =
    typeof state.currentPhase === 'string' &&
    state.currentPhase.startsWith('night-');

  return (
    <div className={`ww-board-wrapper${isNight ? '' : ' is-day'}`}>
      {showFillAll && onFillAll ? (
        <button className="ww-fill-all" onClick={onFillAll}>
          一键填满 9 个 NPC
        </button>
      ) : null}
      <div className="ww-board-night-overlay" />
      <div className="ww-seat-arc">
        {state.seats.map((seat, i) => {
          const pos = SEAT_POSITIONS[i] ?? { left: '50%', top: '50%' };
          return (
            <SeatCard
              key={seat.seatIndex}
              seat={seat}
              pos={pos}
              thinking={state.thinkingActor === seat.playerId}
              speaking={state.speakingActor === seat.playerId}
              revealRoles={revealRoles}
              {...(onInvite ? { onInvite } : {})}
            />
          );
        })}
      </div>
    </div>
  );
}
