import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  AGENT_WS_PROTOCOL_VERSION,
  AgentWsClientMessageSchema,
  type AgentWsClientMessage,
  type AgentWsServerMessage,
} from '@agent-poker/agent-protocol';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';

// ─── Reverse-WS transport for external werewolf agents ──────────────────────
// Server-side counterpart to the agent SDK that opens an outbound WS to
// /api/v1/agents/connect. Owns:
//   - point-to-point RPC over a single live connection (correlationId
//     bookkeeping, pending-promise map, hard ceiling per call)
//   - heartbeat (30s ping, drop after 10s missing pong)
//   - last-write-wins on duplicate registrations (laptop sleeps + agent
//     restarts → new conn replaces old, in-flight on old is rejected)
//
// Decoupled from Fastify / `ws`: the route adapter hands a tiny
// `AgentSocket` shim in (just `send` and `close`). Tests substitute an
// in-process fake.
//
// Distinct from RealtimeHub (apps/api/src/routes/ws.ts) — that's
// broadcast pub/sub for spectators. Here is RPC, single connection per
// agent, server-driven.

// ─── Tunable constants ──────────────────────────────────────────────────────

// 30s ping cadence keeps NAT/middlebox idle timers happy on common
// home/cellular networks (60–120s typical). Lowering to ~15s adds traffic
// without measurable benefit; raising past 60s risks idle-disconnects.
export const HEARTBEAT_INTERVAL_MS = 30_000;

// If we don't see a pong within this window, the connection is presumed
// dead and we close it. Set higher than HEARTBEAT_INTERVAL_MS so a single
// ping cycle can be missed without false-positive drops.
export const HEARTBEAT_TIMEOUT_MS = 40_000;

// Per-RPC hard ceiling, computed as `request.deadlineMs * RPC_DEADLINE_MULTIPLIER`.
// TimeoutHandler in the orchestrator has already produced fallback by
// `deadlineMs`; this exists to bound pending-map memory if the agent
// process is alive but slow. On expiry we send `cancel` so the agent can
// stop computing.
export const RPC_DEADLINE_MULTIPLIER = 2;

// ─── Socket shim ────────────────────────────────────────────────────────────

// Minimal contract the registry needs from a WS socket. The Fastify
// route adapts ws.WebSocket to this; tests pass a fake.
export interface AgentSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

// ─── Errors ────────────────────────────────────────────────────────────────

export class AgentOfflineError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent ${agentId} has no live WS connection`);
    this.name = 'AgentOfflineError';
  }
}

export class AgentConnectionClosedError extends Error {
  constructor(public readonly agentId: string, reason: string) {
    super(`agent ${agentId} connection closed: ${reason}`);
    this.name = 'AgentConnectionClosedError';
  }
}

// ─── AgentConnection ───────────────────────────────────────────────────────

interface PendingRpc {
  request: WerewolfDecisionRequest;
  resolve: (res: WerewolfDecisionResponse) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface AgentConnectionOptions {
  readonly agentId: string;
  readonly socket: AgentSocket;
  // Defaults to crypto.randomUUID(). Injected for deterministic tests.
  readonly serverConnectionId?: string;
  // Defaults to crypto.randomUUID(). Injected for deterministic tests.
  readonly correlationIdFactory?: () => string;
  // Defaults to Date.now().
  readonly now?: () => number;
}

export class AgentConnection {
  readonly agentId: string;
  readonly serverConnectionId: string;
  private readonly socket: AgentSocket;
  private readonly correlationIdFactory: () => string;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingRpc>();
  private readonly closeHandlers: Array<(reason: string) => void> = [];
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private lastPongAt: number;
  private closed = false;

  constructor(opts: AgentConnectionOptions) {
    this.agentId = opts.agentId;
    this.socket = opts.socket;
    this.serverConnectionId = opts.serverConnectionId ?? randomUUID();
    this.correlationIdFactory = opts.correlationIdFactory ?? (() => randomUUID());
    this.now = opts.now ?? (() => Date.now());
    this.lastPongAt = this.now();
  }

  // Send the post-auth `hello` and start the heartbeat. Caller invokes
  // this once after wiring socket.on('message') / 'close'. Split from the
  // constructor so the route handler can fully wire socket events first
  // (avoiding a race where the agent replies before the message handler
  // is bound).
  start(): void {
    this.send({
      type: 'hello',
      protocolVersion: AGENT_WS_PROTOCOL_VERSION,
      agentId: this.agentId,
      serverConnectionId: this.serverConnectionId,
    });
    this.heartbeatHandle = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
    // setInterval keeps the Node process alive on its own; that's the
    // standard expectation for a long-running server.
  }

  // Run a single decision RPC over this connection. Resolves with the
  // agent's response, rejects on close / hard-ceiling timeout / agent error.
  async rpc(request: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    if (this.closed) {
      throw new AgentConnectionClosedError(this.agentId, 'already_closed');
    }
    const correlationId = this.correlationIdFactory();
    const ceilingMs = request.deadlineMs * RPC_DEADLINE_MULTIPLIER;
    return await new Promise<WerewolfDecisionResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (!this.pending.delete(correlationId)) return;
        // Tell the agent to give up; the orchestrator already moved on
        // via TimeoutHandler at request.deadlineMs.
        this.safeSend({
          type: 'cancel',
          correlationId,
          reason: 'deadline_exceeded',
        });
        reject(
          new Error(
            `AgentConnection ${this.agentId}: rpc ${correlationId} exceeded hard ceiling ${ceilingMs}ms`,
          ),
        );
      }, ceilingMs);
      this.pending.set(correlationId, { request, resolve, reject, timeoutHandle });
      // The typed `send` path infers mutable arrays from Zod, but `request`
      // is the orchestrator's deeply-readonly type — incompatible at the
      // type level even though the JSON serialization is identical. Send
      // the decide frame as a hand-built object so we don't have to
      // structurally-clone or unsafe-cast the request.
      this.socket.send(
        JSON.stringify({ type: 'decide', correlationId, request }),
      );
    });
  }

  // Subscribe to socket-level close (registry uses this to unregister).
  onClose(handler: (reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  // Inbound: route handler forwards every WS frame here as a string.
  // Malformed JSON / schema-invalid frames are dropped silently (the
  // protocol has no surface for "your last frame was bad"; agent SDK
  // should self-validate before sending).
  handleFrame(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = AgentWsClientMessageSchema.safeParse(parsed);
    if (!result.success) return;
    this.dispatch(result.data);
  }

  // Inbound: route handler forwards the WS close event here. Triggers
  // pending rejections + close handlers; idempotent.
  handleSocketClosed(reason = 'socket_closed'): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new AgentConnectionClosedError(this.agentId, reason));
    }
    this.pending.clear();
    for (const handler of this.closeHandlers) {
      try {
        handler(reason);
      } catch {
        // close handlers must not throw; swallow to keep the loop alive.
      }
    }
  }

  // Server-initiated close. Sends `goodbye` then drives the same cleanup
  // as a remote-initiated close. Used by the registry when a newer
  // connection replaces this one.
  closeWithGoodbye(
    code: 'replaced' | 'unauthorized' | 'banned' | 'server_shutdown',
    message: string,
  ): void {
    if (this.closed) return;
    this.safeSend({ type: 'goodbye', code, message });
    try {
      this.socket.close();
    } catch {
      // socket may already be closing; the close event handler will fire.
    }
    this.handleSocketClosed(code);
  }

  isClosed(): boolean {
    return this.closed;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private dispatch(msg: AgentWsClientMessage): void {
    switch (msg.type) {
      case 'pong':
        this.lastPongAt = this.now();
        return;
      case 'decide.response': {
        const pending = this.pending.get(msg.correlationId);
        if (!pending) return; // late or cancelled
        clearTimeout(pending.timeoutHandle);
        this.pending.delete(msg.correlationId);
        pending.resolve({
          requestId: pending.request.requestId,
          agentId: pending.request.agentId,
          action: msg.action,
          ...(msg.reasoningSummary !== undefined
            ? { reasoningSummary: msg.reasoningSummary }
            : {}),
        });
        return;
      }
      case 'decide.error': {
        const pending = this.pending.get(msg.correlationId);
        if (!pending) return;
        clearTimeout(pending.timeoutHandle);
        this.pending.delete(msg.correlationId);
        pending.reject(
          new Error(
            `agent ${this.agentId}: rpc ${msg.correlationId} failed (${msg.code}): ${msg.message}`,
          ),
        );
        return;
      }
    }
  }

  private tick(): void {
    if (this.closed) return;
    if (this.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      this.closeWithGoodbye('server_shutdown', 'heartbeat timeout');
      return;
    }
    this.safeSend({ type: 'ping', ts: this.now() });
  }

  private send(msg: AgentWsServerMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  // Used in lifecycle paths where a sender error must not surface (e.g.,
  // sending `goodbye` to an already-closing socket or `cancel` after
  // close). The protocol-level intent has already happened on our side.
  private safeSend(msg: AgentWsServerMessage): void {
    try {
      this.send(msg);
    } catch {
      // socket already closing / closed.
    }
  }
}

// ─── AgentConnectionRegistry ───────────────────────────────────────────────

export type AgentRegistryEvent = 'online' | 'offline';

// Last-write-wins on duplicate registration: the older connection
// receives `goodbye{replaced}` and is closed; in-flight RPCs on the old
// reject. This makes "laptop sleeps → agent restarts → reconnect" cost
// at most one fallback action per match instead of crashing.
export class AgentConnectionRegistry {
  private readonly connections = new Map<string, AgentConnection>();
  private readonly emitter = new EventEmitter();

  register(conn: AgentConnection): void {
    const existing = this.connections.get(conn.agentId);
    this.connections.set(conn.agentId, conn);
    if (existing && existing !== conn) {
      // Order: install the new connection first, THEN evict the old. The
      // old's closeWithGoodbye triggers its onClose handlers, one of
      // which is the unregister we wired in the route. That unregister
      // is a no-op now because the map already points at the new conn
      // (see unregister's identity check).
      existing.closeWithGoodbye('replaced', 'replaced by a newer connection');
    } else {
      this.emitter.emit('online', conn.agentId);
    }
  }

  // Idempotent. Only removes if `conn` is still the currently-registered
  // one (so a stale unregister from a replaced connection's close
  // handler does not evict its successor).
  unregister(conn: AgentConnection): void {
    const current = this.connections.get(conn.agentId);
    if (current !== conn) return;
    this.connections.delete(conn.agentId);
    this.emitter.emit('offline', conn.agentId);
  }

  acquire(agentId: string): AgentConnection | null {
    const conn = this.connections.get(agentId);
    if (!conn || conn.isClosed()) return null;
    return conn;
  }

  on(event: AgentRegistryEvent, handler: (agentId: string) => void): () => void {
    this.emitter.on(event, handler);
    return () => {
      this.emitter.off(event, handler);
    };
  }

  // Test/diagnostic only. Production code should use acquire().
  liveAgentIds(): string[] {
    return Array.from(this.connections.keys());
  }

  // Server shutdown: close every live connection so agents see a
  // `goodbye{server_shutdown}` instead of an abrupt socket reset.
  closeAll(reason = 'server shutdown'): void {
    for (const conn of this.connections.values()) {
      conn.closeWithGoodbye('server_shutdown', reason);
    }
    this.connections.clear();
  }
}
