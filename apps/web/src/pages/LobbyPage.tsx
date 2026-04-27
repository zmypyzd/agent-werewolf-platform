import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient, type WsMessage } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';

interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

interface TableSummary {
  tableId: string;
  tableName: string;
  status: 'preparing' | 'in_hand' | 'paused' | 'completed';
  seatedCount: number;
  maxSeats: number;
  spectatorCount: number;
  blinds: BlindConfig;
  canSit: boolean;
  currentHandId: string | null;
}

export function LobbyPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<TableSummary[]>('/tables');
      setTables(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const ws = new WsClient();
    ws.connect();
    ws.subscribe('lobby');
    const off = ws.on((m: WsMessage) => {
      if (m.topic !== 'lobby') return;
      const summary = m.payload as unknown as TableSummary;
      if (m.type === 'lobby.table_created') {
        setTables(curr =>
          curr.some(t => t.tableId === summary.tableId) ? curr : [...curr, summary],
        );
      } else if (m.type === 'lobby.table_updated') {
        setTables(curr => curr.map(t => (t.tableId === summary.tableId ? summary : t)));
      }
    });
    return () => {
      off();
      ws.close();
    };
  }, [refresh]);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Lobby</h1>
        <div className="row">
          <span className="muted">{user?.displayName} ({user?.email})</span>
          <Link to="/agents">Agents</Link>
          <Link to="/matches">Replays</Link>
          <button onClick={() => void logout()}>Log out</button>
        </div>
      </div>

      <CreateTableForm onCreated={tableId => navigate(`/tables/${tableId}`)} />

      {error && <div className="error">{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Players</th>
            <th style={{ padding: 8 }}>Spectators</th>
            <th style={{ padding: 8 }}>Blinds</th>
            <th style={{ padding: 8 }}>Hand</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {tables.map(t => (
            <tr key={t.tableId} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{t.tableName}</td>
              <td style={{ padding: 8 }}>{t.status}</td>
              <td style={{ padding: 8 }}>{t.seatedCount} / {t.maxSeats}</td>
              <td style={{ padding: 8 }}>{t.spectatorCount}</td>
              <td style={{ padding: 8 }}>{t.blinds.smallBlind} / {t.blinds.bigBlind}</td>
              <td style={{ padding: 8 }}>{t.currentHandId ?? '—'}</td>
              <td style={{ padding: 8 }}>
                <Link to={`/tables/${t.tableId}`}>{t.canSit ? 'Join' : 'Watch'}</Link>
              </td>
            </tr>
          ))}
          {!loading && tables.length === 0 && (
            <tr>
              <td colSpan={7} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                No tables yet — create one above.
              </td>
            </tr>
          )}
          {loading && (
            <tr>
              <td colSpan={7} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Loading…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CreateTableForm({ onCreated }: { onCreated: (tableId: string) => void }) {
  const [name, setName] = useState('');
  const [maxSeats, setMaxSeats] = useState(6);
  const [smallBlind, setSmallBlind] = useState(25);
  const [bigBlind, setBigBlind] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await api.post<{ tableId: string }>('/tables', {
        name,
        maxSeats,
        blindConfig: { smallBlind, bigBlind, ante: 0 },
        defaultTimeoutMs: 5000,
      });
      onCreated(data.tableId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create table');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr auto',
        gap: 12,
        alignItems: 'end',
        maxWidth: 'none',
        marginTop: 16,
      }}
    >
      <label>
        Name
        <input value={name} onChange={e => setName(e.target.value)} required minLength={1} maxLength={40} />
      </label>
      <label>
        Max seats
        <input type="number" min={2} max={9} value={maxSeats}
               onChange={e => setMaxSeats(Number(e.target.value))} />
      </label>
      <label>
        Small / Big blind
        <div className="row">
          <input type="number" min={1} value={smallBlind}
                 onChange={e => setSmallBlind(Number(e.target.value))} style={{ width: 80 }} />
          <span>/</span>
          <input type="number" min={1} value={bigBlind}
                 onChange={e => setBigBlind(Number(e.target.value))} style={{ width: 80 }} />
        </div>
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create table'}
      </button>
      {error && <div className="error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
    </form>
  );
}
