import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import type { WerewolfLobbySummary } from './WerewolfLobbyPage.js';

type Resolution =
  | { kind: 'loading' }
  | { kind: 'room'; gameId: string }
  | { kind: 'lobby' };

export function WerewolfHomeResolver() {
  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const games = await api.get<WerewolfLobbySummary[]>('/werewolf-games');
        if (cancelled) return;
        const running = games
          .filter((g) => g.status === 'running')
          .sort((a, b) => b.createdAt - a.createdAt);
        if (running.length > 0 && running[0]) {
          setResolution({ kind: 'room', gameId: running[0].gameId });
        } else {
          setResolution({ kind: 'lobby' });
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.statusCode >= 500) {
          setResolution({ kind: 'lobby' });
        } else {
          setResolution({ kind: 'lobby' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (resolution.kind === 'loading') {
    return (
      <div className="ww-resolver-loading" role="status" aria-live="polite">
        加载中…
      </div>
    );
  }
  if (resolution.kind === 'room') {
    return <Navigate to={`/werewolf/${resolution.gameId}`} replace />;
  }
  return <Navigate to="/werewolf" replace />;
}
