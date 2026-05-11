import { WebSocket } from 'ws';

// ─── @agent-werewolf/agent-sdk ──────────────────────────────────────────────
// Reverse-WebSocket SDK for external werewolf agents on the Agent Poker
// platform. Lets you run a fully-isolated agent process with **no inbound
// port exposure** — the agent opens an outbound WS to the platform; the
// platform pushes decision requests back over that connection.
//
// Wire protocol mirror of docs/agent-ws-transport-design.md. Types are
// inlined intentionally so this package has zero @agent-poker/* runtime
// dependencies — `npm i @agent-werewolf/agent-sdk` is one self-contained
// install. The schemas are simple enough that the drift risk is low; if
// the platform's protocol version bumps, the agent's hello frame surfaces
// the mismatch on connect (we log + close).

// ─── Types — mirror of @agent-poker/agent-protocol ──────────────────────────
// The agent protocol is small and stable; inlining beats a runtime dep.
// If the platform ever ships a breaking protocol change, increment
// SUPPORTED_PROTOCOL_VERSION below and the SDK refuses connections with a
// clear error instead of silently mis-handling frames.

export const SUPPORTED_PROTOCOL_VERSION = 1;

export type WerewolfPhase =
  | 'setup'
  | 'night-werewolf-vote'
  | 'night-witch'
  | 'night-seer'
  | 'night-resolve'
  | 'day-announce'
  | 'day-speeches'
  | 'day-vote'
  | 'day-resolve'
  | 'hunter-shoot'
  | 'game-over';

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';
export type WerewolfSide = 'werewolf' | 'good';

export interface WerewolfPlayer {
  readonly id: string;
  readonly seatIndex: number;
  readonly name: string;
  readonly alive: boolean;
  readonly revealedRole: WerewolfRole | null;
}

export interface WerewolfPublicState {
  readonly gameId: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly players: readonly WerewolfPlayer[];
  readonly history: ReadonlyArray<Record<string, unknown>>;
  readonly winner: WerewolfSide | null;
}

export interface WerewolfPrivateState {
  readonly selfId: string;
  readonly selfRole: WerewolfRole;
  readonly selfSide: WerewolfSide;
  readonly knownAllies: readonly string[];
  readonly seerKnowledge: ReadonlyArray<{ targetId: string; side: WerewolfSide }>;
  readonly witchView: {
    potions: { hasSave: boolean; hasPoison: boolean };
    currentNightKillTarget: string | null;
  } | null;
  readonly hunterCanShoot: boolean;
}

// Discriminated by `type`. Mirrors WerewolfActionSchema in
// @agent-poker/agent-protocol. The orchestrator validates against the
// schema on receipt; bad shapes get fallback-substituted.
export type WerewolfAction =
  | { type: 'werewolf-vote'; voterId: string; targetId: string }
  | { type: 'witch-save'; targetId: string }
  | { type: 'witch-skip-save' }
  | { type: 'witch-poison'; targetId: string }
  | { type: 'witch-skip-poison' }
  | { type: 'seer-divine'; targetId: string }
  | { type: 'speak'; playerId: string; inner: string; performance: string; speech: string }
  | { type: 'day-vote'; voterId: string; targetId: string | null }
  | { type: 'hunter-shoot'; targetId: string | null };

export interface WerewolfBriefing {
  readonly rulesSummary: string;
  readonly outputFormat: string;
  readonly docsUrl?: string;
}

export interface WerewolfDecisionRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: string;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: readonly WerewolfAction[];
  readonly deadlineMs: number;
  readonly briefing?: WerewolfBriefing;
}

export interface WerewolfReasoningSummary {
  readonly intent: string;
  readonly confidence: number;
  readonly keyObservations: readonly string[];
}

// ─── Logger ─────────────────────────────────────────────────────────────────

export interface AgentLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const consoleLogger: AgentLogger = {
  info: (m) => console.log(`[werewolf-agent] ${m}`),
  warn: (m) => console.warn(`[werewolf-agent] ${m}`),
  error: (m) => console.error(`[werewolf-agent] ${m}`),
};

const silentLogger: AgentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Socket factory (DI seam for tests) ─────────────────────────────────────

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (data: Buffer | ArrayBuffer | Uint8Array) => void): void;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

const defaultSocketFactory: SocketFactory = (url, headers) =>
  new WebSocket(url, { headers }) as unknown as SocketLike;

// ─── Decide handler ─────────────────────────────────────────────────────────

export type DecideHandler = (
  req: WerewolfDecisionRequest,
  ctx: DecideContext,
) => Promise<WerewolfAction | DecideResult> | WerewolfAction | DecideResult;

export interface DecideContext {
  /** Aborted if the platform sends `cancel` for this decision. */
  readonly signal: AbortSignal;
}

export interface DecideResult {
  action: WerewolfAction;
  reasoningSummary?: WerewolfReasoningSummary;
}

function isDecideResult(v: WerewolfAction | DecideResult): v is DecideResult {
  return 'action' in v && typeof (v as DecideResult).action === 'object';
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface WerewolfAgentOptions {
  /** Connect URL. Get this from the registration endpoint's wsConnect.url. */
  url: string;
  /** Bearer token. Get this from the registration endpoint's wsConnect.token. */
  token: string;
  /** Your decision function. Return one of req.validActions verbatim. */
  decide: DecideHandler;
  /** Logger. Defaults to console; pass `false` to silence. */
  logger?: AgentLogger | false;
  /**
   * Reconnect backoff in ms. Tried in order, then the last value repeats.
   * Default: [1000, 2000, 5000, 10000, 30000, 60000].
   */
  reconnectDelaysMs?: readonly number[];
  /** Pass false to disable reconnection (useful for one-shot tests). */
  reconnect?: boolean;
  /** Override the WS factory. Tests use this to inject a fake socket. */
  socketFactory?: SocketFactory;
}

// ─── Inbound frame shapes (server → agent) ──────────────────────────────────
// Only the fields the SDK reads. Validated by the platform before sending,
// so we type-cast on receipt rather than re-parse with Zod.

interface ServerHelloFrame {
  type: 'hello';
  protocolVersion: number;
  agentId: string;
  serverConnectionId: string;
}
interface ServerDecideFrame {
  type: 'decide';
  correlationId: string;
  request: WerewolfDecisionRequest;
}
interface ServerCancelFrame {
  type: 'cancel';
  correlationId: string;
  reason: string;
}
interface ServerPingFrame {
  type: 'ping';
  ts: number;
}
interface ServerGoodbyeFrame {
  type: 'goodbye';
  code: 'replaced' | 'unauthorized' | 'banned' | 'server_shutdown';
  message: string;
}

type ServerFrame =
  | ServerHelloFrame
  | ServerDecideFrame
  | ServerCancelFrame
  | ServerPingFrame
  | ServerGoodbyeFrame;

// ─── WerewolfAgent ──────────────────────────────────────────────────────────

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000] as const;

export class WerewolfAgent {
  private readonly url: string;
  private readonly token: string;
  private readonly decide: DecideHandler;
  private readonly logger: AgentLogger;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly reconnectEnabled: boolean;
  private readonly socketFactory: SocketFactory;
  private readonly inflight = new Map<string, AbortController>();

  private socket: SocketLike | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WerewolfAgentOptions) {
    this.url = opts.url;
    this.token = opts.token;
    this.decide = opts.decide;
    this.logger = opts.logger === false ? silentLogger : opts.logger ?? consoleLogger;
    this.reconnectDelaysMs = opts.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS;
    this.reconnectEnabled = opts.reconnect !== false;
    this.socketFactory = opts.socketFactory ?? defaultSocketFactory;
  }

  /**
   * Open the WS and start handling decisions. Returns immediately; the
   * agent runs until stop() is called or a non-recoverable goodbye is
   * received.
   */
  start(): void {
    if (this.stopped) {
      throw new Error('WerewolfAgent: cannot start after stop()');
    }
    this.openSocket();
  }

  /**
   * Close the WS and stop reconnecting. Safe to call multiple times. Any
   * in-flight decisions are aborted; a `decide.error{cancelled}` is sent
   * to the platform on best-effort basis.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, ctrl] of this.inflight) {
      ctrl.abort();
    }
    this.inflight.clear();
    if (this.socket) {
      try {
        this.socket.close(1000, 'agent shutdown');
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  private openSocket(): void {
    if (this.stopped) return;
    this.logger.info(`connecting to ${this.url} (attempt ${this.reconnectAttempt + 1})`);
    const sock = this.socketFactory(this.url, {
      authorization: `Bearer ${this.token}`,
    });
    this.socket = sock;

    sock.on('open', () => {
      this.logger.info('socket open; awaiting hello');
      // Reset reconnect backoff on a successful TCP/WS upgrade. We treat
      // "made it past the upgrade" as health, even before hello — a
      // server that authenticates us at upgrade and then immediately
      // misbehaves is rare enough that a single retry cycle is fine.
      this.reconnectAttempt = 0;
    });

    sock.on('message', (raw) => {
      this.handleRaw(raw);
    });

    sock.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      this.logger.warn(`socket closed: code=${code} reason=${reason}`);
      this.socket = null;
      // Cancel everything in-flight; their results are no longer
      // deliverable. The platform will fall back at its own deadline.
      for (const [, ctrl] of this.inflight) ctrl.abort();
      this.inflight.clear();
      this.scheduleReconnect();
    });

    sock.on('error', (err) => {
      this.logger.error(`socket error: ${err.message}`);
      // No reconnect scheduling here — `close` always follows `error`,
      // and scheduling in both leads to double timers.
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.reconnectEnabled) return;
    const idx = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const baseDelay = this.reconnectDelaysMs[idx]!;
    // ±25% jitter so a fleet of agents reconnecting from the same
    // outage don't synchronize their retries against the platform.
    const jitter = baseDelay * (0.25 - Math.random() * 0.5);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    this.reconnectAttempt += 1;
    this.logger.info(`reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private handleRaw(raw: Buffer | ArrayBuffer | Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      this.logger.warn('dropped non-JSON frame');
      return;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      this.logger.warn('dropped frame with no type');
      return;
    }
    const frame = parsed as ServerFrame;
    void this.dispatchFrame(frame);
  }

  private async dispatchFrame(frame: ServerFrame): Promise<void> {
    switch (frame.type) {
      case 'hello':
        if (frame.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
          this.logger.error(
            `protocol version mismatch: server=${frame.protocolVersion} sdk=${SUPPORTED_PROTOCOL_VERSION}; closing`,
          );
          this.socket?.close(1002, 'protocol version mismatch');
          return;
        }
        this.logger.info(
          `hello: agentId=${frame.agentId} serverConnectionId=${frame.serverConnectionId}`,
        );
        return;

      case 'ping':
        this.send({ type: 'pong', ts: frame.ts });
        return;

      case 'cancel': {
        const ctrl = this.inflight.get(frame.correlationId);
        if (ctrl) {
          this.logger.info(`cancel ${frame.correlationId}: ${frame.reason}`);
          ctrl.abort();
          this.inflight.delete(frame.correlationId);
        }
        return;
      }

      case 'goodbye':
        this.logger.warn(`goodbye received: code=${frame.code} message=${frame.message}`);
        // 'banned' and 'unauthorized' are fatal: reconnecting would just
        // get rejected again. Don't burn cycles or alert noise.
        if (frame.code === 'banned' || frame.code === 'unauthorized') {
          this.logger.error(`stopping permanently due to ${frame.code}`);
          this.stop();
        }
        // Other codes (replaced, server_shutdown) are transient; the
        // socket close handler will schedule a reconnect.
        return;

      case 'decide':
        await this.runDecide(frame);
        return;
    }
  }

  private async runDecide(frame: ServerDecideFrame): Promise<void> {
    const correlationId = frame.correlationId;
    const ctrl = new AbortController();
    this.inflight.set(correlationId, ctrl);
    try {
      const raw = await this.decide(frame.request, { signal: ctrl.signal });
      // If a cancel arrived while user was computing, drop the response —
      // the orchestrator already substituted fallback at deadlineMs and
      // will treat a late `decide.response` as orphaned anyway.
      if (ctrl.signal.aborted) {
        this.send({
          type: 'decide.error',
          correlationId,
          code: 'cancelled',
          message: 'cancelled by platform',
        });
        return;
      }
      const result: DecideResult = isDecideResult(raw) ? raw : { action: raw };
      this.send({
        type: 'decide.response',
        correlationId,
        action: result.action,
        ...(result.reasoningSummary !== undefined
          ? { reasoningSummary: result.reasoningSummary }
          : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`decide handler threw on ${correlationId}: ${message}`);
      this.send({
        type: 'decide.error',
        correlationId,
        code: 'handler_threw',
        message: message.slice(0, 500),
      });
    } finally {
      this.inflight.delete(correlationId);
    }
  }

  private send(frame: Record<string, unknown>): void {
    if (!this.socket) {
      this.logger.warn(`drop outbound frame: socket closed (type=${String(frame['type'])})`);
      return;
    }
    try {
      this.socket.send(JSON.stringify(frame));
    } catch (err) {
      this.logger.warn(`send failed: ${(err as Error).message}`);
    }
  }
}
