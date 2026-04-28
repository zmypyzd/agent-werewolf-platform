import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';
import { buildPokerTableViewModel } from '../live-table/buildPokerTableViewModel.js';
import { createInitialLiveTableState, liveTableReducer } from '../live-table/liveTableReducer.js';
import { normalizeLiveTableEvent } from '../live-table/normalizeLiveTableEvent.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel } from '../live-table/SeatManagementPanel.js';
import type { ActionType, Card, HandPhase, LiveTableEvent, TableSnapshot } from '../live-table/liveTableTypes.js';

// ─── types (kept local to avoid wiring workspace TS paths into Vite) ─────────

interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
}

export interface TablePublicHandPlayerSummary {
  playerId: string;
  agentId: string;
  seatIndex: number;
  stackBefore: number;
  stackAfter: number;
}

export interface TablePublicHandAction {
  actionId: string;
  handId: string;
  playerId: string;
  phase: HandPhase;
  actionType: ActionType;
  amount: number;
  stackAfter: number;
  sequence: number;
  timestamp: number;
}

export interface TableHandResult {
  playerId: string;
  seatIndex: number;
  potIndex: number;
  winAmount: number;
  netChange: number;
}

export interface TablePublicPot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface TablePublicHandSummary {
  handId: string;
  tableId: string;
  handNumber: number;
  seed: string;
  startedAt: number;
  completedAt: number;
  players: TablePublicHandPlayerSummary[];
  blindConfig: TableSnapshot['config']['blindConfig'];
  communityCards: Card[];
  allActions: TablePublicHandAction[];
  results: TableHandResult[];
  finalPots: TablePublicPot[];
}

export function refreshDelayForLiveEvent(event: LiveTableEvent): 0 | 50 | null {
  if (event.type === 'hand.started') return 0;
  if (event.type === 'hand.completed') return 50;
  return null;
}

export function isActionRequestLocked(
  pendingRequestId: string | null,
  submittedRequestId: string | null,
  submittingAction: boolean,
): boolean {
  return submittingAction || (!!pendingRequestId && pendingRequestId === submittedRequestId);
}

export function seatDisplayNumber(seatIndex: number): number {
  return seatIndex + 1;
}

export function formatTableNetResult(results: TableHandResult[]): string {
  if (results.length === 0) return 'No net result';

  const largestSwing = results.reduce((current, result) => {
    const resultMagnitude = Math.abs(result.netChange);
    const currentMagnitude = Math.abs(current.netChange);
    if (resultMagnitude > currentMagnitude) return result;
    if (resultMagnitude === currentMagnitude && result.netChange > current.netChange) return result;
    return current;
  });

  return `Net ${formatSignedAmount(largestSwing.netChange)}`;
}

function formatSignedAmount(amount: number): string {
  if (amount > 0) return `+${amount}`;
  return String(amount);
}

export interface TableLifecycleControlsProps {
  canManage: boolean;
  isWatching: boolean;
  busy: boolean;
  error: string | null;
  deleteConfirmOpen: boolean;
  deleteBusy: boolean;
  deleteError: string | null;
  onWatch: () => void;
  onUnwatch: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function TableLifecycleControls({
  canManage,
  isWatching,
  busy,
  error,
  deleteConfirmOpen,
  deleteBusy,
  deleteError,
  onWatch,
  onUnwatch,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: TableLifecycleControlsProps) {
  return (
    <div className="table-lifecycle-controls">
      <div className="table-lifecycle-actions">
        {isWatching ? (
          <button className="button-secondary" type="button" onClick={onUnwatch} disabled={busy}>
            Unwatch table
          </button>
        ) : (
          <button className="button-primary" type="button" onClick={onWatch} disabled={busy}>
            Watch table
          </button>
        )}
        {error && <span className="error" role="alert">{error}</span>}
      </div>

      {canManage === true && (
        <div className="table-delete-controls">
          <span className="table-danger-title">Close table</span>
          {!deleteConfirmOpen ? (
            <button
              className="button-danger"
              type="button"
              onClick={onRequestDelete}
              disabled={deleteBusy}
            >
              Close table
            </button>
          ) : (
            <div className="table-delete-confirm" role="alert">
              <strong>Close this table?</strong>
              <div className="table-delete-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={onCancelDelete}
                  disabled={deleteBusy}
                >
                  Cancel
                </button>
                <button
                  className="button-danger"
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={deleteBusy}
                >
                  Delete table
                </button>
              </div>
            </div>
          )}
          {deleteError && <span className="error" role="alert">{deleteError}</span>}
        </div>
      )}
    </div>
  );
}

export interface TableHandHistoryPanelProps {
  hands: TablePublicHandSummary[];
  loading: boolean;
  error: string | null;
}

export function TableHandHistoryPanel({ hands, loading, error }: TableHandHistoryPanelProps) {
  return (
    <section className="panel table-hand-history" aria-label="Hand history">
      <div className="section-heading">
        <div>
          <h2>Hand History</h2>
        </div>
        <span className="status-chip">{hands.length} hands</span>
      </div>

      {loading && (
        <div className="empty-state" role="status">
          Loading hand history
        </div>
      )}

      {!loading && error && (
        <div className="error alert-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && hands.length === 0 && (
        <div className="empty-state">
          No completed hands yet.
        </div>
      )}

      {!loading && !error && hands.length > 0 && (
        <table className="data-table table-hand-history-table">
          <thead>
            <tr>
              <th>Hand</th>
              <th>Actions</th>
              <th>Board</th>
              <th>Net result</th>
            </tr>
          </thead>
          <tbody>
            {hands.map(hand => (
              <tr key={hand.handId}>
                <td>Hand {hand.handNumber}</td>
                <td>{hand.allActions.length} actions</td>
                <td>{hand.communityCards.length} board cards</td>
                <td>{formatTableNetResult(hand.results)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function TablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [table, setTable] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handHistory, setHandHistory] = useState<TablePublicHandSummary[]>([]);
  const [handHistoryLoading, setHandHistoryLoading] = useState(true);
  const [handHistoryError, setHandHistoryError] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [liveState, dispatchLive] = useState(createInitialLiveTableState);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [submittedRequestId, setSubmittedRequestId] = useState<string | null>(null);
  const [busySeatIndex, setBusySeatIndex] = useState<number | null>(null);
  const [seatError, setSeatError] = useState<string | null>(null);
  const [myAgents, setMyAgents] = useState<UserAgentConfigPublic[]>([]);
  const lastPendingRequestIdRef = useRef<string | null>(null);

  const dispatch = useCallback((event: LiveTableEvent) => {
    dispatchLive(current => liveTableReducer(current, event));
  }, []);

  const refreshTable = useCallback(async () => {
    if (!tableId) return;
    try {
      const data = await api.get<TableSnapshot>(`/tables/${tableId}`);
      setTable(data);
      dispatch({
        type: 'snapshot.loaded',
        table: data,
        meUserId: user?.userId ?? null,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load table');
    }
  }, [dispatch, tableId, user?.userId]);

  const refreshAgents = useCallback(async () => {
    try {
      const list = await api.get<UserAgentConfigPublic[]>('/me/agents');
      setMyAgents(list);
    } catch { /* non-fatal */ }
  }, []);

  const refreshHandHistory = useCallback(async () => {
    if (!tableId) return;
    setHandHistoryLoading(true);
    try {
      const data = await api.get<TablePublicHandSummary[]>(`/tables/${tableId}/hands`);
      setHandHistory(data);
      setHandHistoryError(null);
    } catch (e) {
      setHandHistoryError(e instanceof ApiError ? e.message : 'Failed to load hand history');
    } finally {
      setHandHistoryLoading(false);
    }
  }, [tableId]);

  useEffect(() => { void refreshTable(); }, [refreshTable]);
  useEffect(() => { void refreshAgents(); }, [refreshAgents]);
  useEffect(() => { void refreshHandHistory(); }, [refreshHandHistory]);

  useEffect(() => {
    setIsWatching(false);
    setWatchError(null);
    setDeleteConfirmOpen(false);
    setDeleteError(null);
  }, [tableId]);

  const pendingRequestId = liveState.pendingAction?.requestId ?? null;
  useEffect(() => {
    if (lastPendingRequestIdRef.current === pendingRequestId) return;
    lastPendingRequestIdRef.current = pendingRequestId;
    setSubmittedRequestId(null);
    setSubmittingAction(false);
    setActionError(null);
  }, [pendingRequestId]);

  useEffect(() => {
    if (!tableId) return;
    const ws = new WsClient();
    const refreshTimers = new Set<ReturnType<typeof setTimeout>>();
    const scheduleRefresh = (delayMs: number, refresh: () => void | Promise<void>) => {
      const timer = setTimeout(() => {
        refreshTimers.delete(timer);
        void refresh();
      }, delayMs);
      refreshTimers.add(timer);
    };

    const off = ws.on(m => {
      if (!m.topic.endsWith(tableId)) return;

      switch (m.type) {
        case 'table.player_seated':
        case 'table.player_left':
        case 'table.viewer_joined':
        case 'table.viewer_left':
          if (m.payload['userId'] === user?.userId) {
            setIsWatching(m.type === 'table.viewer_joined');
          }
          void refreshTable();
          return;
        default:
          break;
      }

      const normalized = normalizeLiveTableEvent(m);
      if (normalized) {
        dispatch(normalized);
        const refreshDelay = refreshDelayForLiveEvent(normalized);
        if (refreshDelay === 0) void refreshTable();
        else if (refreshDelay !== null) scheduleRefresh(refreshDelay, refreshTable);
        if (normalized.type === 'hand.completed') scheduleRefresh(50, refreshHandHistory);
      }
    });
    const offStatus = ws.onStatus(status => dispatch({ type: 'connection.changed', status }));
    ws.subscribe(`table:${tableId}`);
    ws.connect();

    return () => {
      off();
      offStatus();
      ws.close();
      for (const timer of refreshTimers) clearTimeout(timer);
      refreshTimers.clear();
    };
  }, [dispatch, refreshHandHistory, refreshTable, tableId, user?.userId]);

  const submitAction = useCallback(async (actionType: ActionType, amount?: number) => {
    if (!tableId || !liveState.pendingAction) return;
    if (isActionRequestLocked(liveState.pendingAction.requestId, submittedRequestId, submittingAction)) return;
    setSubmittingAction(true);
    setActionError(null);
    try {
      await api.post(`/tables/${tableId}/actions`, {
        handId: liveState.pendingAction.handId,
        actionType,
        ...(amount !== undefined ? { amount } : {}),
      });
      setSubmittedRequestId(liveState.pendingAction.requestId);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Failed to submit action');
      setSubmittingAction(false);
    }
  }, [liveState.pendingAction, submittedRequestId, submittingAction, tableId]);

  const watchTable = useCallback(async () => {
    if (!tableId || watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    try {
      await api.post(`/tables/${tableId}/watch`);
      setIsWatching(true);
      await refreshTable();
    } catch (e) {
      setWatchError(e instanceof ApiError ? e.message : 'Failed to watch table');
    } finally {
      setWatchBusy(false);
    }
  }, [refreshTable, tableId, watchBusy]);

  const unwatchTable = useCallback(async () => {
    if (!tableId || watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    try {
      await api.del(`/tables/${tableId}/watch`);
      setIsWatching(false);
      await refreshTable();
    } catch (e) {
      setWatchError(e instanceof ApiError ? e.message : 'Failed to unwatch table');
    } finally {
      setWatchBusy(false);
    }
  }, [refreshTable, tableId, watchBusy]);

  const deleteTable = useCallback(async () => {
    if (!tableId || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.del(`/tables/${tableId}`);
      navigate('/lobby');
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Failed to delete table');
      setDeleteBusy(false);
    }
  }, [deleteBusy, navigate, tableId]);

  const sitHuman = useCallback(async (seatIndex: number) => {
    if (!tableId) return;
    setBusySeatIndex(seatIndex);
    setSeatError(null);
    try {
      await api.post(`/tables/${tableId}/seats`, { seatIndex, buyIn: 1000 });
      await refreshTable();
    } catch (e) {
      setSeatError(e instanceof ApiError ? e.message : 'Failed to sit');
    } finally {
      setBusySeatIndex(null);
    }
  }, [refreshTable, tableId]);

  const sitAgent = useCallback(async (seatIndex: number, agentConfigId: string) => {
    if (!tableId) return;
    setBusySeatIndex(seatIndex);
    setSeatError(null);
    try {
      await api.post(`/tables/${tableId}/seats/agent`, { seatIndex, buyIn: 1000, agentConfigId });
      await refreshTable();
    } catch (e) {
      setSeatError(e instanceof ApiError ? e.message : 'Failed to seat agent');
    } finally {
      setBusySeatIndex(null);
    }
  }, [refreshTable, tableId]);

  const mySeat = useMemo(
    () => table?.seats.find(s => s?.ownerUserId === user?.userId) ?? null,
    [table, user?.userId],
  );
  const hasHumanSeat = useMemo(
    () => table?.seats.some(s => !!s && s.ownerUserId === user?.userId && s.adapterType === 'human') ?? false,
    [table, user?.userId],
  );

  if (!tableId) return <div className="page">Missing tableId.</div>;
  if (error) return <div className="page"><div className="error">{error}</div><Link to="/lobby">← Lobby</Link></div>;
  if (!table) return <div className="page">Loading table…</div>;

  const seatable = table.status === 'preparing' || table.status === 'paused';
  const tableModel = buildPokerTableViewModel(liveState, { seatable });
  const actionSubmitting = isActionRequestLocked(pendingRequestId, submittedRequestId, submittingAction);

  return (
    <div className="page table-page" style={{ maxWidth: 1100 }}>
      <div className="page-header">
        <h1>{table.config.name}</h1>
        <div className="page-actions">
          <Link to="/lobby">← Lobby</Link>
        </div>
      </div>
      <p className="muted">
        status <b>{table.status}</b>
        {' · '}hand {table.currentHandId ?? '—'}
        {' · '}phase {liveState.phase ?? '—'}
        {' · '}blinds {table.config.blindConfig.smallBlind}/{table.config.blindConfig.bigBlind}
        {mySeat && (
          <> {' · '}you are seat {seatDisplayNumber(mySeat.seatIndex)} ({mySeat.adapterType})</>
        )}
      </p>

      <section className="panel table-control-panel" aria-label="Table controls">
        <div className="section-heading">
          <div>
            <h2>Controls</h2>
          </div>
          <span className="status-chip">{isWatching ? 'Watching' : 'Not watching'}</span>
        </div>

        <TableLifecycleControls
          canManage={table.canManage === true}
          isWatching={isWatching}
          busy={watchBusy}
          error={watchError}
          deleteConfirmOpen={deleteConfirmOpen}
          deleteBusy={deleteBusy}
          deleteError={deleteError}
          onWatch={() => void watchTable()}
          onUnwatch={() => void unwatchTable()}
          onRequestDelete={() => {
            setDeleteConfirmOpen(true);
            setDeleteError(null);
          }}
          onCancelDelete={() => {
            setDeleteConfirmOpen(false);
            setDeleteError(null);
          }}
          onConfirmDelete={() => void deleteTable()}
        />

        <div className="table-seat-actions">
          {mySeat && (
            <SeatControls
              tableId={tableId}
              status={table.status}
              onChange={refreshTable}
            />
          )}

          {seatable && table.seats.filter(s => s !== null).length >= 2 && (
            <StartHandButton tableId={tableId} />
          )}
        </div>
      </section>

      <PokerTableSurface
        model={tableModel}
        actionError={actionError}
        submittingAction={actionSubmitting}
        onSubmitAction={submitAction}
      />

      <SeatManagementPanel
        model={tableModel}
        myAgents={myAgents}
        busySeatIndex={busySeatIndex}
        error={seatError}
        canSitHuman={!hasHumanSeat}
        onSitHuman={sitHuman}
        onSitAgent={sitAgent}
      />

      <TableHandHistoryPanel
        hands={handHistory}
        loading={handHistoryLoading}
        error={handHistoryError}
      />
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SeatControls({ tableId, status, onChange }: { tableId: string; status: TableSnapshot['status']; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setBusy(true); setError(null);
    try {
      await api.del(`/tables/${tableId}/seats/me`);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to leave');
    } finally { setBusy(false); }
  }

  return (
    <div className="row">
      <button onClick={leave} disabled={busy}>
        {status === 'in_hand' ? 'Sit out next hand' : 'Leave seat'}
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function StartHandButton({ tableId }: { tableId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setBusy(true); setError(null);
    // /hands/start blocks until the hand completes; the WS stream drives the
    // UI, so we don't await the response. We do surface failures inline.
    void api.post(`/tables/${tableId}/hands/start`).catch(e => {
      setError(e instanceof ApiError ? e.message : 'Hand failed');
    }).finally(() => setBusy(false));
  }

  return (
    <div className="row">
      <button onClick={start} disabled={busy}>Start hand</button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
