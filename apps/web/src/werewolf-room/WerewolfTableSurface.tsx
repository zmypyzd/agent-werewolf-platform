import { useRef, useState } from 'react';
import type { WerewolfRoomState, SeatVM, WerewolfRole } from './werewolfRoomTypes.js';
import { WerewolfSpeechBoard } from './WerewolfSpeechBoard.js';
import { AgentPickerPopover } from './AgentPickerPopover.js';
import { useStickyValue } from './useStickyValue.js';

// Mirror the speech-board hold so the seat replay glow on the last day-speech
// speaker stays visible for the same window the booth shows their words.
// Without this, the seat would lose its "JUST SPOKE" glow the instant
// phase.changed fires while the booth still displays the speech, leaving the
// user with text on the booth but no visual anchor on the table.
const SEAT_REPLAY_STICKY_MS = 4000;

export interface WerewolfTableSurfaceProps {
  state: WerewolfRoomState;
  // Called when the user picks "邀请 NPC" from the per-seat popover. Parent
  // POSTs to /seats/:i/invite-npc and refreshes lobby.
  onInvite?: (seatIndex: number) => Promise<void> | void;
  // Called when the user picks one of their registered agents from the
  // popover. Parent POSTs to /seats/:i/invite-agent and refreshes lobby.
  // Throws a propagated error so the popover can render server-side error
  // codes (AGENT_IN_USE, SEAT_OCCUPIED, etc.).
  onInviteAgent?: (seatIndex: number, agentConfigId: string) => Promise<void>;
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

// ISSUE-004 — mid-match dead seats now display the cause instead of the
// generic "已淘汰", so the 9-seat board doubles as a death-cause dashboard
// without the user having to scan the right-side timeline.
const CAUSE_OF_DEATH_LABELS: Record<NonNullable<SeatVM['causeOfDeath']>, string> = {
  'wolf-kill':    '✝ 被狼刀',
  'witch-poison': '✝ 被毒',
  'banishment':   '✝ 被放逐',
  'hunter-shoot': '✝ 被开枪',
};

interface SeatCardProps {
  seat: SeatVM;
  pos: { left: string; top: string };
  speaking: boolean;
  // True when this seat is the subject of state.currentSpeech but
  // speakingActor has cleared (the gap window between speakers). Keeps the
  // seat highlight in sync with the center speech panel so the user always
  // sees the same person highlighted in both places. The thinking state
  // (next agent being requested) is intentionally NOT rendered on the
  // surface — only the active speaker (LIVE) and the most-recent speaker
  // (SPOKE) are shown, so the table only ever highlights one seat and the
  // user's eye doesn't get pulled to a non-speaking seat.
  replaying: boolean;
  revealRoles: boolean;
  // D3=C — clicking an empty seat opens the picker popover. Owner is
  // WerewolfTableSurface; SeatCard reports both the seat index and the
  // viewport rect of the seat element so the popover (rendered into a
  // Portal) can position itself against the actual seat coords rather than
  // depending on DOM nesting (the seat-arc container is overflow-clipped).
  onEmptyClick?: (seatIndex: number, rect: DOMRect, triggerEl: HTMLElement) => void;
}

function SeatCard({ seat, pos, speaking, replaying, revealRoles, onEmptyClick }: SeatCardProps) {
  const isEmpty = seat.occupant.kind === 'empty';
  const dead = !seat.alive && !isEmpty;
  const isWolf = seat.revealedRole === 'werewolf';
  // D5=A — owner-only marker, server-computed via auth-aware projection.
  const isMine = seat.occupant.kind === 'agent' && seat.occupant.isMine === true;
  const isAgent = seat.occupant.kind === 'agent';

  const cardClass = [
    'ww-seat',
    isEmpty ? 'is-empty' : '',
    dead ? 'is-dead' : '',
    speaking ? 'is-speaking' : '',
    replaying ? 'is-replay' : '',
    isMine ? 'is-mine' : '',
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
    if (seat.causeOfDeath) {
      // Cause-of-death is the freshest, most-dynamic info on a dead seat
      // and never duplicates the role badge (which already shows on top of
      // the card via roleEmoji). Wins over the role label in every mode —
      // mid-match spectator broadcast view, and post-match scoreboard.
      statusText = CAUSE_OF_DEATH_LABELS[seat.causeOfDeath];
    } else if (revealRoles && seat.revealedRole) {
      // Fallback for dead seats whose elimination event arrived without a
      // cause (legacy replays, schema-failed events). Role is still useful
      // signal there.
      statusText = `✝ ${ROLE_LABELS[seat.revealedRole]}`;
    } else {
      statusText = '✝ 已淘汰';
    }
  } else if (speaking) {
    statusText = 'speaking…';
  } else if (replaying) {
    statusText = 'just spoke';
  } else if (revealRoles && seat.revealedRole) {
    // Match ended — survivors should display their role like the dead, not
    // a stale "waiting" left over from the lobby. Without this branch the
    // post-match scoreboard read as "Bot 1 waiting" for every survivor.
    statusText = ROLE_LABELS[seat.revealedRole];
  } else {
    statusText = 'waiting';
  }

  const statusClass = [
    'ww-seat-status',
    dead ? 'is-dead' : '',
    speaking ? 'is-speaking' : '',
    replaying ? 'is-replay' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // D2=A — kind:'agent' renders displayName same as kind:'npc' (no '???'
  // fallback). The MINE pill is rendered ONLY when seat.occupant.isMine is
  // true — derived server-side, never client-side.
  let seatName = '???';
  if (seat.occupant.kind === 'npc' || seat.occupant.kind === 'agent') {
    seatName = seat.occupant.displayName;
  }

  // a11y: collapse the seat's mixed visual cues (color borders, opacity for
  // dead, "LIVE" pill) into a single text label that screen readers can
  // announce in one read. Without this the SR walks each child div and emits
  // a fragmented "P1, ⚔️, Bot 1, speaking…" sequence with no top-level
  // identity for the seat. The aria-label always leads with the seat number
  // so users navigating by landmark get an anchor.
  const ariaLabelParts: string[] = [`P${seat.seatIndex + 1}`];
  if (isEmpty) {
    ariaLabelParts.push('空座位');
  } else {
    ariaLabelParts.push(seatName);
    if (dead) {
      ariaLabelParts.push(seat.causeOfDeath ? CAUSE_OF_DEATH_LABELS[seat.causeOfDeath] : '已淘汰');
    } else {
      ariaLabelParts.push('存活');
    }
    if (revealRoles && seat.revealedRole) {
      ariaLabelParts.push(`身份: ${ROLE_LABELS[seat.revealedRole]}`);
    }
    if (speaking) ariaLabelParts.push('正在发言');
    else if (replaying) ariaLabelParts.push('刚刚发言');
    if (isMine) ariaLabelParts.push('你的 agent');
  }
  const ariaLabel = ariaLabelParts.join(' · ');

  return (
    <div
      className={cardClass}
      style={{ left: pos.left, top: pos.top }}
      data-seat-index={seat.seatIndex}
      role="group"
      aria-label={ariaLabel}
    >
      {isMine ? (
        <span className="ww-seat-mine-pill" aria-label="你的 agent">MINE</span>
      ) : null}
      <div className={badgeClass}>{roleEmoji}</div>
      <div className="ww-seat-id">P{seat.seatIndex + 1}</div>
      {isEmpty ? (
        <>
          <div className="ww-seat-name" style={{ color: 'var(--ww-text-dim)' }}>empty</div>
          <button
            className="ww-seat-invite"
            onClick={(e) => {
              const btn = e.currentTarget;
              const seatEl = btn.closest('.ww-seat');
              if (!seatEl || !onEmptyClick) return;
              onEmptyClick(
                seat.seatIndex,
                seatEl.getBoundingClientRect(),
                btn as HTMLElement,
              );
            }}
            disabled={!onEmptyClick}
            aria-haspopup="dialog"
          >
            邀请...
          </button>
        </>
      ) : (
        <>
          <div className="ww-seat-name">{seatName}</div>
          <div className={statusClass}>{statusText}</div>
          {isAgent ? <span className="ww-seat-agent-tag">AGENT</span> : null}
        </>
      )}
    </div>
  );
}

export function WerewolfTableSurface({
  state,
  onInvite,
  onInviteAgent,
}: WerewolfTableSurfaceProps) {
  // D3=C — clicking an empty seat opens the picker popover anchored to it.
  // null when no popover is open. Limited to one seat at a time.
  // Stores both seatIndex and the viewport rect captured at click-time so the
  // popover can position itself against the real seat coordinates without
  // depending on DOM ancestry (seat-arc has overflow:hidden upstream).
  const [pickerAnchor, setPickerAnchor] = useState<
    { seatIndex: number; rect: DOMRect } | null
  >(null);
  // Ref (not state) holds the most-recently-opened invite button so we can
  // restore keyboard focus to it after the popover closes. Stored in a ref
  // because focusing on close shouldn't trigger an extra re-render, and the
  // DOM element identity outlives any state change.
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const handlePickerClose = () => {
    const target = lastTriggerRef.current;
    setPickerAnchor(null);
    // Defer focus to the next animation frame so React has a chance to
    // unmount the popover first; otherwise the focus call can race with
    // the popover's own teardown and land on document.body.
    if (target) {
      requestAnimationFrame(() => {
        target.focus();
      });
    }
  };
  // ISSUE-005 — broadcast view: roles are visible to spectators from
  // match-start. The reducer lifts revealedRole onto each SeatVM as soon as
  // match.started arrives, so the gate now follows seat data instead of
  // status. Pre-match (lobby) the seats have no revealedRole and the table
  // still renders generic placeholders, so the lobby UX is unchanged.
  const revealRoles = state.seats.some((s) => s.revealedRole !== undefined);

  const isNight =
    typeof state.currentPhase === 'string' &&
    state.currentPhase.startsWith('night-');

  // Mirror the booth's display logic: live speech wins (live glow), else
  // fade lastSpeech for the same window so the seat-glow tracks the booth.
  // Reading lastSpeech (not currentSpeech) sidesteps the React-18-batching
  // case where the LAST day-speech speaker's currentSpeech is set and
  // cleared in one render — the reducer captures lastSpeech sequentially
  // even when renders collapse. See WerewolfSpeechBoard for the full
  // rationale.
  const fadingLast = useStickyValue(state.lastSpeech, SEAT_REPLAY_STICKY_MS);
  const replaySpeech = state.currentSpeech ?? fadingLast;

  return (
    <div className={`ww-board-wrapper${isNight ? '' : ' is-day'}`}>
      <div className="ww-board-night-overlay" />
      <div className="ww-seat-arc">
        {state.seats.map((seat, i) => {
          const pos = SEAT_POSITIONS[i] ?? { left: '50%', top: '50%' };
          const isLive = state.speakingActor === seat.playerId;
          // Replay: booth still shows this seat's last speech (the sticky
          // value), but speakingActor has already cleared (next agent is
          // being requested OR phase advanced into voting). The amber glow
          // used to live on the next thinker — we moved it here so the
          // seat-glow always points at the same person the center panel is
          // showing.
          const isReplay =
            !state.speakingActor && replaySpeech?.actorId === seat.playerId;
          return (
            <SeatCard
              key={seat.seatIndex}
              seat={seat}
              pos={pos}
              speaking={isLive}
              replaying={isReplay}
              revealRoles={revealRoles}
              {...(onInvite || onInviteAgent
                ? {
                    onEmptyClick: (i: number, rect: DOMRect, triggerEl: HTMLElement) => {
                      lastTriggerRef.current = triggerEl;
                      setPickerAnchor({ seatIndex: i, rect });
                    },
                  }
                : {})}
            />
          );
        })}
        <WerewolfSpeechBoard state={state} />
        {pickerAnchor !== null && (onInvite || onInviteAgent) ? (
          <AgentPickerPopover
            seatIndex={pickerAnchor.seatIndex}
            anchorRect={{
              left: pickerAnchor.rect.left,
              top: pickerAnchor.rect.top,
              bottom: pickerAnchor.rect.bottom,
              width: pickerAnchor.rect.width,
            }}
            onInviteNpc={async (i) => {
              if (onInvite) await onInvite(i);
            }}
            onInviteAgent={async (i, cfgId) => {
              if (onInviteAgent) await onInviteAgent(i, cfgId);
            }}
            onClose={handlePickerClose}
          />
        ) : null}
      </div>
    </div>
  );
}
