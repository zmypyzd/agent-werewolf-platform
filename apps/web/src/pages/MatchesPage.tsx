import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';

export interface MatchArtifactIndexEntry {
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

export interface MatchesPageContentProps {
  matches: MatchArtifactIndexEntry[];
  loading: boolean;
  error: string | null;
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

  return <MatchesPageContent matches={matches} loading={loading} error={error} />;
}

export function MatchesPageContent({ matches, loading, error }: MatchesPageContentProps) {
  return (
    <div className="page replay-page">
      <div className="page-header">
        <div>
          <h1>Match Replays</h1>
          <p className="muted">Review completed hands and decision traces.</p>
        </div>
        <div className="page-actions">
          <Link className="button-secondary" to="/lobby">Lobby</Link>
        </div>
      </div>

      <section className="panel replay-panel" aria-label="Match replays">
        <div className="section-heading">
          <div>
            <h2>Published replays</h2>
            <p className="muted">Open a match to inspect hand flow and agent decisions.</p>
          </div>
          <span className="status-chip">{matches.length} saved</span>
        </div>

        {error ? <div className="error alert-error" role="alert">{error}</div> : null}

        {loading ? (
          <div className="empty-state" role="status">Loading replays</div>
        ) : null}

        {!loading && !error && matches.length === 0 ? (
          <div className="empty-state">No match replays yet.</div>
        ) : null}

        {!loading && matches.length > 0 ? (
          <table className="data-table replay-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Hands</th>
                <th>Agents</th>
                <th>Completed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {matches.map(match => (
                <tr key={match.matchId}>
                  <td>{match.name}</td>
                  <td>{match.handCount}</td>
                  <td>{match.agentIds.join(', ') || 'none'}</td>
                  <td>{formatTime(match.completedAt)}</td>
                  <td>
                    <Link className="button-secondary" to={`/matches/${match.matchId}`}>Open replay</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
