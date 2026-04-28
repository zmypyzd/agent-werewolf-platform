import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

interface MatchArtifactIndexEntry {
  matchId: string;
  tableId: string;
  name: string;
  handCount: number;
  agentIds: string[];
  startedAt: number;
  completedAt: number;
  createdAt: number;
  artifactPath: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function MatchesPage() {
  const [matches, setMatches] = useState<MatchArtifactIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<MatchArtifactIndexEntry[]>('/matches')
      .then(data => {
        if (!alive) return;
        setMatches(data);
        setError(null);
      })
      .catch(e => {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : 'Failed to load matches');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Match Replays</h1>
        <Link to="/lobby">Lobby</Link>
      </div>

      {error && <div className="error">{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Hands</th>
            <th style={{ padding: 8 }}>Agents</th>
            <th style={{ padding: 8 }}>Completed</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {matches.map(match => (
            <tr key={match.matchId} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{match.name}</td>
              <td style={{ padding: 8 }}>{match.handCount}</td>
              <td style={{ padding: 8 }}>{match.agentIds.join(', ') || 'none'}</td>
              <td style={{ padding: 8 }}>{formatTime(match.completedAt)}</td>
              <td style={{ padding: 8 }}>
                <Link to={`/matches/${match.matchId}`}>Open replay</Link>
              </td>
            </tr>
          ))}
          {!loading && matches.length === 0 && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                No match artifacts have been published yet.
              </td>
            </tr>
          )}
          {loading && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Loading...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
