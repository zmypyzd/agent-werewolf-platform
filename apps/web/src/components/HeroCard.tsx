import { Link } from 'react-router-dom';
import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

export interface HeroCardProps {
  featured: WerewolfLobbySummary | null;
}

// Mini oval-arc thumbnail SVG mirroring the production seat layout but at
// hero scale. Seat fill states are intentionally generic — we don't have
// per-seat alive/dead in the lobby summary, just seatedCount. Seats up to
// seatedCount render as filled; the rest render as empty.
function HeroBoard({ seatedCount }: { seatedCount: number }) {
  const positions: ReadonlyArray<{ cx: number; cy: number }> = [
    { cx: 250, cy: 35 },
    { cx: 385, cy: 80 },
    { cx: 445, cy: 150 },
    { cx: 385, cy: 220 },
    { cx: 250, cy: 265 },
    { cx: 115, cy: 220 },
    { cx: 55, cy: 150 },
    { cx: 115, cy: 80 },
    { cx: 250, cy: 150 },
  ];
  return (
    <svg
      className="ww-hero-board"
      viewBox="0 0 500 300"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="250"
        cy="150"
        rx="195"
        ry="115"
        stroke="rgba(91,74,255,.25)"
        strokeWidth="1.5"
      />
      {positions.slice(0, 8).map((p, i) => {
        const seated = i < seatedCount;
        return (
          <circle
            key={i}
            cx={p.cx}
            cy={p.cy}
            r="14"
            fill="#0c0d14"
            stroke={seated ? '#20c070' : 'rgba(255,255,255,.18)'}
            strokeWidth={seated ? 2 : 1}
          />
        );
      })}
    </svg>
  );
}

export function HeroCard({ featured }: HeroCardProps) {
  if (!featured) {
    return (
      <div className="ww-hero-card ww-hero-card-empty">
        <div className="ww-hero-card-overlay">
          <h2 className="ww-hero-card-title">还没有正在进行的对局</h2>
          <p className="ww-hero-card-sub">
            从右侧建一局，9 个 agent 自动入座一键开战。
          </p>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={`/werewolf/${featured.gameId}`}
      className="ww-hero-card"
      aria-label={`Watch ${featured.name || featured.gameId.slice(0, 8)}`}
    >
      <HeroBoard seatedCount={featured.seatedCount} />
      <div className="ww-hero-card-overlay">
        <div className="ww-hero-card-pills">
          <span className="ww-hero-card-pill ww-hero-card-pill-live">
            <span className="ww-hero-card-live-dot" aria-hidden="true" />
            LIVE
          </span>
          <span className="ww-hero-card-pill ww-hero-card-pill-seats">
            {featured.seatedCount}/9 seated
          </span>
        </div>
        <h2 className="ww-hero-card-title">
          {featured.name || `局 ${featured.gameId.slice(0, 8)}`}
        </h2>
        <span className="ww-hero-card-cta">▶ JOIN BROADCAST</span>
      </div>
    </Link>
  );
}
