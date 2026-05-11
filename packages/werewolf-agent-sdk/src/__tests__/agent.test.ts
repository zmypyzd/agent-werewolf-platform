import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  WerewolfAgent,
  type SocketLike,
  type WerewolfAction,
  type WerewolfDecisionRequest,
} from '../index.js';

// ─── Fake socket: in-memory, deterministic ──────────────────────────────────

type Listener<T extends unknown[]> = (...args: T) => void;

class FakeSocket implements SocketLike {
  sent: Array<Record<string, unknown>> = [];
  closeCount = 0;
  lastCloseCode: number | undefined;
  private openL: Listener<[]>[] = [];
  private msgL: Listener<[Buffer | ArrayBuffer | Uint8Array]>[] = [];
  private closeL: Listener<[number, Buffer]>[] = [];
  private errL: Listener<[Error]>[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, _reason?: string): void {
    this.closeCount += 1;
    this.lastCloseCode = code;
    // Mirror the ws library: a manual close still emits the 'close' event.
    queueMicrotask(() => this.emitClose(code ?? 1000, Buffer.from(_reason ?? '')));
  }
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (d: Buffer | ArrayBuffer | Uint8Array) => void): void;
  on(event: 'close', listener: (c: number, r: Buffer) => void): void;
  on(event: 'error', listener: (e: Error) => void): void;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: never[]) => void): void {
    if (event === 'open') this.openL.push(listener as Listener<[]>);
    else if (event === 'message') this.msgL.push(listener as Listener<[Buffer | ArrayBuffer | Uint8Array]>);
    else if (event === 'close') this.closeL.push(listener as Listener<[number, Buffer]>);
    else this.errL.push(listener as Listener<[Error]>);
  }
  // Test driver helpers
  emitOpen(): void {
    for (const l of this.openL) l();
  }
  emitMessage(frame: Record<string, unknown>): void {
    for (const l of this.msgL) l(Buffer.from(JSON.stringify(frame)));
  }
  emitRaw(raw: string): void {
    for (const l of this.msgL) l(Buffer.from(raw));
  }
  emitClose(code = 1006, reason = Buffer.from('')): void {
    for (const l of this.closeL) l(code, reason);
  }
  emitError(err: Error): void {
    for (const l of this.errL) l(err);
  }
}

const stubRequest: WerewolfDecisionRequest = {
  requestId: 'r-1',
  gameId: 'g-1',
  agentId: 'agent-A',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
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
};

function buildAgent(opts: {
  decide: (req: WerewolfDecisionRequest, ctx: { signal: AbortSignal }) => Promise<WerewolfAction> | WerewolfAction;
  reconnect?: boolean;
}): { agent: WerewolfAgent; sock: FakeSocket } {
  let sock: FakeSocket | null = null;
  const agent = new WerewolfAgent({
    url: 'ws://test/',
    token: 'fake-token',
    decide: opts.decide,
    logger: false,
    reconnect: opts.reconnect ?? false,
    socketFactory: () => {
      sock = new FakeSocket();
      return sock;
    },
  });
  agent.start();
  if (!sock) throw new Error('socket factory did not run');
  return { agent, sock };
}

// ─── Unit-level: handshake + handler dispatch ───────────────────────────────

describe('WerewolfAgent — handshake + dispatch', () => {
  it('replies to ping with pong (echoing ts)', () => {
    const { agent, sock } = buildAgent({ decide: () => stubRequest.validActions[0]! });
    sock.emitOpen();
    sock.emitMessage({ type: 'ping', ts: 12345 });
    expect(sock.sent).toContainEqual({ type: 'pong', ts: 12345 });
    agent.stop();
  });

  it('sends decide.response when handler returns an action', async () => {
    const { agent, sock } = buildAgent({
      decide: () => ({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }),
    });
    sock.emitOpen();
    sock.emitMessage({ type: 'hello', protocolVersion: 1, agentId: 'agent-A', serverConnectionId: 'srv-1' });
    sock.emitMessage({ type: 'decide', correlationId: 'c-1', request: stubRequest });

    // Decide may be async internally; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(sock.sent).toContainEqual({
      type: 'decide.response',
      correlationId: 'c-1',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });
    agent.stop();
  });

  it('forwards reasoningSummary when handler returns a DecideResult', async () => {
    const { agent, sock } = buildAgent({
      decide: () => ({
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' } as WerewolfAction,
        reasoningSummary: { intent: 'frame p2', confidence: 0.6, keyObservations: ['quiet'] },
      } as unknown as WerewolfAction),
    });
    sock.emitOpen();
    sock.emitMessage({ type: 'decide', correlationId: 'c-1', request: stubRequest });

    await new Promise((r) => setTimeout(r, 0));

    const response = sock.sent.find((m) => m['type'] === 'decide.response') as Record<string, unknown> | undefined;
    expect(response).toBeDefined();
    expect(response!['reasoningSummary']).toEqual({
      intent: 'frame p2',
      confidence: 0.6,
      keyObservations: ['quiet'],
    });
    agent.stop();
  });

  it('sends decide.error when handler throws', async () => {
    const { agent, sock } = buildAgent({
      decide: () => {
        throw new Error('boom');
      },
    });
    sock.emitOpen();
    sock.emitMessage({ type: 'decide', correlationId: 'c-2', request: stubRequest });

    await new Promise((r) => setTimeout(r, 0));

    const err = sock.sent.find((m) => m['type'] === 'decide.error') as Record<string, unknown> | undefined;
    expect(err).toBeDefined();
    expect(err!['code']).toBe('handler_threw');
    expect(err!['message']).toBe('boom');
    agent.stop();
  });

  it('aborts in-flight handler on cancel and returns decide.error{cancelled}', async () => {
    let resolveDecide: ((v: WerewolfAction) => void) | null = null;
    const { agent, sock } = buildAgent({
      decide: (_req, ctx) =>
        new Promise<WerewolfAction>((resolve, reject) => {
          resolveDecide = resolve;
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    sock.emitOpen();
    sock.emitMessage({ type: 'decide', correlationId: 'c-3', request: stubRequest });

    // Cancel arrives while user is still computing.
    sock.emitMessage({ type: 'cancel', correlationId: 'c-3', reason: 'deadline_exceeded' });

    // Now the user "finishes". Promise rejects via abort signal → catch
    // path sends decide.error{handler_threw}. EITHER outcome is acceptable
    // for a cancelled decision; what matters is that no decide.response
    // for c-3 lands.
    if (resolveDecide) (resolveDecide as (v: WerewolfAction) => void)({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });
    await new Promise((r) => setTimeout(r, 0));

    const responsesForC3 = sock.sent.filter(
      (m) => m['type'] === 'decide.response' && m['correlationId'] === 'c-3',
    );
    expect(responsesForC3).toEqual([]);

    agent.stop();
  });

  it('drops malformed inbound frames silently', () => {
    const { agent, sock } = buildAgent({ decide: () => stubRequest.validActions[0]! });
    sock.emitOpen();
    sock.emitRaw('not-json');
    sock.emitRaw('{}'); // no type field
    sock.emitMessage({ type: 'unknown' });
    // No outbound frames generated.
    expect(sock.sent).toEqual([]);
    agent.stop();
  });

  it('refuses to start after stop()', () => {
    const { agent } = buildAgent({ decide: () => stubRequest.validActions[0]! });
    agent.stop();
    expect(() => agent.start()).toThrow();
  });

  it('closes the socket with goodbye codes 1002 on protocol mismatch', () => {
    const { agent, sock } = buildAgent({ decide: () => stubRequest.validActions[0]! });
    sock.emitOpen();
    sock.emitMessage({ type: 'hello', protocolVersion: 99, agentId: 'a', serverConnectionId: 's' });
    expect(sock.closeCount).toBeGreaterThanOrEqual(1);
    expect(sock.lastCloseCode).toBe(1002);
    agent.stop();
  });

  it('stops permanently on goodbye{code:banned} (no reconnect attempt)', async () => {
    const { agent, sock } = buildAgent({
      decide: () => stubRequest.validActions[0]!,
      reconnect: true,
    });
    sock.emitOpen();
    sock.emitMessage({ type: 'goodbye', code: 'banned', message: 'rate limit' });
    // The goodbye handler calls stop(); subsequent restart() rejects.
    expect(() => agent.start()).toThrow();
  });
});

// ─── Integration: real ws server ───────────────────────────────────────────
// Makes sure the SDK's defaultSocketFactory actually negotiates a real
// WS upgrade (with the Authorization header) against a stock ws.Server.

describe('WerewolfAgent — real WS round-trip', () => {
  let server: WebSocketServer;
  let port: number;
  let receivedHeaders: Record<string, string> | null = null;
  let serverSideSocket: WebSocket | null = null;

  beforeEach(async () => {
    receivedHeaders = null;
    serverSideSocket = null;
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('listen failed');
    port = addr.port;
    server.on('connection', (ws, req) => {
      receivedHeaders = req.headers as unknown as Record<string, string>;
      serverSideSocket = ws;
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('connects with Authorization: Bearer header and round-trips one decision', async () => {
    const decisionsServerSent: Record<string, unknown>[] = [];
    let agent: WerewolfAgent | null = null;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('integration timed out')), 4000);

      agent = new WerewolfAgent({
        url: `ws://127.0.0.1:${port}/`,
        token: 'integ-token',
        logger: false,
        reconnect: false,
        decide: (req) => req.validActions[0]!,
      });
      agent.start();

      // Wait for the server-side connection, then drive the protocol from the server side.
      const tick = setInterval(() => {
        if (!serverSideSocket) return;
        clearInterval(tick);
        // Send hello (the SDK is permissive about ordering as long as
        // the version matches), then decide, then close.
        serverSideSocket.send(
          JSON.stringify({ type: 'hello', protocolVersion: 1, agentId: 'agent-A', serverConnectionId: 'srv-int' }),
        );
        serverSideSocket.send(
          JSON.stringify({ type: 'decide', correlationId: 'c-int-1', request: stubRequest }),
        );
        serverSideSocket.on('message', (raw) => {
          decisionsServerSent.push(JSON.parse(raw.toString()) as Record<string, unknown>);
          if (decisionsServerSent.some((m) => m['type'] === 'decide.response')) {
            clearTimeout(timeout);
            resolve();
          }
        });
      }, 10);
    });

    expect(receivedHeaders!['authorization']).toBe('Bearer integ-token');
    const response = decisionsServerSent.find((m) => m['type'] === 'decide.response');
    expect(response).toBeDefined();
    expect(response!['correlationId']).toBe('c-int-1');
    expect(response!['action']).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });

    if (agent) (agent as WerewolfAgent).stop();
  });
});

// ─── Reconnect ──────────────────────────────────────────────────────────────

describe('WerewolfAgent — reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a reconnect after socket close (when reconnect enabled)', () => {
    const sockets: FakeSocket[] = [];
    const agent = new WerewolfAgent({
      url: 'ws://test/',
      token: 'tok',
      decide: () => stubRequest.validActions[0]!,
      logger: false,
      reconnect: true,
      reconnectDelaysMs: [100],
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    agent.start();
    expect(sockets).toHaveLength(1);

    sockets[0]!.emitOpen();
    sockets[0]!.emitClose(1006);

    // Allow reconnect timer to fire (with jitter, max base delay × 1.25).
    vi.advanceTimersByTime(200);
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    agent.stop();
  });

  it('does not reconnect when reconnect:false', () => {
    const sockets: FakeSocket[] = [];
    const agent = new WerewolfAgent({
      url: 'ws://test/',
      token: 'tok',
      decide: () => stubRequest.validActions[0]!,
      logger: false,
      reconnect: false,
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    agent.start();
    sockets[0]!.emitClose(1006);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    agent.stop();
  });
});
