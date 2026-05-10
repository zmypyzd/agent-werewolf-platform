import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { SseClient, type SseMessage, werewolfStreamUrl } from '../lib/sse.js';
import {
  emptyRoomState,
  type WerewolfReplayEvent,
  type WerewolfReplayEventType,
} from '../werewolf-room/werewolfRoomTypes.js';
import {
  werewolfRoomReducer,
  type WerewolfRoomAction,
} from '../werewolf-room/werewolfRoomReducer.js';
import { WerewolfTableSurface } from '../werewolf-room/WerewolfTableSurface.js';
import { WerewolfPhaseIndicator } from '../werewolf-room/WerewolfPhaseIndicator.js';
import { WerewolfEventTimeline } from '../werewolf-room/WerewolfEventTimeline.js';

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
  const [state, dispatch] = useReducer(werewolfRoomReducer, gameId, emptyRoomState);
  const [error, setError] = useState<string | null>(null);
  const sseRef = useRef<SseClient | null>(null);

  const fetchEntry = useCallback(async () => {
    try {
      const entry = await api.get<ServerLobbyEntry>(
        `/werewolf-games/${encodeURIComponent(gameId)}`,
      );
      dispatch({ type: 'lobby-sync', entry });
      if (entry.status === 'completed' && entry.winner && entry.finalPlayers) {
        dispatch({
          type: 'match-completed',
          winner: entry.winner,
          finalPlayers: entry.finalPlayers,
        });
      }
      if (entry.status === 'failed' && entry.failureReason) {
        dispatch({ type: 'match-failed', reason: entry.failureReason });
      }
      return entry;
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

  return (
    <div className="ww-room">
      <header className="ww-room-header">
        <h1 className="ww-room-title">
          狼人杀房间
          <span>· {state.gameId.slice(0, 8)}</span>
        </h1>
        <button onClick={() => navigate('/werewolf')} className="ww-back">
          返回大厅
        </button>
      </header>

      <WerewolfPhaseIndicator state={state} />

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
          <WerewolfTableSurface state={state} />
          <WerewolfEventTimeline lines={state.timeline} />
        </div>
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
    </div>
  );
}
