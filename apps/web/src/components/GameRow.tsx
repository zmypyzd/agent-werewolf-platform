import { Link } from 'react-router-dom';
import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

export interface GameRowProps {
  game: WerewolfLobbySummary;
}

const STATUS_LABELS: Record<WerewolfLobbySummary['status'], string> = {
  waiting:   'WAITING',
  ready:     'READY',
  running:   'RUNNING',
  completed: 'COMPLETED',
  failed:    'FAILED',
};

function formatRelativeAge(createdAt: number, now: number): string {
  const diffMs = now - createdAt;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Mini thumbnail: 8 dots arranged around an oval to mirror the hero card
// layout but at row scale (64×64). Filled dots = seated, hollow = empty.
function RowThumb({ seatedCount, status }: { seatedCount: number; status: WerewolfLobbySummary['status'] }) {
  // Position the 8 outer dots around an ellipse plus a center indicator.
  const dots: ReadonlyArray<{ x: string; y: string }> = [
    { x: '50%',  y: '12%' },
    { x: '80%',  y: '25%' },
    { x: '90%',  y: '55%' },
    { x: '78%',  y: '82%' },
    { x: '50%',  y: '92%' },
    { x: '22%',  y: '82%' },
    { x: '10%',  y: '55%' },
    { x: '20%',  y: '25%' },
  ];
  const completed = status === 'completed' || status === 'failed';
  return (
    <div
      className={`ww-game-row-thumb${completed ? ' is-finished' : ''}`}
      data-status={status}
      aria-hidden="true"
    >
      {dots.map((d, i) => {
        const seated = i < seatedCount;
        return (
          <span
            key={i}
            className={`ww-game-row-thumb-dot${seated ? ' is-seated' : ''}`}
            style={{ left: d.x, top: d.y }}
          />
        );
      })}
    </div>
  );
}

export function GameRow({ game }: GameRowProps) {
  const now = Date.now();
  const pillClass = `ww-pill ww-pill-${game.status}`;
  const label = STATUS_LABELS[game.status];
  const isRunning = game.status === 'running';

  return (
    <Link to={`/werewolf/${game.gameId}`} className="ww-game-row-link">
      <RowThumb seatedCount={game.seatedCount} status={game.status} />
      <div className="ww-game-row-info">
        <div className="ww-game-row-top">
          <span className={pillClass}>
            {isRunning ? <span className="ww-game-row-pulse" aria-hidden="true" /> : null}
            {label}
          </span>
          <span className="ww-game-row-name">
            {game.name || game.gameId.slice(0, 8)}
          </span>
        </div>
        <div className="ww-game-row-meta">
          <span className="ww-game-row-meta-cell">
            <strong>{game.seatedCount}/9</strong> seated
          </span>
          <span className="ww-game-row-meta-cell">{formatRelativeAge(game.createdAt, now)}</span>
          <span className="ww-game-row-meta-cell">
            seed <span className="ww-game-row-meta-mono">#{game.gameId.slice(0, 8)}</span>
          </span>
        </div>
      </div>
      <span className={`ww-game-row-cta${isRunning ? ' is-watch' : ''}`}>
        {isRunning ? '▶ WATCH' : game.status === 'completed' ? 'REPLAY' : 'OPEN →'}
      </span>
    </Link>
  );
}
