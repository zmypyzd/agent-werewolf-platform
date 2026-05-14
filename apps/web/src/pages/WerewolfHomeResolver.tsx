import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import type { WerewolfLobbySummary } from './WerewolfLobbyPage.js';

type Resolution =
  | { kind: 'loading' }
  | { kind: 'room'; gameId: string }
  | { kind: 'lobby' };

// Bound the resolver's spinner. Render's free-tier API can take ~30s to cold-
// start; without this cap a fresh visitor sees nothing but "加载中…" while the
// container wakes. The lobby fallback then handles its own poll once mounted.
export const RESOLVER_TIMEOUT_MS = 5000;

export function WerewolfHomeResolver() {
  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
    }, RESOLVER_TIMEOUT_MS);

    void (async () => {
      try {
        const games = await api.get<WerewolfLobbySummary[]>(
          '/werewolf-games',
          controller.signal,
        );
        if (cancelled) return;
        const running = games
          .filter((g) => g.status === 'running')
          .sort((a, b) => b.createdAt - a.createdAt);
        if (running.length > 0 && running[0]) {
          setResolution({ kind: 'room', gameId: running[0].gameId });
        } else {
          setResolution({ kind: 'lobby' });
        }
      } catch {
        if (cancelled) return;
        // AbortError on timeout, ApiError on 4xx/5xx, network errors otherwise.
        // All collapse to lobby — its own fetch+poll picks up once the API
        // is ready, so the spectator sees real content instead of a spinner.
        setResolution({ kind: 'lobby' });
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
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
