import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { SseClient, type SseMessage, werewolfStreamUrl } from '../lib/sse.js';
import {
  emptyRoomState,
  type SeatVM,
  type WerewolfReplayEvent,
  type WerewolfReplayEventType,
} from '../werewolf-room/werewolfRoomTypes.js';
import {
  werewolfRoomReducer,
  type WerewolfRoomAction,
} from '../werewolf-room/werewolfRoomReducer.js';
import { WerewolfTableSurface } from '../werewolf-room/WerewolfTableSurface.js';
import {
  WerewolfOmniscientTable,
  type OmniscientRolesMap,
} from '../werewolf-room/WerewolfOmniscientTable.js';
import { WerewolfPhaseIndicator } from '../werewolf-room/WerewolfPhaseIndicator.js';
import { WerewolfEventTimeline } from '../werewolf-room/WerewolfEventTimeline.js';
import { WerewolfSpeechBoard } from '../werewolf-room/WerewolfSpeechBoard.js';
import { inferModelTag } from '../werewolf-room/inferModelTag.js';
import { MatchMetaStrip } from '../components/MatchMetaStrip.js';
import { StatsPanel } from '../components/StatsPanel.js';
import { AudienceStrip } from '../components/AudienceStrip.js';

// Pulled from apps/web/package.json. Hardcoded here so the meta strip can
// surface an engine-version badge without wiring a Vite define. Update by
// hand when bumping the web app version — caught easily in PR review.
const APP_VERSION = 'v0.1.0';

// Episode label derived deterministically from the gameId so every match
// gets a stable "EP-N" affordance that matches the approved meta-strip
// design, without the backend having to track episodes. Pure presentation.
function deriveEpisodeLabel(gameId: string): string {
  const hex = gameId.replace(/-/g, '').slice(0, 6);
  const n = parseInt(hex, 16);
  return `EP-${Number.isFinite(n) ? n % 1000 : 0}`;
}

// Tally seats by inferred model family so the meta strip can render a
// "3×GPT-4 · 4×Claude · 2×Llama" string. Returns undefined when no seat
// matches a known agent-name pattern (caller hides the cell).
function buildModelMatchup(seats: readonly SeatVM[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of seats) {
    if (s.occupant.kind === 'empty') continue;
    const m = inferModelTag(s.occupant.displayName);
    if (!m) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n}×${m}`)
    .join(' · ');
}

// Demo omniscient lineup — hardcoded role map matching the approved R-K
// mockup (3 wolves, 1 seer, 1 witch, 1 hunter, 3 villagers). The backend
// does NOT expose live roles to spectators (information isolation invariant
// in CLAUDE.md), so this is a CLIENT-ONLY preview map used when the user
// opts into `?view=omniscient`. Real omniscient integration would route
// through a separate server-side spectator-mode endpoint with explicit
// permission, which is out of scope for the visual mockup wire-up.
const DEMO_OMNISCIENT_ROLES: OmniscientRolesMap = {
  0: { role: 'villager', side: 'good' },
  1: { role: 'werewolf', side: 'werewolf' },
  2: { role: 'seer', side: 'good' },
  3: { role: 'werewolf', side: 'werewolf' },
  4: { role: 'werewolf', side: 'werewolf' },
  5: { role: 'witch', side: 'good' },
  6: { role: 'villager', side: 'good' },
  7: { role: 'hunter', side: 'good' },
  8: { role: 'villager', side: 'good' },
};

type ServerLobbyEntry = Extract<
  WerewolfRoomAction,
  { type: 'lobby-sync' }
>['entry'];

const POLL_WAITING_MS = 2000;
const POLL_RUNNING_MS = 5000;
// Auto-dismiss the page-level error banner so a transient invite failure
// (e.g., "Seat X in game Y is already occupied" when two users race for the
// same empty seat) doesn't pin a stale red box on the room for the rest of
// the session. 5s is long enough to read the message; the × button below
// lets users dismiss faster.
const ERROR_AUTO_DISMISS_MS = 5000;

export function WerewolfRoomPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?view=omniscient toggles the approved R-K-polished spectator design
  // (1+3+3+2 layout with role-art portraits). When off, the room renders
  // the original WerewolfTableSurface unchanged. Flag is intentionally
  // URL-only for now so the new design can be exercised side-by-side with
  // the existing one without touching state stores or feature flags.
  const omniscientView = searchParams.get('view') === 'omniscient';
  const [state, dispatch] = useReducer(werewolfRoomReducer, gameId, emptyRoomState);
  const [error, setError] = useState<string | null>(null);
  // Track the most-recent ServerLobbyEntry so MatchMetaStrip can read name
  // and startedAt without us re-deriving them from the reducer (the reducer
  // intentionally normalizes seats/timeline but drops the raw entry fields
  // we don't need for game logic). Updated on every fetchEntry success.
  const [entry, setEntry] = useState<ServerLobbyEntry | null>(null);
  const sseRef = useRef<SseClient | null>(null);

  const fetchEntry = useCallback(async () => {
    try {
      const next = await api.get<ServerLobbyEntry>(
        `/werewolf-games/${encodeURIComponent(gameId)}`,
      );
      setEntry(next);
      dispatch({ type: 'lobby-sync', entry: next });
      if (next.status === 'completed' && next.winner && next.finalPlayers) {
        dispatch({
          type: 'match-completed',
          winner: next.winner,
          finalPlayers: next.finalPlayers,
        });
      }
      if (next.status === 'failed' && next.failureReason) {
        dispatch({ type: 'match-failed', reason: next.failureReason });
      }
      return next;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load room');
      return null;
    }
  }, [gameId]);

  useEffect(() => {
    void fetchEntry();
  }, [fetchEntry]);

  // Auto-dismiss the error banner. Setting `error` again resets the timer
  // so the latest message gets the full read window. Manual × dismiss is
  // wired below.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (state.status === 'completed' || state.status === 'failed') return;
    const ms = state.status === 'running' ? POLL_RUNNING_MS : POLL_WAITING_MS;
    const id = setInterval(() => {
      void fetchEntry();
    }, ms);
    return () => clearInterval(id);
  }, [state.status, fetchEntry]);

  useEffect(() => {
    if (state.status !== 'running') return;
    // SSE replaces the prior WebSocket subscription. The topic is
    // baked into the URL path (/api/v1/werewolf/stream/<gameId>) so
    // there is no client-initiated subscribe handshake — opening the
    // EventSource is the subscription.
    const topic = `match:${gameId}`;
    const sse = new SseClient(werewolfStreamUrl(gameId));
    sseRef.current = sse;
    sse.connect();
    const off = sse.on((m: SseMessage) => {
      if (m.topic !== topic) return;
      const event: WerewolfReplayEvent = {
        eventId: (m.payload['eventId'] as string) ?? `evt-${Date.now()}`,
        gameId,
        sequence: (m.payload['sequence'] as number) ?? 0,
        eventType: m.type as WerewolfReplayEventType,
        timestamp: (m.payload['timestamp'] as number) ?? Date.now(),
        data: m.payload,
      };
      dispatch({ type: 'replay-event', event });
    });
    return () => {
      off();
      sse.close();
      sseRef.current = null;
    };
  }, [state.status, gameId]);

  async function inviteNpc(seatIndex: number) {
    try {
      await api.post(
        `/werewolf-games/${encodeURIComponent(gameId)}/seats/${seatIndex}/invite-npc`,
        {},
      );
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Invite failed');
    }
  }

  // D2=A / plan Lane C — POST mirror of inviteNpc but seats one of the user's
  // registered HTTP agents. Errors propagate to AgentPickerPopover, which
  // owns the UX surface for invite errors and renders localized copy for
  // server-side codes (AGENT_NOT_FOUND, AGENT_IN_USE, SEAT_OCCUPIED). We
  // deliberately do NOT mirror the raw message into the page-level error
  // banner here — that banner has no dismiss affordance and would leave the
  // English error string stuck on screen after the popover closed.
  async function inviteAgent(seatIndex: number, agentConfigId: string) {
    await api.post(
      `/werewolf-games/${encodeURIComponent(gameId)}/seats/${seatIndex}/invite-agent`,
      { agentConfigId },
    );
    await fetchEntry();
  }

  async function startMatch() {
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/start`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Start failed');
    }
  }

  // POST /werewolf-games/:gameId/fill-with-npcs — backend route exists in
  // werewolf-games.ts:127 but had no UI affordance until now. Saves users
  // from having to click "邀请 NPC" up to 9 times to seat a full house bot
  // game. Disabled while the request is in-flight to avoid double-submit.
  const [filling, setFilling] = useState(false);
  async function fillWithNpcs() {
    if (filling) return;
    setFilling(true);
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/fill-with-npcs`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '一键填充 NPC 失败');
    } finally {
      setFilling(false);
    }
  }
  const emptySeatCount = state.seats.filter((s) => s.occupant.kind === 'empty').length;

  const isLive = state.status === 'running' || state.status === 'completed';

  // Memoize the omniscient roles so React doesn't see a new object on every
  // render — keeps WerewolfOmniscientTable's prop identity stable.
  const omniscientRoles = useMemo(() => DEMO_OMNISCIENT_ROLES, []);
  const omniscientPhaseTag = useMemo(() => {
    if (!omniscientView) return undefined;
    return `${state.currentPhase} · observer view`;
  }, [omniscientView, state.currentPhase]);

  return (
    <div className={`ww-room${omniscientView ? ' is-omniscient' : ''}`}>
      <header className="ww-room-header">
        <button onClick={() => navigate('/werewolf')} className="ww-back">
          ← 返回大厅
        </button>
        {omniscientView ? (
          <span className="ww-observer-chip" aria-label="observer mode active">
            OBSERVER ROLES ON
          </span>
        ) : null}
      </header>

      <MatchMetaStrip
        state={state}
        name={entry?.name}
        startedAt={entry?.startedAt}
        episodeLabel={deriveEpisodeLabel(state.gameId)}
        modelMatchup={buildModelMatchup(state.seats)}
        engineVersion={APP_VERSION}
        observerMode={omniscientView}
      />

      <WerewolfPhaseIndicator state={state} />

      {omniscientView ? (
        <p className="ww-observer-sub" aria-live="polite">
          Observer mode: all roles are visible to the spectator. Wired via
          <code> ?view=omniscient</code> · demo lineup is client-side only.
        </p>
      ) : null}

      {error ? (
        <div className="ww-error" role="alert">
          <span className="ww-error-text">{error}</span>
          <button
            type="button"
            className="ww-error-dismiss"
            aria-label="关闭错误提示"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {isLive ? (
        <div className="ww-game-area">
          <StatsPanel state={state} />
          {omniscientView ? (
            <WerewolfOmniscientTable
              seats={state.seats}
              speakingActor={state.speakingActor}
              thinkingActor={state.thinkingActor}
              omniscientRoles={omniscientRoles}
              currentPhaseTag={omniscientPhaseTag}
              centerSlot={<WerewolfSpeechBoard state={state} />}
            />
          ) : (
            <WerewolfTableSurface state={state} />
          )}
          <WerewolfEventTimeline lines={state.timeline} />
        </div>
      ) : omniscientView ? (
        <WerewolfOmniscientTable
          seats={state.seats}
          speakingActor={state.speakingActor}
          thinkingActor={state.thinkingActor}
          omniscientRoles={omniscientRoles}
          currentPhaseTag={omniscientPhaseTag}
        />
      ) : (
        <WerewolfTableSurface
          state={state}
          onInvite={inviteNpc}
          onInviteAgent={inviteAgent}
        />
      )}

      {state.status === 'waiting' && emptySeatCount > 0 ? (
        <button
          type="button"
          className="ww-fill-npcs"
          onClick={fillWithNpcs}
          disabled={filling}
          aria-busy={filling}
        >
          {filling ? '填充中…' : `一键邀请 ${emptySeatCount} 个 NPC`}
        </button>
      ) : null}

      {state.status === 'ready' ? (
        <button className="ww-start" onClick={startMatch}>
          开始对局
        </button>
      ) : null}

      {state.status === 'completed' ? (
        <div className={`ww-banner${state.winner === 'werewolf' ? ' is-wolf-win' : ''}`}>
          🏁 终局：{state.winner === 'good' ? '好人胜' : '狼人胜'}
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <div className="ww-banner is-error">
          异常终止：{state.failureReason ?? '未知错误'}
        </div>
      ) : null}

      {isLive ? (
        <AudienceStrip episodeId={state.gameId} />
      ) : null}
    </div>
  );
}
