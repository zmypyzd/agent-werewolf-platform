import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';
import { buildPokerTableViewModel } from '../live-table/buildPokerTableViewModel.js';
import { createInitialLiveTableState, liveTableReducer } from '../live-table/liveTableReducer.js';
import { normalizeLiveTableEvent } from '../live-table/normalizeLiveTableEvent.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel, normalizeSeatBuyIn } from '../live-table/SeatManagementPanel.js';
import type { WsMessage } from '../lib/ws.js';
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

export interface HumanSeatRequestBody {
  seatIndex: number;
  buyIn: number;
}

export interface AgentSeatRequestBody extends HumanSeatRequestBody {
  agentConfigId: string;
}

export function buildHumanSeatRequestBody(seatIndex: number, buyIn: number): HumanSeatRequestBody {
  return { seatIndex, buyIn };
}

export function buildAgentSeatRequestBody(
  seatIndex: number,
  agentConfigId: string,
  buyIn: number,
): AgentSeatRequestBody {
  return { seatIndex, buyIn, agentConfigId };
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

export interface TablePageApiClient {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  del: (path: string) => Promise<unknown>;
}

export async function loadTableSnapshotForPage({
  tableId,
  apiClient,
  meUserId,
  setTable,
  dispatch,
  setError,
}: {
  tableId: string;
  apiClient: TablePageApiClient;
  meUserId: string | null;
  setTable: (table: TableSnapshot) => void;
  dispatch: (event: LiveTableEvent) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  try {
    const data = await apiClient.get(`/tables/${tableId}`) as TableSnapshot;
    setTable(data);
    dispatch({
      type: 'snapshot.loaded',
      table: data,
      meUserId,
    });
    setError(null);
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to load table');
  }
}

export async function loadTableHandHistoryForPage({
  tableId,
  apiClient,
  setHandHistory,
  setLoading,
  setError,
}: {
  tableId: string;
  apiClient: TablePageApiClient;
  setHandHistory: (hands: TablePublicHandSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}): Promise<void> {
  setLoading(true);
  try {
    const data = await apiClient.get(`/tables/${tableId}/hands`) as TablePublicHandSummary[];
    setHandHistory(data);
    setError(null);
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to load hand history');
  } finally {
    setLoading(false);
  }
}

export async function watchTableForPage({
  tableId,
  apiClient,
  setBusy,
  setError,
  setIsWatching,
  refreshTable,
}: {
  tableId: string;
  apiClient: TablePageApiClient;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setIsWatching: (isWatching: boolean) => void;
  refreshTable: () => Promise<void>;
}): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await apiClient.post(`/tables/${tableId}/watch`);
    setIsWatching(true);
    await refreshTable();
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to watch table');
  } finally {
    setBusy(false);
  }
}

export async function unwatchTableForPage({
  tableId,
  apiClient,
  setBusy,
  setError,
  setIsWatching,
  refreshTable,
}: {
  tableId: string;
  apiClient: TablePageApiClient;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setIsWatching: (isWatching: boolean) => void;
  refreshTable: () => Promise<void>;
}): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await apiClient.del(`/tables/${tableId}/watch`);
    setIsWatching(false);
    await refreshTable();
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to unwatch table');
  } finally {
    setBusy(false);
  }
}

export async function deleteTableForPage({
  tableId,
  apiClient,
  setBusy,
  setError,
  navigate,
}: {
  tableId: string;
  apiClient: TablePageApiClient;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  navigate: (path: string) => void;
}): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await apiClient.del(`/tables/${tableId}`);
    navigate('/lobby');
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to delete table');
    setBusy(false);
  }
}

export interface TablePageWsClient {
  on: (listener: (message: WsMessage) => void) => () => void;
  onStatus: (listener: (status: 'connecting' | 'connected' | 'reconnecting' | 'closed') => void) => () => void;
  subscribe: (topic: string) => void;
  connect: () => void;
  close: () => void;
}

export function connectTablePageWebSocket({
  tableId,
  wsClient,
  meUserId,
  dispatch,
  refreshTable,
  refreshHandHistory,
  setIsWatching,
}: {
  tableId: string;
  wsClient: TablePageWsClient;
  meUserId: string | null;
  dispatch: (event: LiveTableEvent) => void;
  refreshTable: () => void | Promise<void>;
  refreshHandHistory: () => void | Promise<void>;
  setIsWatching: (isWatching: boolean) => void;
}): () => void {
  const refreshTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduleRefresh = (delayMs: number, refresh: () => void | Promise<void>) => {
    const timer = setTimeout(() => {
      refreshTimers.delete(timer);
      void refresh();
    }, delayMs);
    refreshTimers.add(timer);
  };

  const off = wsClient.on(m => {
    if (!m.topic.endsWith(tableId)) return;

    switch (m.type) {
      case 'table.player_seated':
      case 'table.player_left':
      case 'table.viewer_joined':
      case 'table.viewer_left':
        if (m.payload['userId'] === meUserId) {
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
  const offStatus = wsClient.onStatus(status => dispatch({ type: 'connection.changed', status }));
  wsClient.subscribe(`table:${tableId}`);
  wsClient.connect();

  return () => {
    off();
    offStatus();
    wsClient.close();
    for (const timer of refreshTimers) clearTimeout(timer);
    refreshTimers.clear();
  };
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
    await loadTableSnapshotForPage({
      tableId,
      apiClient: api,
      meUserId: user?.userId ?? null,
      setTable,
      dispatch,
      setError,
    });
  }, [dispatch, tableId, user?.userId]);

  const refreshAgents = useCallback(async () => {
    try {
      const list = await api.get<UserAgentConfigPublic[]>('/me/agents');
      setMyAgents(list);
    } catch { /* non-fatal */ }
  }, []);

  const refreshHandHistory = useCallback(async () => {
    if (!tableId) return;
    await loadTableHandHistoryForPage({
      tableId,
      apiClient: api,
      setHandHistory,
      setLoading: setHandHistoryLoading,
      setError: setHandHistoryError,
    });
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
    return connectTablePageWebSocket({
      tableId,
      wsClient: ws,
      meUserId: user?.userId ?? null,
      dispatch,
      refreshTable,
      refreshHandHistory,
      setIsWatching,
    });
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
    await watchTableForPage({
      tableId,
      apiClient: api,
      setBusy: setWatchBusy,
      setError: setWatchError,
      setIsWatching,
      refreshTable,
    });
  }, [refreshTable, tableId, watchBusy]);

  const unwatchTable = useCallback(async () => {
    if (!tableId || watchBusy) return;
    await unwatchTableForPage({
      tableId,
      apiClient: api,
      setBusy: setWatchBusy,
      setError: setWatchError,
      setIsWatching,
      refreshTable,
    });
  }, [refreshTable, tableId, watchBusy]);

  const deleteTable = useCallback(async () => {
    if (!tableId || deleteBusy) return;
    await deleteTableForPage({
      tableId,
      apiClient: api,
      setBusy: setDeleteBusy,
      setError: setDeleteError,
      navigate,
    });
  }, [deleteBusy, navigate, tableId]);

  const sitHuman = useCallback(async (seatIndex: number, buyIn: number) => {
    if (!tableId) return;
    const selectedBuyIn = normalizeSeatBuyIn(buyIn);
    if (selectedBuyIn === null) {
      setSeatError('Enter a positive chip buy-in.');
      return;
    }

    setBusySeatIndex(seatIndex);
    setSeatError(null);
    try {
      await api.post(`/tables/${tableId}/seats`, buildHumanSeatRequestBody(seatIndex, selectedBuyIn));
      await refreshTable();
    } catch (e) {
      setSeatError(e instanceof ApiError ? e.message : 'Failed to sit');
    } finally {
      setBusySeatIndex(null);
    }
  }, [refreshTable, tableId]);

  const sitAgent = useCallback(async (seatIndex: number, agentConfigId: string, buyIn: number) => {
    if (!tableId) return;
    const selectedBuyIn = normalizeSeatBuyIn(buyIn);
    if (selectedBuyIn === null) {
      setSeatError('Enter a positive chip buy-in.');
      return;
    }

    setBusySeatIndex(seatIndex);
    setSeatError(null);
    try {
      await api.post(`/tables/${tableId}/seats/agent`, buildAgentSeatRequestBody(seatIndex, agentConfigId, selectedBuyIn));
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
