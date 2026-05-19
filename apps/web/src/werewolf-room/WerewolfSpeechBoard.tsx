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
  // Read lastSpeech through the fade hook so the LAST day-speech speaker
  // shows for the same window as everyone else (~4s) before the booth
  // clears. lastSpeech is captured by the reducer at action_received time
  // and survives the immediate phase.changed → day-vote that React 18
  // batches into one render — currentSpeech alone misses that case
  // because the batched render already has it cleared. Live speech
  // (currentSpeech) wins when present so the "ON AIR" badge stays
  // accurate for the in-progress speaker.
  const fadingLast = useStickyValue(state.lastSpeech, SPEECH_STICKY_MS);
  const speech = state.currentSpeech ?? fadingLast;
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
      {/* Testimony-style header: pin + STATEMENT marker + live state badge.
          Matches the approved Pretext-native finalized.html testimony layout
          (40px-ish row with `📌` pinned-statement affordance on the left,
          status pill on the right). */}
      <header className="ww-speech-top">
        <div className="ww-speech-pin">
          <span className="ww-speech-pin-icon" aria-hidden="true">📌</span>
          <span className="ww-speech-pin-label">
            STATEMENT{seatTag ? ` · ${seatTag}` : ''}
          </span>
        </div>
        <span className={`ww-speech-live${isLive ? '' : ' is-replay'}`}>
          {isLive ? 'ON AIR' : 'JUST SPOKE'}
        </span>
      </header>

      {/* Testimony body: 64px speaker token on the left, blockquote +
          tags on the right. Token shows the role emoji + display name +
          role label (CN · EN). Quote is the actual speech text. */}
      <div className="ww-speech-body">
        <div className="ww-speech-token">
          <div className="ww-speech-avatar" aria-hidden="true">{avatar}</div>
          <div className="ww-speech-name">{displayName}</div>
          <div className="ww-speech-role">{roleLabel}</div>
        </div>
        <div className="ww-speech-quote">
          <blockquote className="ww-speech-text">{speech.text || '…'}</blockquote>
          {(speech.performance || speech.intent) ? (
            <div className="ww-speech-tags">
              {speech.performance ? (
                <span className="ww-speech-perf">演技 · {speech.performance}</span>
              ) : null}
              {speech.intent ? (
                <span className="ww-speech-intent">💭 {speech.intent}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
