import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';
import { buildPokerTableViewModel } from '../live-table/buildPokerTableViewModel.js';
import { createInitialLiveTableState, liveTableReducer } from '../live-table/liveTableReducer.js';
import { normalizeLiveTableEvent } from '../live-table/normalizeLiveTableEvent.js';
import { PokerTableSurface } from '../live-table/PokerTableSurface.js';
import { SeatManagementPanel } from '../live-table/SeatManagementPanel.js';
import type { ActionType, LiveTableEvent, TableSnapshot } from '../live-table/liveTableTypes.js';

// ─── types (kept local to avoid wiring workspace TS paths into Vite) ─────────

interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
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

// ─── component ───────────────────────────────────────────────────────────────

export function TablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { user } = useAuth();

  const [table, setTable] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => { void refreshTable(); }, [refreshTable]);
  useEffect(() => { void refreshAgents(); }, [refreshAgents]);

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
    const scheduleRefreshTable = (delayMs: number) => {
      const timer = setTimeout(() => {
        refreshTimers.delete(timer);
        void refreshTable();
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
        else if (refreshDelay !== null) scheduleRefreshTable(refreshDelay);
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
  }, [dispatch, refreshTable, tableId]);

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
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{table.config.name}</h1>
        <div className="row">
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
    <div className="row" style={{ marginTop: 12 }}>
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
    <div className="row" style={{ marginTop: 12 }}>
      <button onClick={start} disabled={busy}>Start hand</button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
