import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { WsClient, type WsMessage } from '../lib/ws.js';
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

export function WerewolfRoomPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(werewolfRoomReducer, gameId, emptyRoomState);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WsClient | null>(null);

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
    const ws = new WsClient();
    wsRef.current = ws;
    ws.connect();
    const topic = `match:${gameId}`;
    ws.subscribe(topic);
    const off = ws.on((m: WsMessage) => {
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
      ws.unsubscribe(topic);
      ws.close();
      wsRef.current = null;
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

  async function fillAll() {
    try {
      await api.post(
        `/werewolf-games/${encodeURIComponent(gameId)}/fill-with-npcs`,
        {},
      );
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fill failed');
    }
  }

  async function startMatch() {
    try {
      await api.post(`/werewolf-games/${encodeURIComponent(gameId)}/start`, {});
      await fetchEntry();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Start failed');
    }
  }

  return (
    <div className="werewolf-room">
      <header className="werewolf-room-header">
        <h1>狼人杀房间 · {state.gameId.slice(0, 8)}</h1>
        <button onClick={() => navigate('/werewolf')} className="werewolf-back">
          返回大厅
        </button>
      </header>
      <WerewolfPhaseIndicator state={state} />
      {error ? <div className="werewolf-error">{error}</div> : null}

      {state.status === 'waiting' || state.status === 'ready' ? (
        <>
          <WerewolfTableSurface state={state} onInvite={inviteNpc} onFillAll={fillAll} />
          {state.status === 'ready' ? (
            <button className="werewolf-start" onClick={startMatch}>
              开始对局
            </button>
          ) : null}
        </>
      ) : (
        <div className="werewolf-room-live">
          <WerewolfTableSurface state={state} />
          <WerewolfEventTimeline lines={state.timeline} />
        </div>
      )}

      {state.status === 'completed' ? (
        <div className="werewolf-banner">
          🏁 终局：{state.winner === 'good' ? '好人胜' : '狼人胜'}
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div className="werewolf-banner werewolf-banner-error">
          异常终止：{state.failureReason ?? '未知错误'}
        </div>
      ) : null}
    </div>
  );
}
