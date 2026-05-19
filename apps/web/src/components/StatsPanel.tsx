import type { SeatVM, WerewolfRoomState } from '../werewolf-room/werewolfRoomTypes.js';

export interface StatsPanelProps {
  state: WerewolfRoomState;
}

const CAUSE_LABELS: Record<NonNullable<SeatVM['causeOfDeath']>, string> = {
  'wolf-kill':    '被狼刀',
  'witch-poison': '被毒',
  'banishment':   '被放逐',
  'hunter-shoot': '被开枪',
};

function speakerSeat(state: WerewolfRoomState): SeatVM | undefined {
  const id = state.speakingActor;
  if (!id) return undefined;
  return state.seats.find((s) => s.playerId === id);
}

function speakerDisplayName(seat: SeatVM | undefined): string {
  if (!seat) return '—';
  if (seat.occupant.kind === 'empty') return '—';
  return seat.occupant.displayName;
}

export function StatsPanel({ state }: StatsPanelProps) {
  const occupiedSeats = state.seats.filter((s) => s.occupant.kind !== 'empty');
  const aliveSeats = occupiedSeats.filter((s) => s.alive);
  const deadSeats = occupiedSeats.filter((s) => !s.alive);
  const wolvesAlive = aliveSeats.filter((s) => s.revealedRole === 'werewolf').length;
  const wolvesTotal = occupiedSeats.filter((s) => s.revealedRole === 'werewolf').length;
  const totalOccupied = occupiedSeats.length;
  const speaker = speakerSeat(state);

  // VOTES CAST: count `kind: 'vote'` timeline entries since the last
  // phase-day/phase-night marker, so the block reads "votes in this round"
  // rather than cumulative match-life votes. Falls back to 0 when no
  // phase marker has landed yet (early-match), which renders as 0/<alive>.
  const lastPhaseIdx = (() => {
    for (let i = state.timeline.length - 1; i >= 0; i--) {
      const k = state.timeline[i]?.kind;
      if (k === 'phase-day' || k === 'phase-night') return i;
    }
    return -1;
  })();
  const votesThisPhase = state.timeline
    .slice(lastPhaseIdx + 1)
    .filter((l) => l.kind === 'vote').length;
  const votesDenominator = aliveSeats.length;
  const votesPct = votesDenominator > 0
    ? Math.min(100, (votesThisPhase / votesDenominator) * 100)
    : 0;

  // Recent kills: dead seats with a cause. Order is best-effort
  // (lobby state doesn't carry kill timestamps), so we go newest-first by
  // seat index as a stable, scrollable list. Cap at 4 to avoid pushing the
  // speaker card off-screen.
  const recentKills = deadSeats
    .filter((s) => s.causeOfDeath !== undefined)
    .slice(-4)
    .reverse();

  return (
    <aside className="ww-stats-panel" aria-label="Match stats">
      <div className="ww-stats-h">
        <span className="ww-stats-h-title">MATCH STATS</span>
        <span className="ww-stats-h-sub">live</span>
      </div>

      <div className="ww-stats-block">
        <div className="ww-stats-l">ALIVE</div>
        <div className="ww-stats-v">
          <span className="ww-stats-big ww-stats-big-alive">
            {aliveSeats.length}
          </span>
          <span className="ww-stats-sub">/ {totalOccupied || 9}</span>
        </div>
        <div className="ww-stats-bar">
          <div
            className="ww-stats-fill ww-stats-fill-alive"
            style={{ width: `${totalOccupied ? (aliveSeats.length / totalOccupied) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="ww-stats-block">
        <div className="ww-stats-l">VOTES CAST</div>
        <div className="ww-stats-v">
          <span className="ww-stats-big ww-stats-big-votes">{votesThisPhase}</span>
          <span className="ww-stats-sub">/ {votesDenominator}</span>
        </div>
        <div className="ww-stats-bar">
          <div
            className="ww-stats-fill ww-stats-fill-votes"
            style={{ width: `${votesPct}%` }}
          />
        </div>
      </div>

      <div className="ww-stats-block">
        <div className="ww-stats-l">WOLVES REMAINING</div>
        <div className="ww-stats-v">
          <span className="ww-stats-big ww-stats-big-wolf">{wolvesAlive}</span>
          {wolvesTotal > 0 ? (
            <span className="ww-stats-sub">of {wolvesTotal} initial</span>
          ) : (
            <span className="ww-stats-sub">身份未揭晓</span>
          )}
        </div>
      </div>

      <div className="ww-stats-block">
        <div className="ww-stats-l">CURRENT SPEAKER</div>
        {speaker ? (
          <div className="ww-stats-speaker">
            <div className="ww-stats-speaker-ring" aria-hidden="true">
              <div className="ww-stats-speaker-ring-inner">
                {speaker.revealedRole ? roleEmoji(speaker.revealedRole) : '🎙️'}
              </div>
            </div>
            <div className="ww-stats-speaker-info">
              <span className="ww-stats-speaker-name">{speakerDisplayName(speaker)}</span>
              <span className="ww-stats-speaker-meta">
                SEAT P{speaker.seatIndex + 1}
              </span>
            </div>
          </div>
        ) : (
          <div className="ww-stats-speaker ww-stats-speaker-empty">
            <span className="ww-stats-speaker-meta">无人发言</span>
          </div>
        )}
      </div>

      <div className="ww-stats-block">
        <div className="ww-stats-l">
          RECENT KILLS
          <span className="ww-stats-l-count">{deadSeats.length}</span>
        </div>
        {recentKills.length === 0 ? (
          <div className="ww-stats-empty-kills">尚无淘汰</div>
        ) : (
          <ul className="ww-stats-kill-list">
            {recentKills.map((seat) => (
              <li key={seat.seatIndex} className="ww-stats-kill-row">
                <span className="ww-stats-kill-seat">P{seat.seatIndex + 1}</span>
                <span className="ww-stats-kill-name">
                  {seat.occupant.kind === 'empty' ? '—' : seat.occupant.displayName}
                </span>
                <span className="ww-stats-kill-cause">
                  ✝ {seat.causeOfDeath ? CAUSE_LABELS[seat.causeOfDeath] : '已淘汰'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function roleEmoji(role: NonNullable<SeatVM['revealedRole']>): string {
  switch (role) {
    case 'werewolf': return '⚔️';
    case 'villager': return '👤';
    case 'seer':     return '🔮';
    case 'witch':    return '💊';
    case 'hunter':   return '🏹';
  }
}
