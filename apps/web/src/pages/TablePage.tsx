import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { WsClient, type WsMessage } from '../lib/ws.js';
import { useAuth } from '../auth/AuthContext.js';

// ─── types (kept local to avoid wiring workspace TS paths into Vite) ─────────

type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
type Suit = 'c' | 'd' | 'h' | 's';
interface Card { rank: Rank; suit: Suit }

type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

interface LegalAction {
  type: ActionType;
  callAmount?: number;
  minAmount?: number;
  maxAmount?: number;
}

interface SeatInfo {
  seatIndex: number;
  agentId: string;
  playerId: string;
  stack: number;
  status: string;
  ownerUserId: string;
  adapterType: 'human' | 'http' | 'mock';
  agentConfigId: string | null;
  sitOutNextHand: boolean;
  joinedAt: number;
}

interface TableState {
  tableId: string;
  config: {
    name: string;
    maxSeats: number;
    blindConfig: { smallBlind: number; bigBlind: number; ante: number };
    defaultTimeoutMs: number;
  };
  status: 'preparing' | 'in_hand' | 'paused' | 'completed';
  seats: (SeatInfo | null)[];
  currentHandId: string | null;
  handNumber: number;
  button: number;
}

interface UserAgentConfigPublic {
  agentConfigId: string;
  agentName: string;
  endpointUrl: string;
}

interface PendingAction {
  handId: string;
  requestId: string;
  legalActions: LegalAction[];
  deadlineAt: number;
  privateState: { playerId: string; holeCards: [Card, Card] };
}

const SUIT_GLYPH: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR: Record<Suit, string> = { s: '#000', h: '#c00', d: '#c00', c: '#000' };

function CardView({ c }: { c: Card }) {
  return (
    <span
      style={{
        display: 'inline-block',
        border: '1px solid #888',
        borderRadius: 4,
        padding: '4px 8px',
        marginRight: 4,
        background: '#fff',
        color: SUIT_COLOR[c.suit],
        fontFamily: 'monospace',
        minWidth: 32,
        textAlign: 'center',
      }}
    >
      {c.rank}{SUIT_GLYPH[c.suit]}
    </span>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function TablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { user } = useAuth();

  const [table, setTable] = useState<TableState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<HandPhase | null>(null);
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [pots, setPots] = useState<Array<{ amount: number }>>([]);
  const [currentActorPlayerId, setCurrentActorPlayerId] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const [myHoleCards, setMyHoleCards] = useState<[Card, Card] | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const [myAgents, setMyAgents] = useState<UserAgentConfigPublic[]>([]);

  const refreshTable = useCallback(async () => {
    if (!tableId) return;
    try {
      const data = await api.get<TableState>(`/tables/${tableId}`);
      setTable(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load table');
    }
  }, [tableId]);

  const refreshAgents = useCallback(async () => {
    try {
      const list = await api.get<UserAgentConfigPublic[]>('/me/agents');
      setMyAgents(list);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void refreshTable(); }, [refreshTable]);
  useEffect(() => { void refreshAgents(); }, [refreshAgents]);

  const log = useCallback((line: string) => {
    setActionLog(curr => [...curr.slice(-99), line]);
  }, []);

  // Build a seat lookup so events that reference playerId render seat numbers.
  const playerLabel = useCallback(
    (playerId: string) => {
      const seat = table?.seats.find(s => s?.playerId === playerId);
      return seat ? `seat ${seat.seatIndex}` : playerId;
    },
    [table],
  );

  useEffect(() => {
    if (!tableId) return;
    const ws = new WsClient();
    ws.connect();
    ws.subscribe(`table:${tableId}`);
    const off = ws.on((m: WsMessage) => {
      if (!m.topic.endsWith(tableId)) return;
      const data = m.payload;

      switch (m.type) {
        case 'table.player_seated':
        case 'table.player_left':
        case 'table.viewer_joined':
        case 'table.viewer_left':
          void refreshTable();
          return;

        case 'hand.started':
          setPhase('preflop');
          setCommunityCards([]);
          setPots([]);
          setCurrentActorPlayerId(null);
          setMyHoleCards(null);
          setPendingAction(null);
          log(`hand ${(data['handNumber'] as number) ?? '?'} started`);
          void refreshTable();
          return;

        case 'blinds.posted':
          log(
            `blinds posted: SB ${((data['smallBlind'] as { amount: number })?.amount) ?? 0}, BB ${((data['bigBlind'] as { amount: number })?.amount) ?? 0}`,
          );
          return;

        case 'betting_round.started':
          setPhase((data['phase'] as HandPhase) ?? null);
          return;

        case 'community_cards.dealt': {
          const cards = (data['cards'] as Card[]) ?? [];
          setCommunityCards(curr => [...curr, ...cards]);
          setPhase((data['phase'] as HandPhase) ?? null);
          return;
        }

        case 'action.requested': {
          const playerId = data['playerId'] as string | undefined;
          if (playerId) setCurrentActorPlayerId(playerId);
          return;
        }

        case 'action.applied': {
          const playerId = data['playerId'] as string;
          const t = data['actionType'] as string;
          const amount = data['amount'] as number;
          const total = data['potTotal'] as number | undefined;
          log(`${playerLabel(playerId)} ${t}${amount ? ` ${amount}` : ''}${total !== undefined ? ` (pot ${total})` : ''}`);
          return;
        }

        case 'betting_round.complete': {
          const ps = (data['pots'] as Array<{ amount: number }>) ?? [];
          setPots(ps);
          return;
        }

        case 'agent.timeout': {
          const agentId = data['agentId'] as string;
          log(`timeout: ${agentId}`);
          return;
        }
        case 'agent.invalid_action': {
          const agentId = data['agentId'] as string;
          log(`invalid action by ${agentId}`);
          return;
        }

        case 'pot.awarded': {
          const amount = data['amount'] as number;
          const winners = (data['winnerIds'] as string[]) ?? [];
          log(`pot.awarded ${amount} → ${winners.map(playerLabel).join(', ')}`);
          return;
        }

        case 'hand.completed':
          setPhase('complete');
          setCurrentActorPlayerId(null);
          setPendingAction(null);
          log(`hand completed`);
          void refreshTable();
          return;

        case 'seat.hole_cards': {
          const cards = data['holeCards'] as [Card, Card] | undefined;
          if (cards) setMyHoleCards(cards);
          return;
        }

        case 'seat.action_requested':
          setPendingAction({
            handId: data['handId'] as string,
            requestId: data['requestId'] as string,
            legalActions: data['legalActions'] as LegalAction[],
            deadlineAt: data['deadlineAt'] as number,
            privateState: data['privateState'] as PendingAction['privateState'],
          });
          return;

        default:
          return;
      }
    });
    return () => { off(); ws.close(); };
  }, [tableId, log, playerLabel, refreshTable]);

  const mySeat = useMemo(
    () => table?.seats.find(s => s?.ownerUserId === user?.userId) ?? null,
    [table, user],
  );

  if (!tableId) return <div className="page">Missing tableId.</div>;
  if (error) return <div className="page"><div className="error">{error}</div><Link to="/lobby">← Lobby</Link></div>;
  if (!table) return <div className="page">Loading table…</div>;

  const seatable = table.status === 'preparing' || table.status === 'paused';

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
        {' · '}phase {phase ?? '—'}
        {' · '}blinds {table.config.blindConfig.smallBlind}/{table.config.blindConfig.bigBlind}
        {mySeat && (
          <> {' · '}you are seat {mySeat.seatIndex} ({mySeat.adapterType})</>
        )}
      </p>

      <CommunityRow cards={communityCards} pots={pots} />

      <SeatGrid
        table={table}
        currentActorPlayerId={currentActorPlayerId}
        meUserId={user?.userId ?? null}
        myHoleCards={myHoleCards}
        myAgents={myAgents}
        seatable={seatable}
        onChange={refreshTable}
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

      {pendingAction && (
        <ActionPanel
          tableId={tableId}
          pending={pendingAction}
          onSubmitted={() => setPendingAction(null)}
        />
      )}

      <ActionLog lines={actionLog} />
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function CommunityRow({ cards, pots }: { cards: Card[]; pots: Array<{ amount: number }> }) {
  const totalPot = pots.reduce((s, p) => s + p.amount, 0);
  return (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <div className="row">
        <span className="muted" style={{ width: 80 }}>Community</span>
        {cards.length === 0 && <span className="muted">— none —</span>}
        {cards.map((c, i) => <CardView key={i} c={c} />)}
        {pots.length > 0 && (
          <span className="muted" style={{ marginLeft: 16 }}>pot {totalPot}</span>
        )}
      </div>
    </div>
  );
}

function SeatGrid(props: {
  table: TableState;
  currentActorPlayerId: string | null;
  meUserId: string | null;
  myHoleCards: [Card, Card] | null;
  myAgents: UserAgentConfigPublic[];
  seatable: boolean;
  onChange: () => void;
}) {
  const { table, currentActorPlayerId, meUserId, myHoleCards, myAgents, seatable, onChange } = props;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      }}
    >
      {Array.from({ length: table.config.maxSeats }).map((_, idx) => {
        const seat = table.seats[idx] ?? null;
        const isMine = !!seat && seat.ownerUserId === meUserId;
        const isActor = !!seat && seat.playerId === currentActorPlayerId;
        return (
          <div
            key={idx}
            style={{
              border: isActor ? '2px solid #d80' : '1px solid #ccc',
              borderRadius: 6,
              padding: 12,
              background: isMine ? '#fbfbe8' : '#fff',
              minHeight: 140,
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>Seat {idx}</b>
              <span className="muted">{table.button === idx ? 'BTN' : ''}</span>
            </div>
            {seat ? (
              <SeatBody seat={seat} isMine={isMine} myHoleCards={isMine ? myHoleCards : null} />
            ) : (
              <SeatEmpty
                tableId={table.tableId}
                seatIndex={idx}
                seatable={seatable}
                myAgents={myAgents}
                onChange={onChange}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SeatBody({ seat, isMine, myHoleCards }: { seat: SeatInfo; isMine: boolean; myHoleCards: [Card, Card] | null }) {
  return (
    <>
      <div className="muted" style={{ marginTop: 4 }}>
        {seat.adapterType}
        {seat.sitOutNextHand && ' · sit-out next hand'}
      </div>
      <div style={{ marginTop: 4 }}>stack {seat.stack}</div>
      <div style={{ marginTop: 4 }}>{seat.status}</div>
      {isMine && myHoleCards && (
        <div style={{ marginTop: 8 }}>
          <CardView c={myHoleCards[0]} />
          <CardView c={myHoleCards[1]} />
        </div>
      )}
    </>
  );
}

function SeatEmpty(props: {
  tableId: string;
  seatIndex: number;
  seatable: boolean;
  myAgents: UserAgentConfigPublic[];
  onChange: () => void;
}) {
  const { tableId, seatIndex, seatable, myAgents, onChange } = props;
  const [agentChoice, setAgentChoice] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sitAsHuman() {
    setBusy(true); setError(null);
    try {
      await api.post(`/tables/${tableId}/seats`, { seatIndex, buyIn: 1000 });
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to sit');
    } finally { setBusy(false); }
  }

  async function sitAsAgent() {
    if (!agentChoice) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/tables/${tableId}/seats/agent`, {
        seatIndex, buyIn: 1000, agentConfigId: agentChoice,
      });
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to seat agent');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted">empty</div>
      {!seatable && <div className="muted" style={{ marginTop: 8 }}>(wait for next hand)</div>}
      {seatable && (
        <>
          <button onClick={sitAsHuman} disabled={busy} style={{ marginTop: 8, width: '100%' }}>
            Sit here (human)
          </button>
          {myAgents.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <select value={agentChoice} onChange={e => setAgentChoice(e.target.value)} style={{ flex: 1 }}>
                <option value="">— pick agent —</option>
                {myAgents.map(a => (
                  <option key={a.agentConfigId} value={a.agentConfigId}>{a.agentName}</option>
                ))}
              </select>
              <button onClick={sitAsAgent} disabled={busy || !agentChoice}>Sit agent</button>
            </div>
          )}
          {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
        </>
      )}
    </div>
  );
}

function SeatControls({ tableId, status, onChange }: { tableId: string; status: TableState['status']; onChange: () => void }) {
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

function ActionPanel({
  tableId,
  pending,
  onSubmitted,
}: {
  tableId: string;
  pending: PendingAction;
  onSubmitted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const raise = pending.legalActions.find(la => la.type === 'raise');
  const bet = pending.legalActions.find(la => la.type === 'bet');
  const sized = raise ?? bet;
  const [amount, setAmount] = useState<number>(sized?.minAmount ?? 0);

  async function submit(actionType: ActionType, amt?: number) {
    setSubmitting(true); setError(null);
    try {
      await api.post(`/tables/${tableId}/actions`, {
        handId: pending.handId,
        actionType,
        ...(amt !== undefined ? { amount: amt } : {}),
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to submit');
    } finally { setSubmitting(false); }
  }

  function onSizedSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sized) return;
    void submit(sized.type, amount);
  }

  return (
    <div style={{ marginTop: 16, padding: 12, border: '2px solid #08a', borderRadius: 6, background: '#f4faff' }}>
      <b>Your turn</b>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
        {pending.legalActions.map(la => {
          if (la.type === 'fold' || la.type === 'check' || la.type === 'all-in') {
            return (
              <button key={la.type} disabled={submitting} onClick={() => void submit(la.type)}>
                {la.type}
              </button>
            );
          }
          if (la.type === 'call') {
            return (
              <button key="call" disabled={submitting} onClick={() => void submit('call', la.callAmount)}>
                call {la.callAmount ?? ''}
              </button>
            );
          }
          return null;
        })}
      </div>

      {sized && (
        <form className="row" onSubmit={onSizedSubmit} style={{ marginTop: 8 }}>
          <span className="muted">{sized.type}</span>
          <input
            type="number"
            min={sized.minAmount ?? 1}
            max={sized.maxAmount}
            value={amount}
            onChange={e => setAmount(Number(e.target.value))}
          />
          <span className="muted">[{sized.minAmount ?? 1}–{sized.maxAmount}]</span>
          <button type="submit" disabled={submitting}>{sized.type}</button>
        </form>
      )}

      {error && <div className="error" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function ActionLog({ lines }: { lines: string[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <b>Action log</b>
      <ol
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          background: '#fafafa',
          border: '1px solid #ddd',
          padding: '8px 24px',
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        {lines.length === 0 && <li className="muted">— no events yet —</li>}
        {lines.map((l, i) => (<li key={i}>{l}</li>))}
      </ol>
    </div>
  );
}
