import type { WerewolfLobbySummary } from '../pages/WerewolfLobbyPage.js';

// One row in the live commentary feed beside the HeroCard. Mirrors the
// DESIGN.md spec: each entry ~50px tall with a phase-colored 3px left
// border (night/day/death) and a JBM-styled meta line above DM Sans body.
export interface CommentaryEntry {
  readonly id: string;
  // "HH:MM:SS · PHASE · 局 #ID" — caller decides the format; we render it
  // verbatim so seed/episode wiring can change without touching this file.
  readonly meta: string;
  readonly body: string;
  // Drives the left-border color: speak=indigo, vote=amber, kill=red,
  // phase=neutral. Matches the timeline event kinds 1:1 so backend can
  // map directly when the lobby commentary endpoint lands.
  readonly kind: 'speak' | 'vote' | 'kill' | 'phase';
}

export interface LiveCommentaryProps {
  // When a live match is featured in the HeroCard, the commentary feed
  // shows demo entries as atmospheric chrome. When there is no featured
  // match, we render an empty state instead of misleading the spectator
  // with fake commentary against no match.
  readonly featured: WerewolfLobbySummary | null;
  // Optional injection point for real entries once the backend exposes
  // a global commentary stream. When provided, replaces the demo list.
  readonly entries?: ReadonlyArray<CommentaryEntry> | undefined;
}

// Demo commentary lines that match the approved R-K-polished mockup's
// narrative shape (P1–P9 seats, agent names, role-aware events). Used
// until /api/v1/global-commentary or similar lands. Keep this list small
// and varied across kinds so each session demonstrates all four left-
// border colors at a glance.
const DEMO_ENTRIES: ReadonlyArray<CommentaryEntry> = [
  { id: 'd1', meta: '20:48:12 · NIGHT 2 · 局 #a3f7c2', body: 'P3 Echo-3 narrates last-night check, points at P1.', kind: 'speak' },
  { id: 'd2', meta: '20:48:21 · NIGHT 2',              body: 'Witch (P6 Vector-7) considers saving target.',     kind: 'speak' },
  { id: 'd3', meta: '20:47:05 · DAY 2',                body: 'P5 Sigma-5 voted to banish P2 Echo-2.',             kind: 'vote'  },
  { id: 'd4', meta: '20:46:33 · DAY 2',                body: '✝ P5 Sigma-5 banished — wolf pack exposed.',       kind: 'kill'  },
  { id: 'd5', meta: '20:46:00 · DAY 2 → NIGHT 2',      body: 'Phase transition. 6 alive · 2 wolves left.',         kind: 'phase' },
  { id: 'd6', meta: '20:45:42 · DAY 2',                body: 'P2 Echo-2 deflecting suspicion toward P7 Quanta-4.', kind: 'speak' },
  { id: 'd7', meta: '20:45:01 · NIGHT 1',              body: 'Witch poisoned P9 Nimbus-8.',                       kind: 'kill'  },
];

export function LiveCommentary({ featured, entries }: LiveCommentaryProps) {
  const list = entries ?? (featured ? DEMO_ENTRIES : []);

  if (list.length === 0) {
    return (
      <aside className="ww-live-commentary ww-live-commentary-empty" aria-label="Live commentary">
        <header className="ww-live-commentary-h">
          <span className="ww-live-commentary-dot" aria-hidden="true" />
          <span className="ww-live-commentary-title">LIVE COMMENTARY</span>
        </header>
        <div className="ww-live-commentary-body">
          <div className="ww-live-commentary-empty-msg">
            尚无直播事件，等首局开战。
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ww-live-commentary" aria-label="Live commentary">
      <header className="ww-live-commentary-h">
        <span className="ww-live-commentary-dot" aria-hidden="true" />
        <span className="ww-live-commentary-title">LIVE COMMENTARY</span>
        {featured ? (
          <span className="ww-live-commentary-meta-game" title={featured.name || featured.gameId}>
            {featured.name || `局 ${featured.gameId.slice(0, 8)}`}
          </span>
        ) : null}
      </header>
      <div className="ww-live-commentary-body" tabIndex={0}>
        {list.map((entry) => (
          <article key={entry.id} className={`ww-live-commentary-entry kind-${entry.kind}`}>
            <span className="ww-live-commentary-entry-meta">{entry.meta}</span>
            <span className="ww-live-commentary-entry-body">{entry.body}</span>
          </article>
        ))}
      </div>
    </aside>
  );
}
