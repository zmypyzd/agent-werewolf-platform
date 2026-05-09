import type { WerewolfRoomState, WerewolfRole, SeatVM } from './werewolfRoomTypes.js';
import { useStickyValue } from './useStickyValue.js';

// How long the booth keeps the last speech visible after the reducer has
// already cleared state.currentSpeech (which happens on every phase.changed,
// notably the day-speeches → day-vote fired by the LAST living speaker).
// 4s is enough to read a typical 1-2 sentence summon-style speech without
// pinning the booth through the entire voting phase. Tune via this constant.
const SPEECH_STICKY_MS = 4000;

export interface WerewolfSpeechBoardProps {
  state: WerewolfRoomState;
}

const ROLE_EMOJI: Record<WerewolfRole, string> = {
  werewolf: '⚔️',
  villager: '👤',
  seer:     '🔮',
  witch:    '💊',
  hunter:   '🏹',
};

const ROLE_LABEL_CN: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer:     '预言家',
  witch:    '女巫',
  hunter:   '猎人',
};

const ROLE_LABEL_EN: Record<WerewolfRole, string> = {
  werewolf: 'WEREWOLF',
  villager: 'VILLAGER',
  seer:     'SEER',
  witch:    'WITCH',
  hunter:   'HUNTER',
};

function findSeatByPlayerId(seats: ReadonlyArray<SeatVM>, playerId: string): SeatVM | undefined {
  return seats.find((s) => s.playerId === playerId);
}

function speakerDisplayName(seat: SeatVM | undefined, fallback: string): string {
  if (!seat) return fallback;
  if (seat.occupant.kind === 'npc') return seat.occupant.displayName;
  return fallback;
}

export function WerewolfSpeechBoard({ state }: WerewolfSpeechBoardProps) {
  const speech = useStickyValue(state.currentSpeech, SPEECH_STICKY_MS);
  if (!speech) return null;

  const seat = findSeatByPlayerId(state.seats, speech.actorId);
  const role = seat?.revealedRole;
  const isLive = state.speakingActor === speech.actorId;

  const avatar = role ? ROLE_EMOJI[role] : '🎙️';
  const roleLabel = role
    ? `${ROLE_LABEL_CN[role]} · ${ROLE_LABEL_EN[role]}`
    : '发言中 · ON FLOOR';
  const seatTag = seat ? `SEAT P${seat.seatIndex + 1}` : '';
  const displayName = speakerDisplayName(seat, speech.actorId);

  return (
    <section
      className={`ww-speech-board${isLive ? ' is-live' : ''}`}
      aria-live="polite"
      aria-label="当前发言"
    >
      <header className="ww-speech-studio">
        <div className="ww-speech-avatar" aria-hidden="true">{avatar}</div>
        <div className="ww-speech-id">
          <div className="ww-speech-name">{displayName}</div>
          <div className="ww-speech-role">{roleLabel}</div>
        </div>
        <div className="ww-speech-meta">
          <span className={`ww-speech-live${isLive ? '' : ' is-replay'}`}>
            {isLive ? 'ON AIR' : 'JUST SPOKE'}
          </span>
          {seatTag ? <span className="ww-speech-seat">{seatTag}</span> : null}
        </div>
      </header>
      <div className="ww-speech-body">
        <p className="ww-speech-text">{speech.text || '…'}</p>
        {speech.performance ? (
          <p className="ww-speech-perf">演技 · {speech.performance}</p>
        ) : null}
        {speech.intent ? (
          <p className="ww-speech-intent">💭 {speech.intent}</p>
        ) : null}
      </div>
    </section>
  );
}
