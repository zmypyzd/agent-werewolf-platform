// Omniscient-mode werewolf table — renders 9 seats in 1+3+3+2 layout
// using AI-generated role-art portraits. Co-exists with WerewolfTableSurface;
// callers choose which to render based on view mode (omniscient vs. hidden).
// Approved direction: see /Users/zmy/.gstack/projects/5-4-claude/designs/
// werewolf-twitch-livestream-20260518/approved.json
import type { CSSProperties, ReactNode } from 'react';
import type { SeatVM, WerewolfRole, WerewolfSide } from './werewolfRoomTypes.js';
import { inferModelTag } from './inferModelTag.js';

// Seat position class maps seatIndex (0-8) to layout slot (p1-p9).
// The mapping follows the user's approved 1+3+3+2 layout:
//   P1 (top center), P9 P2 (upper sides), P8 P3 (mid sides), P7 P4
//   (lower sides), P6 P5 (bottom center pair).
const SEAT_SLOT_CLASS: readonly string[] = [
  'is-p1', 'is-p2', 'is-p3', 'is-p4', 'is-p5',
  'is-p6', 'is-p7', 'is-p8', 'is-p9',
];

// Side classification per werewolf rules — wolves vs. good team.
function roleSide(role: WerewolfRole): WerewolfSide {
  return role === 'werewolf' ? 'werewolf' : 'good';
}

// Short role corner glyphs (single-char unicode).
const ROLE_CORNER_GLYPH: Record<WerewolfRole, string> = {
  werewolf: '⚔',
  villager: '⌂',
  seer: '◐',
  witch: '⚗',
  hunter: '⊕',
};

// Public asset paths — webp portraits live in apps/web/public/role-art/.
const ROLE_ART_SRC: Record<WerewolfRole, string> = {
  werewolf: '/role-art/werewolf.webp',
  villager: '/role-art/villager.webp',
  seer: '/role-art/seer.webp',
  witch: '/role-art/witch.webp',
  hunter: '/role-art/hunter.webp',
};

// Localized role name (uppercased, displayed in role-name pill).
const ROLE_NAME_LABEL: Record<WerewolfRole, string> = {
  werewolf: 'WEREWOLF',
  villager: 'VILLAGER',
  seer: 'SEER',
  witch: 'WITCH',
  hunter: 'HUNTER',
};

// Side label inside the side pill.
const SIDE_LABEL: Record<WerewolfSide, string> = {
  werewolf: 'WOLF',
  good: 'GOOD',
};

// Human-readable cause-of-death suffix (matches existing seat-status copy).
const DEATH_CAUSE_LABEL: Record<NonNullable<SeatVM['causeOfDeath']>, string> = {
  'wolf-kill': 'wolf-kill',
  'witch-poison': 'witch-poison',
  'banishment': 'banishment',
  'hunter-shoot': 'hunter-shoot',
};

export interface OmniscientRoleEntry {
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
}

// Map from seatIndex (0-8) to a fixed role. When provided, all roles are
// shown openly to the spectator regardless of `seat.revealedRole`. Use this
// in spectator/observer mode where the full lineup is intentionally public.
export type OmniscientRolesMap = Readonly<Record<number, OmniscientRoleEntry>>;

export interface WerewolfOmniscientTableProps {
  readonly seats: readonly SeatVM[];
  // The repo runs with `exactOptionalPropertyTypes: true`, so optional
  // props must explicitly include `| undefined` to accept callers that
  // pass undefined directly (e.g. `state.speakingActor` from the reducer).
  readonly speakingActor?: string | undefined;
  readonly thinkingActor?: string | undefined;
  readonly omniscientRoles?: OmniscientRolesMap | undefined;
  readonly currentPhaseTag?: string | undefined;
  // Optional slot rendered as a child of .ww-omni-board. Callers pass the
  // center testimony / speech-board JSX here so it positions itself over
  // the seat ring (the slot's content owns its own absolute positioning;
  // .ww-omni-board is already position:relative).
  readonly centerSlot?: ReactNode;
}

// Resolve which role to display for a given seat. Omniscient map wins; else
// the seat's own revealedRole (populated at death/game-end). Returns undefined
// when neither source is available — caller renders an unknown placeholder.
function resolveRole(
  seat: SeatVM,
  omniscient: OmniscientRolesMap | undefined,
): OmniscientRoleEntry | undefined {
  const omni = omniscient?.[seat.seatIndex];
  if (omni) return omni;
  if (seat.revealedRole) {
    const side = seat.revealedSide ?? roleSide(seat.revealedRole);
    return { role: seat.revealedRole, side };
  }
  return undefined;
}

export function WerewolfOmniscientTable(props: WerewolfOmniscientTableProps) {
  const { seats, speakingActor, thinkingActor, omniscientRoles, currentPhaseTag, centerSlot } = props;

  return (
    <section
      aria-label="werewolf omniscient table"
      className="ww-omni-board"
    >
      <div className="ww-omni-board-head">
        <b>TRIBUNAL TABLE · SPECTATOR ROLE NAMETAGS</b>
        {currentPhaseTag ? (
          <span className="ww-omni-lens">{currentPhaseTag}</span>
        ) : (
          <span>observer view · all roles visible</span>
        )}
      </div>

      {seats.map((seat) => {
        const slot = SEAT_SLOT_CLASS[seat.seatIndex] ?? 'is-p1';
        const occupantName = renderOccupantName(seat);
        const playerId = seat.playerId;
        const resolvedRole = resolveRole(seat, omniscientRoles);
        const isSpeaking = !!speakingActor && speakingActor === playerId;
        const isThinking = !!thinkingActor && thinkingActor === playerId && !isSpeaking;
        const isDead = !seat.alive;

        const classes = [
          'ww-omni-card',
          slot,
          isSpeaking ? 'is-speaking' : null,
          isThinking ? 'is-thinking' : null,
          isDead ? 'is-dead' : null,
          resolvedRole ? `is-role-${resolvedRole.role}` : null,
        ].filter(Boolean).join(' ');

        const modelTag = inferModelTag(occupantName);

        return (
          <article
            key={seat.playerId}
            aria-label={`P${seat.seatIndex + 1} ${occupantName}${resolvedRole ? ` ${ROLE_NAME_LABEL[resolvedRole.role]}` : ''}`}
            className={classes}
            style={undefined as CSSProperties | undefined}
          >
            <span className="ww-omni-seat-id">P{seat.seatIndex + 1}</span>

            <div className="ww-omni-art-wrap">
              {resolvedRole ? (
                <img
                  alt={`${resolvedRole.role} role art`}
                  className="ww-omni-art"
                  src={ROLE_ART_SRC[resolvedRole.role]}
                />
              ) : (
                <div className="ww-omni-art" aria-hidden="true" style={{ background: 'rgba(255,255,255,.04)' }} />
              )}
              {resolvedRole ? (
                <span className="ww-omni-role-corner" aria-hidden="true">
                  {ROLE_CORNER_GLYPH[resolvedRole.role]}
                </span>
              ) : null}
            </div>

            <div className="ww-omni-info">
              <div className="ww-omni-topline">
                <div>
                  <div className="ww-omni-name">{occupantName}</div>
                  {modelTag ? <div className="ww-omni-model">{modelTag} · agent seat</div> : null}
                </div>
                <span className={`ww-omni-state ${isDead ? 'is-dead' : 'is-alive'}`}>
                  <span aria-hidden="true" />
                  {isDead ? 'DEAD' : 'ALIVE'}
                </span>
              </div>

              {resolvedRole ? (
                <div className="ww-omni-role-line">
                  <span className="ww-omni-role-name">{ROLE_NAME_LABEL[resolvedRole.role]}</span>
                  <span className={`ww-omni-side is-${resolvedRole.side === 'werewolf' ? 'wolf' : 'good'}`}>
                    {SIDE_LABEL[resolvedRole.side]}
                  </span>
                </div>
              ) : null}

              <div className="ww-omni-footer">
                {isDead && seat.causeOfDeath ? (
                  <span className="ww-omni-micro-meta">{DEATH_CAUSE_LABEL[seat.causeOfDeath]}</span>
                ) : isSpeaking ? (
                  <>
                    <span className="ww-omni-air-badge"><span aria-hidden="true" />ON AIR</span>
                    <span className="ww-omni-mini-wave" aria-hidden="true">
                      <i /><i /><i /><i /><i />
                    </span>
                  </>
                ) : isThinking ? (
                  <span className="ww-omni-think-badge">THINKING</span>
                ) : null}
              </div>
            </div>

            {isDead ? <span aria-hidden="true" className="ww-omni-death-cut" /> : null}
            {isDead && resolvedRole ? (
              <span className="ww-omni-death-label">{ROLE_NAME_LABEL[resolvedRole.role]} · REVEALED</span>
            ) : null}
          </article>
        );
      })}

      {centerSlot}
    </section>
  );
}

function renderOccupantName(seat: SeatVM): string {
  if (seat.occupant.kind === 'empty') return `Seat ${seat.seatIndex + 1}`;
  return seat.occupant.displayName;
}
