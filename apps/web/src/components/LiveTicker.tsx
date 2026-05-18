import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

export interface LiveTickerProps {
  games: ReadonlyArray<WerewolfLobbySummary>;
}

function formatRelativeAge(createdAt: number, now: number): string {
  const diffMs = now - createdAt;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function LiveTicker({ games }: LiveTickerProps) {
  const running = games.filter((g) => g.status === 'running');
  const waiting = games.filter((g) => g.status === 'waiting' || g.status === 'ready');
  const completed = games.filter((g) => g.status === 'completed');

  if (running.length === 0 && waiting.length === 0) return null;

  const now = Date.now();
  return (
    <div className="ww-live-ticker" aria-label="Live activity">
      <span className="ww-live-ticker-dot" aria-hidden="true" />
      <div className="ww-live-ticker-stream">
        {running.map((g) => (
          <span key={g.gameId} className="ww-live-ticker-item">
            <span className="ww-live-ticker-chip">#{g.gameId.slice(0, 6)}</span>
            <span className="ww-live-ticker-name">{g.name || `局 ${g.gameId.slice(0, 8)}`}</span>
            <span className="ww-live-ticker-meta">
              {g.seatedCount}/9 · {formatRelativeAge(g.createdAt, now)}
            </span>
          </span>
        ))}
        {waiting.length > 0 ? (
          <span className="ww-live-ticker-item">
            <span className="ww-live-ticker-chip ww-live-ticker-chip-day">
              QUEUED · {waiting.length}
            </span>
          </span>
        ) : null}
      </div>
      <div className="ww-live-ticker-counts">
        <span>
          <strong>{running.length}</strong>LIVE
        </span>
        <span>
          <strong>{waiting.length}</strong>QUEUED
        </span>
        <span>
          <strong>{completed.length}</strong>DONE
        </span>
      </div>
    </div>
  );
}
