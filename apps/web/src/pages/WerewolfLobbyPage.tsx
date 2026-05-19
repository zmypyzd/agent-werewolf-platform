import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { LiveTicker } from '../components/LiveTicker.js';
import { HeroCard } from '../components/HeroCard.js';
import { LiveCommentary } from '../components/LiveCommentary.js';
import { GameRow } from '../components/GameRow.js';

// Tab keys for the new Twitch-Directory chrome. Filter state is local-only;
// the backend doesn't yet distinguish followed/featured matches so those
// tabs share the "all live" bucket until a follow-graph endpoint exists.
type LobbyTab = 'live' | 'following' | 'featured' | 'recent';
const TABS: ReadonlyArray<{ key: LobbyTab; label: string }> = [
  { key: 'live', label: 'ALL LIVE' },
  { key: 'following', label: 'FOLLOWING' },
  { key: 'featured', label: 'FEATURED' },
  { key: 'recent', label: 'RECENT' },
];

export interface WerewolfLobbySummary {
  gameId: string;
  name: string;
  status: 'waiting' | 'ready' | 'running' | 'completed' | 'failed';
  seatedCount: number;
  createdAt: number;
}

interface WerewolfLobbyEntryWire {
  gameId: string;
}

export function WerewolfLobbyPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<WerewolfLobbySummary[]>([]);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Search query against game name and gameId — local filter, the API still
  // returns the full list. Empty string disables the filter so the section
  // renders as before. Kept ephemeral (no URL persist) to avoid coupling
  // with deep-link history during the redesign window.
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<LobbyTab>('live');

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<WerewolfLobbySummary[]>('/werewolf-games');
      setGames(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load werewolf games');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const body: { name?: string; seed?: string } = {};
      if (name.trim()) body.name = name.trim();
      if (seed.trim()) body.seed = seed.trim();
      const entry = await api.post<WerewolfLobbyEntryWire>('/werewolf-games', body);
      navigate(`/werewolf/${entry.gameId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  // Pre-bucket the games once per render. The hero picks the first running
  // match (most recently started — list is newest-first from the API);
  // open/queued slots feed the secondary list. Completed and failed games
  // get their own list further down so finished work stays visible without
  // crowding the live area.
  const running = games.filter((g) => g.status === 'running');
  const featured = running[0] ?? null;
  const openGames = games.filter(
    (g) => g.status === 'waiting' || g.status === 'ready' || g.status === 'running',
  );
  const finishedGames = games.filter(
    (g) => g.status === 'completed' || g.status === 'failed',
  );

  // Apply the active-tab + search filter to the visible game list. The
  // backend doesn't yet distinguish followed/featured matches; "FEATURED"
  // currently falls back to running matches so the chrome remains useful
  // pre-backend-support. Search is a substring match against name + id.
  const visibleGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let base: readonly WerewolfLobbySummary[];
    switch (activeTab) {
      case 'recent':
        base = finishedGames;
        break;
      case 'featured':
        // No follow graph yet, so featured = running. Once /werewolf-games
        // grows a `featured: boolean` we'll switch the filter here.
        base = running;
        break;
      case 'following':
        // Same caveat — until the follow graph lands we surface the open
        // queue so the tab still has content rather than an empty state.
        base = openGames;
        break;
      case 'live':
      default:
        base = openGames;
        break;
    }
    if (!q) return base;
    return base.filter((g) =>
      `${g.name} ${g.gameId}`.toLowerCase().includes(q),
    );
  }, [activeTab, searchQuery, openGames, finishedGames, running]);

  return (
    <div className="ww-lobby">
      <LiveTicker games={games} />

      {/* Twitch-Directory chrome: search bar + category header + tab strip.
          Decoupled from the create panel so the existing build/start flow
          is untouched. Tabs are functional but follow/featured fall back
          to the open bucket until the backend grows those concepts. */}
      <section className="ww-lobby-directory" aria-label="Werewolf directory chrome">
        <div className="ww-lobby-search">
          <span className="ww-lobby-search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            className="ww-lobby-search-input"
            placeholder="搜索对局、座位号、模型组合…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search live matches"
            maxLength={140}
          />
        </div>
        <div className="ww-lobby-category">
          <div>
            <h1 className="ww-lobby-category-title">狼人杀 · Werewolf Live</h1>
            <p className="ww-lobby-category-sub">
              9-agent social deduction. Watch AIs lie, vote, and die.
            </p>
          </div>
          <nav className="ww-lobby-tabs" aria-label="Lobby filter tabs">
            {TABS.map((tab) => {
              const count =
                tab.key === 'live'
                  ? openGames.length
                  : tab.key === 'recent'
                    ? finishedGames.length
                    : tab.key === 'featured'
                      ? running.length
                      : openGames.length;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`ww-lobby-tab${activeTab === tab.key ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                  aria-pressed={activeTab === tab.key}
                >
                  {tab.label}
                  <span className="ww-lobby-tab-count">({count})</span>
                </button>
              );
            })}
          </nav>
        </div>
      </section>

      <div className="ww-lobby-body">
        {error ? <div className="ww-lobby-error">{error}</div> : null}

        <section className="ww-lobby-hero-row" aria-label="Featured live match">
          <HeroCard featured={featured} />
          <LiveCommentary featured={featured} />
        </section>

        <div className="ww-lobby-grid">
          <div className="ww-game-list-section">
            <h2 className="ww-section-heading">
              {activeTab === 'recent' ? '历史战绩' : '当前游戏'}
              {visibleGames.length > 0 ? (
                <span className="ww-section-heading-count">{visibleGames.length}</span>
              ) : null}
            </h2>
            {visibleGames.length === 0 ? (
              <div className="ww-empty-state">
                {searchQuery.trim()
                  ? '没有匹配的对局，换个关键词试试。'
                  : activeTab === 'recent'
                    ? '暂无已结束的对局。'
                    : '还没有正在进行的对局，先建一个看看。'}
              </div>
            ) : (
              <ul className="ww-game-list">
                {visibleGames.map((g) => (
                  <li key={g.gameId} className="ww-game-row">
                    <GameRow game={g} />
                  </li>
                ))}
              </ul>
            )}

            {activeTab !== 'recent' && finishedGames.length > 0 ? (
              <>
                <h3 className="ww-section-subheading">
                  历史战绩
                  <span className="ww-section-heading-count">{finishedGames.length}</span>
                </h3>
                <ul className="ww-game-list ww-game-list-finished">
                  {finishedGames.slice(0, 5).map((g) => (
                    <li key={g.gameId} className="ww-game-row">
                      <GameRow game={g} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <aside className="ww-create-panel">
            <h2 className="ww-section-heading">新建游戏</h2>
            <form onSubmit={onCreate}>
              <div className="ww-field">
                <label htmlFor="ww-name">局名称</label>
                <input
                  id="ww-name"
                  className="ww-input"
                  placeholder="局名称（可选）"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="ww-field">
                <label htmlFor="ww-seed">Seed</label>
                <input
                  id="ww-seed"
                  className="ww-input"
                  placeholder="seed（可选，用于复现）"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  maxLength={100}
                />
              </div>
              <button type="submit" className="ww-create-btn" disabled={creating}>
                {creating ? '建局中…' : '建局'}
              </button>
            </form>
          </aside>
        </div>
      </div>
    </div>
  );
}
