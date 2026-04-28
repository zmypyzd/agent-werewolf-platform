import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient, type WsMessage } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';

export interface BlindConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface TableSummary {
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

export interface LobbyPageContentProps {
  tables: TableSummary[];
  loading: boolean;
  error: string | null;
  onCreate: (tableId: string) => void;
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
      <div className="page-header">
        <h1>Lobby</h1>
        <div className="page-actions">
          <span className="muted">{user?.displayName} ({user?.email})</span>
          <Link to="/agents">Agents</Link>
          <Link to="/matches">Replays</Link>
          <button className="button-secondary" onClick={() => void logout()}>Log out</button>
        </div>
      </div>

      <LobbyPageContent
        tables={tables}
        loading={loading}
        error={error}
        onCreate={tableId => navigate(`/tables/${tableId}`)}
      />
    </div>
  );
}

export function LobbyPageContent({ tables, loading, error, onCreate }: LobbyPageContentProps) {
  return (
    <div className="lobby-page-content">
      <CreateTableForm onCreated={onCreate} />

      {error && <div className="error alert-error" role="alert">{error}</div>}

      <section className="panel lobby-table-ops" aria-label="Lobby tables">
        <div className="section-heading">
          <div>
            <h2>Tables</h2>
            <p className="muted">Join an open seat or watch a full table.</p>
          </div>
          <span className="status-chip">{tables.length} active</span>
        </div>

        {loading && (
          <div className="empty-state" role="status">
            Loading tables
          </div>
        )}

        {!loading && tables.length === 0 && (
          <div className="empty-state">
            No tables yet. Create one above.
          </div>
        )}

        {!loading && tables.length > 0 && (
          <div className="lobby-table-list">
            {tables.map(table => (
              <article
                key={table.tableId}
                className={`lobby-table-row ${table.canSit ? 'is-joinable' : 'is-watch-only'}`}
              >
                <div className="lobby-table-main">
                  <div className="lobby-table-title">
                    <h3>{table.tableName}</h3>
                    <span className={`status-chip status-chip-${table.status.replace('_', '-')}`}>
                      {formatStatus(table.status)}
                    </span>
                  </div>
                  <dl className="lobby-table-metrics">
                    <div>
                      <dt>Players</dt>
                      <dd>{table.seatedCount} / {table.maxSeats}</dd>
                    </div>
                    <div>
                      <dt>Spectators</dt>
                      <dd>{table.spectatorCount} spectators</dd>
                    </div>
                    <div>
                      <dt>Blinds</dt>
                      <dd>{formatBlinds(table.blinds)}</dd>
                    </div>
                    <div>
                      <dt>Hand</dt>
                      <dd>{table.currentHandId ?? 'No hand'}</dd>
                    </div>
                  </dl>
                </div>
                <Link
                  className={table.canSit ? 'button-primary' : 'button-secondary'}
                  to={`/tables/${table.tableId}`}
                >
                  {table.canSit ? 'Join' : 'Watch'}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
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
      className="panel create-table-form"
      onSubmit={onSubmit}
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
      <button className="button-primary" type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create table'}
      </button>
      {error && <div className="error create-table-error">{error}</div>}
    </form>
  );
}

const STATUS_LABELS = {
  preparing: 'Preparing',
  in_hand: 'In hand',
  paused: 'Paused',
  completed: 'Completed',
} satisfies Record<TableSummary['status'], string>;

function formatStatus(status: TableSummary['status']): string {
  return STATUS_LABELS[status];
}

function formatBlinds(blinds: BlindConfig): string {
  return `${blinds.smallBlind} / ${blinds.bigBlind} ante ${blinds.ante}`;
}
