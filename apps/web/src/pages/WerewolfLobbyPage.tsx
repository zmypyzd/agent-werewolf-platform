import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';

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

const STATUS_LABELS: Record<WerewolfLobbySummary['status'], string> = {
  waiting:   'WAITING',
  ready:     'READY',
  running:   'RUNNING',
  completed: 'COMPLETED',
  failed:    'FAILED',
};

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

  return (
    <div className="ww-lobby">
      <div className="ww-lobby-header">
        <h1 className="ww-lobby-title">Werewolf · 大厅</h1>
        <div className="ww-lobby-live-indicator">
          <div className="ww-lobby-live-dot" />
          <span>{games.filter((g) => g.status === 'running').length} live</span>
        </div>
      </div>

      <div className="ww-lobby-body">
        {error ? <div className="ww-lobby-error">{error}</div> : null}

        <div className="ww-game-list-section">
          <h2 className="ww-section-heading">当前游戏</h2>
          {games.length === 0 ? (
            <div className="ww-empty-state">还没有任何狼人杀对局，先建一个看看。</div>
          ) : (
            <ul className="ww-game-list">
              {games.map((g) => (
                <li key={g.gameId} className="ww-game-row">
                  <Link to={`/werewolf/${g.gameId}`}>
                    <div className="ww-game-row-left">
                      <div className="ww-game-row-top">
                        <span className={`ww-pill ww-pill-${g.status}`}>
                          {STATUS_LABELS[g.status]}
                        </span>
                        <span className="ww-game-name">{g.name || g.gameId.slice(0, 8)}</span>
                      </div>
                      <span className="ww-game-meta">
                        {g.seatedCount}/9 seated
                      </span>
                    </div>
                    <span className="ww-game-seated">{g.seatedCount}/9</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ww-create-panel">
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
        </div>
      </div>
    </div>
  );
}
