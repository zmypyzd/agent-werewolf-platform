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
    <div className="werewolf-lobby">
      <h1>Werewolf · 大厅</h1>
      <form onSubmit={onCreate} className="werewolf-create">
        <input
          placeholder="局名称（可选）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <input
          placeholder="seed（可选，用于复现）"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          maxLength={100}
        />
        <button type="submit" disabled={creating}>
          建局
        </button>
      </form>
      {error ? <div className="werewolf-error">{error}</div> : null}
      <h2>当前游戏</h2>
      {games.length === 0 ? (
        <p>还没有任何狼人杀对局，先建一个看看。</p>
      ) : (
        <ul className="werewolf-game-list">
          {games.map((g) => (
            <li key={g.gameId} className="werewolf-game-row">
              <Link to={`/werewolf/${g.gameId}`}>
                <span className="werewolf-game-name">{g.name}</span>
                <span className="werewolf-game-status">{g.status}</span>
                <span className="werewolf-game-seated">{g.seatedCount}/9</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
