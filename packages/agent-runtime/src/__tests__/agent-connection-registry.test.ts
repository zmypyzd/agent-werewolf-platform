import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  AgentWsClientMessage,
  AgentWsServerMessage,
} from '@agent-poker/agent-protocol';
import { AGENT_WS_PROTOCOL_VERSION } from '@agent-poker/agent-protocol';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import {
  AgentConnection,
  AgentConnectionClosedError,
  AgentConnectionRegistry,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type AgentSocket,
} from '../agent-connection-registry.js';

// ─── fake socket ────────────────────────────────────────────────────────────

class FakeSocket implements AgentSocket {
  sent: AgentWsServerMessage[] = [];
  closeCount = 0;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as AgentWsServerMessage);
  }
  close(): void {
    this.closeCount += 1;
  }
  // Convenience: simulate the agent sending a frame to the server side
  // by feeding it through the connection's frame handler.
  pushClientFrame(conn: AgentConnection, frame: AgentWsClientMessage): void {
    conn.handleFrame(JSON.stringify(frame));
  }
}

// ─── fixtures ───────────────────────────────────────────────────────────────

function buildRequest(overrides: Partial<WerewolfDecisionRequest> = {}): WerewolfDecisionRequest {
  return {
    requestId: 'req-1',
    gameId: 'game-1',
    agentId: 'agent-1',
    playerId: 'p1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    publicState: {
      gameId: 'game-1',
      phase: 'night-werewolf-vote',
      nightNumber: 1,
      dayNumber: 0,
      players: [],
      history: [],
      winner: null,
    },
    privateState: {
      selfId: 'p1',
      selfRole: 'werewolf',
      selfSide: 'werewolf',
      knownAllies: [],
      seerKnowledge: [],
      witchView: null,
      hunterCanShoot: false,
    },
    validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
    deadlineMs: 1_000,
    ...overrides,
  };
}

function buildConn(socket: FakeSocket, agentId = 'agent-1'): AgentConnection {
  let counter = 0;
  return new AgentConnection({
    agentId,
    socket,
    serverConnectionId: `conn-${agentId}`,
    correlationIdFactory: () => `corr-${++counter}`,
    now: () => Date.now(),
  });
}

// ─── AgentConnection ────────────────────────────────────────────────────────

describe('AgentConnection.start', () => {
  it('sends hello frame with protocol version + serverConnectionId', () => {
    const sock = new FakeSocket();
    const conn = new AgentConnection({
      agentId: 'agent-x',
      socket: sock,
      serverConnectionId: 'srv-conn-42',
    });
    conn.start();
    expect(sock.sent[0]).toEqual({
      type: 'hello',
      protocolVersion: AGENT_WS_PROTOCOL_VERSION,
      agentId: 'agent-x',
      serverConnectionId: 'srv-conn-42',
    });
    conn.handleSocketClosed('test-cleanup');
  });
});

describe('AgentConnection.rpc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits decide frame and resolves on matching decide.response', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    const promise = conn.rpc(buildRequest({ requestId: 'req-A' }));
    const decideFrame = sock.sent.find((m) => m.type === 'decide');
    expect(decideFrame).toBeDefined();
    if (decideFrame?.type !== 'decide') throw new Error('unreachable');
    expect(decideFrame.correlationId).toBe('corr-1');
    expect(decideFrame.request.requestId).toBe('req-A');

    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });

    const res = await promise;
    expect(res.requestId).toBe('req-A');
    expect(res.agentId).toBe('agent-1');
    expect(res.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });
    expect(res.reasoningSummary).toBeUndefined();

    conn.handleSocketClosed('test-cleanup');
  });

  it('forwards reasoningSummary when present', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    const promise = conn.rpc(buildRequest());
    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      reasoningSummary: { intent: 'frame p2', confidence: 0.7, keyObservations: ['p2 sus'] },
    });

    const res = await promise;
    expect(res.reasoningSummary).toEqual({
      intent: 'frame p2',
      confidence: 0.7,
      keyObservations: ['p2 sus'],
    });
    conn.handleSocketClosed('test-cleanup');
  });

  it('rejects when agent reports decide.error', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    const promise = conn.rpc(buildRequest());
    sock.pushClientFrame(conn, {
      type: 'decide.error',
      correlationId: 'corr-1',
      code: 'handler_threw',
      message: 'boom',
    });

    await expect(promise).rejects.toThrow(/handler_threw.*boom/);
    conn.handleSocketClosed('test-cleanup');
  });

  it('rejects + sends cancel frame when hard ceiling exceeded', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    const promise = conn.rpc(buildRequest({ deadlineMs: 1_000 }));
    promise.catch(() => {}); // suppress unhandledRejection warning before timer fires
    // hard ceiling is deadlineMs * 2 = 2000ms
    await vi.advanceTimersByTimeAsync(2_001);

    await expect(promise).rejects.toThrow(/exceeded hard ceiling/);
    expect(sock.sent.some((m) => m.type === 'cancel' && m.correlationId === 'corr-1')).toBe(true);
    conn.handleSocketClosed('test-cleanup');
  });

  it('drops late decide.response after cancellation (no double-resolve)', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    const promise = conn.rpc(buildRequest({ deadlineMs: 1_000 }));
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(promise).rejects.toThrow();

    // Now agent finally responds. Should be silently dropped — no
    // exceptions, no additional sends, no second promise resolution.
    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });
    expect(conn.pendingCount()).toBe(0);
    conn.handleSocketClosed('test-cleanup');
  });

  it('rejects when called on a closed connection', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();
    conn.handleSocketClosed('test_close');
    await expect(conn.rpc(buildRequest())).rejects.toBeInstanceOf(AgentConnectionClosedError);
  });

  it('silently ignores malformed JSON and schema-invalid frames', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();
    const promise = conn.rpc(buildRequest());

    conn.handleFrame('not json at all');
    conn.handleFrame('{"type":"unknown-type"}');
    conn.handleFrame('{"type":"decide.response","correlationId":42}'); // wrong type

    expect(conn.pendingCount()).toBe(1);

    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });
    await expect(promise).resolves.toBeDefined();
    conn.handleSocketClosed('test-cleanup');
  });
});

describe('AgentConnection close lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('handleSocketClosed rejects pending RPCs and fires close handlers', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    let closedReason: string | null = null;
    conn.onClose((reason) => {
      closedReason = reason;
    });

    const inflight = conn.rpc(buildRequest());
    inflight.catch(() => {});
    conn.handleSocketClosed('peer_left');

    await expect(inflight).rejects.toBeInstanceOf(AgentConnectionClosedError);
    expect(closedReason).toBe('peer_left');
    expect(conn.isClosed()).toBe(true);
    expect(conn.pendingCount()).toBe(0);
  });

  it('handleSocketClosed is idempotent', () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    let calls = 0;
    conn.onClose(() => calls++);
    conn.handleSocketClosed('first');
    conn.handleSocketClosed('second');
    expect(calls).toBe(1);
  });

  it('closeWithGoodbye sends goodbye, closes the socket, and runs cleanup', () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    conn.closeWithGoodbye('replaced', 'newer connection arrived');

    const goodbye = sock.sent.find((m) => m.type === 'goodbye');
    expect(goodbye).toBeDefined();
    if (goodbye?.type !== 'goodbye') throw new Error('unreachable');
    expect(goodbye.code).toBe('replaced');
    expect(sock.closeCount).toBe(1);
    expect(conn.isClosed()).toBe(true);
  });
});

describe('AgentConnection heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends ping at HEARTBEAT_INTERVAL_MS', async () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock);
    conn.start();

    sock.sent.length = 0; // clear hello
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 10);
    expect(sock.sent.some((m) => m.type === 'ping')).toBe(true);

    conn.handleSocketClosed('test-cleanup');
  });

  it('updates lastPongAt on pong frame', async () => {
    let nowMs = 1_000_000;
    const sock = new FakeSocket();
    const conn = new AgentConnection({
      agentId: 'agent-1',
      socket: sock,
      serverConnectionId: 'c',
      correlationIdFactory: () => 'corr',
      now: () => nowMs,
    });
    conn.start();

    // Skip past one heartbeat interval; agent must pong to stay alive.
    nowMs += HEARTBEAT_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    sock.pushClientFrame(conn, { type: 'pong', ts: nowMs });

    // Now jump just before the timeout window from the new pong; should
    // still be alive.
    nowMs += HEARTBEAT_TIMEOUT_MS - 100;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(conn.isClosed()).toBe(false);

    conn.handleSocketClosed('test-cleanup');
  });

  it('closes connection with goodbye when pong is missing past HEARTBEAT_TIMEOUT_MS', async () => {
    let nowMs = 1_000_000;
    const sock = new FakeSocket();
    const conn = new AgentConnection({
      agentId: 'agent-1',
      socket: sock,
      serverConnectionId: 'c',
      correlationIdFactory: () => 'corr',
      now: () => nowMs,
    });
    conn.start();

    // Advance past the timeout window without sending a pong.
    nowMs += HEARTBEAT_TIMEOUT_MS + 1_000;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    expect(conn.isClosed()).toBe(true);
    expect(sock.sent.some((m) => m.type === 'goodbye')).toBe(true);
    expect(sock.closeCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── AgentConnectionRegistry ────────────────────────────────────────────────

describe('AgentConnectionRegistry', () => {
  let registry: AgentConnectionRegistry;
  let onlineEvents: string[];
  let offlineEvents: string[];

  beforeEach(() => {
    registry = new AgentConnectionRegistry();
    onlineEvents = [];
    offlineEvents = [];
    registry.on('online', (id) => onlineEvents.push(id));
    registry.on('offline', (id) => offlineEvents.push(id));
  });

  it('register stores the conn; acquire returns it', () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock, 'agent-A');
    registry.register(conn);
    expect(registry.acquire('agent-A')).toBe(conn);
    expect(registry.liveAgentIds()).toEqual(['agent-A']);
    expect(onlineEvents).toEqual(['agent-A']);
  });

  it('acquire returns null for unknown or closed agents', () => {
    expect(registry.acquire('nobody')).toBeNull();

    const sock = new FakeSocket();
    const conn = buildConn(sock, 'agent-A');
    registry.register(conn);
    conn.handleSocketClosed('peer');
    expect(registry.acquire('agent-A')).toBeNull();
  });

  it('last-write-wins: second register replaces first, sending goodbye{replaced}', () => {
    const sock1 = new FakeSocket();
    const conn1 = buildConn(sock1, 'agent-A');
    conn1.start();

    let conn1Closed: string | null = null;
    conn1.onClose((r) => {
      conn1Closed = r;
    });

    registry.register(conn1);

    const sock2 = new FakeSocket();
    const conn2 = buildConn(sock2, 'agent-A');
    registry.register(conn2);

    expect(registry.acquire('agent-A')).toBe(conn2);
    expect(conn1.isClosed()).toBe(true);
    expect(conn1Closed).toBe('replaced');
    expect(sock1.sent.some((m) => m.type === 'goodbye' && m.code === 'replaced')).toBe(true);
    // No duplicate `online` emit on replacement (the registry stays online
    // for the same agentId — the transport instance just changed).
    expect(onlineEvents).toEqual(['agent-A']);
  });

  it('replace rejects in-flight RPCs on the evicted connection (the comment-at-line-305 contract)', async () => {
    // The registry comment at agent-connection-registry.ts:305-307 documents:
    //   "the older connection receives `goodbye{replaced}` and is closed;
    //    in-flight RPCs on the old reject. This makes 'laptop sleeps →
    //    agent restarts → reconnect' cost at most one fallback action per
    //    match instead of crashing."
    //
    // Existing 'last-write-wins' test pins the goodbye frame + conn1.isClosed.
    // This pins the in-flight-rejection arm so a future refactor of
    // closeWithGoodbye() (or AgentConnection.handleSocketClosed) cannot
    // silently break the orchestrator's fallback flow — without rejection,
    // a pending decision RPC would hang until its deadline and the
    // orchestrator would deliver a real reply much later than expected.
    const sock1 = new FakeSocket();
    const conn1 = buildConn(sock1, 'agent-A');
    conn1.start();
    registry.register(conn1);

    // Start an in-flight RPC on conn1 BEFORE conn2 registers. Do not await;
    // the response will arrive via the rejection from replacement.
    const inflight = conn1.rpc(buildRequest());
    inflight.catch(() => {
      /* swallowed — we assert via expect.rejects below */
    });
    expect(conn1.pendingCount()).toBe(1);

    // Now register conn2 — this should evict conn1.
    const sock2 = new FakeSocket();
    const conn2 = buildConn(sock2, 'agent-A');
    registry.register(conn2);

    // Registry should now point at conn2; conn1 must be closed.
    expect(registry.acquire('agent-A')).toBe(conn2);
    expect(conn1.isClosed()).toBe(true);

    // The pending RPC on conn1 rejects with AgentConnectionClosedError.
    await expect(inflight).rejects.toBeInstanceOf(AgentConnectionClosedError);

    // After rejection, conn1's pending map is drained.
    expect(conn1.pendingCount()).toBe(0);

    // Pending RPCs on conn2 are independent — registering conn2 didn't
    // create any pending state on it.
    expect(conn2.pendingCount()).toBe(0);
  });

  it('unregister identity-checks: stale unregister from replaced conn does not evict successor', () => {
    const sock1 = new FakeSocket();
    const conn1 = buildConn(sock1, 'agent-A');
    registry.register(conn1);
    // Wire close → unregister, mirroring what the route handler does.
    conn1.onClose(() => registry.unregister(conn1));

    const sock2 = new FakeSocket();
    const conn2 = buildConn(sock2, 'agent-A');
    registry.register(conn2);
    // conn1 was closed (replaced) and its onClose ran unregister(conn1),
    // but the registry should still have conn2.
    expect(registry.acquire('agent-A')).toBe(conn2);
  });

  it('unregister emits offline only for the currently-registered conn', () => {
    const sock = new FakeSocket();
    const conn = buildConn(sock, 'agent-A');
    registry.register(conn);
    registry.unregister(conn);
    expect(offlineEvents).toEqual(['agent-A']);

    // Repeat unregister is a no-op (idempotent at the registry layer too).
    registry.unregister(conn);
    expect(offlineEvents).toEqual(['agent-A']);
  });

  it('closeAll closes every registered conn with server_shutdown goodbye', () => {
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    const c1 = buildConn(s1, 'agent-A');
    const c2 = buildConn(s2, 'agent-B');
    registry.register(c1);
    registry.register(c2);

    registry.closeAll('test shutdown');

    expect(c1.isClosed()).toBe(true);
    expect(c2.isClosed()).toBe(true);
    expect(s1.sent.some((m) => m.type === 'goodbye' && m.code === 'server_shutdown')).toBe(true);
    expect(s2.sent.some((m) => m.type === 'goodbye' && m.code === 'server_shutdown')).toBe(true);
    expect(registry.liveAgentIds()).toEqual([]);
  });
});

// ─── End-to-end: orchestrator-style usage ───────────────────────────────────

describe('integration: rpc through registry.acquire', () => {
  it('orchestrator dispatches via registry.acquire().rpc()', async () => {
    const registry = new AgentConnectionRegistry();
    const sock = new FakeSocket();
    const conn = buildConn(sock, 'agent-X');
    conn.start();
    registry.register(conn);

    const dispatch = async (req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> => {
      const c = registry.acquire(req.agentId);
      if (!c) throw new Error('offline');
      return c.rpc(req);
    };

    const promise = dispatch(buildRequest({ agentId: 'agent-X', requestId: 'r-99' }));
    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });
    const res = await promise;
    expect(res.requestId).toBe('r-99');
    expect(res.agentId).toBe('agent-X');
    conn.handleSocketClosed('test-cleanup');
  });
});
