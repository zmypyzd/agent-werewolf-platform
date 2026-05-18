import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { LiveTicker } from '../components/LiveTicker.js';
import { HeroCard } from '../components/HeroCard.js';
import { GameRow } from '../components/GameRow.js';

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

  return (
    <div className="ww-lobby">
      <LiveTicker games={games} />

      <div className="ww-lobby-body">
        {error ? <div className="ww-lobby-error">{error}</div> : null}

        <section className="ww-lobby-hero-row" aria-label="Featured live match">
          <HeroCard featured={featured} />
        </section>

        <div className="ww-lobby-grid">
          <div className="ww-game-list-section">
            <h2 className="ww-section-heading">
              当前游戏
              {openGames.length > 0 ? (
                <span className="ww-section-heading-count">{openGames.length}</span>
              ) : null}
            </h2>
            {openGames.length === 0 ? (
              <div className="ww-empty-state">
                还没有正在进行的对局，先建一个看看。
              </div>
            ) : (
              <ul className="ww-game-list">
                {openGames.map((g) => (
                  <li key={g.gameId} className="ww-game-row">
                    <GameRow game={g} />
                  </li>
                ))}
              </ul>
            )}

            {finishedGames.length > 0 ? (
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
