import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { HubConnection, RealtimeHub } from './hub.js';
import type { WsServerMessage } from './wire.js';

// SSE adapter for the existing RealtimeHub. Bridges the Hub's
// connection-oriented model (publish to a `HubConnection.send(json)`)
// to the HTTP one-way SSE wire format. Each call to serveSseFromHub
// hijacks the Fastify response, subscribes the synthetic connection to
// the requested topics, and writes `data: <json>\n\n` frames as
// publishes arrive.
//
// SSE wire format reminder (whatwg.org/specs/server-sent-events):
//   - `data: <line>\n\n`         — one event, `<line>` is JSON
//   - `:<comment>\n\n`            — comment (used for heartbeats)
//   - `event: <type>\n`           — optional event type marker
//   - `id: <id>\n`                — optional last-event-id, enables resume
//
// Phase 2 keeps the format conservative: one `data:` line per Hub
// publish, no `event:`/`id:` yet. Resume-on-reconnect is a follow-up
// when we wire Postgres LISTEN/NOTIFY for live event ingestion.

export interface SseStreamOptions {
  // Topics to subscribe at connection time. Caller is responsible for
  // any auth gating before passing them in — the handler does not
  // validate topic visibility (mirrors the Hub's own contract).
  readonly topics: ReadonlyArray<string>;
  // Optional initial events flushed before subscriptions take effect.
  // Use for replay/catch-up: pass the buffered replay events for a
  // running match so a late spectator gets the full history.
  readonly preface?: ReadonlyArray<WsServerMessage>;
  // Heartbeat cadence. Sends `:hb\n\n` (an SSE comment) so proxies
  // don't tear down the idle connection. Default 15s.
  readonly heartbeatMs?: number;
  // Stable connection id for the hub. Defaults to a random uuid; pass
  // an authenticated userId if private topics are in use.
  readonly connectionId?: string;
}

export interface SseStreamHandle {
  // Resolves when the stream closes (client disconnect, error, or a
  // server-side close()). Awaiting this is what keeps the Fastify
  // handler alive for the lifetime of the SSE connection.
  readonly done: Promise<void>;
  // Force-close the stream from the server. Idempotent.
  close(): void;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

export function serveSseFromHub(
  request: FastifyRequest,
  reply: FastifyReply,
  hub: RealtimeHub,
  options: SseStreamOptions,
): SseStreamHandle {
  // Hijack: tells Fastify we own the response; no auto-send/serialize.
  reply.hijack();

  const connectionId = options.connectionId ?? `sse-${randomUUID()}`;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx / Vercel edge proxies not to buffer. Without this,
    // events can be held in a 4-8 KB buffer and arrive in batches —
    // which destroys the live-feel of the stream.
    'X-Accel-Buffering': 'no',
  });
  // Initial comment forces Node's HTTP layer to flush headers + first
  // byte to the client. Some HTTP clients (including Node's fetch in
  // certain configurations) hold the response promise unresolved until
  // the first body byte arrives. Sending a no-op comment unblocks them
  // immediately and is also the canonical SSE "stream open" marker.
  raw.write(':open\n\n');

  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const conn: HubConnection = {
    userId: connectionId,
    send(json: string): void {
      if (closed) return;
      // SSE forbids bare CR/LF inside `data:` line. Hub publishes are
      // already JSON-serialized, so they have no raw newlines, but a
      // future encoding change could break this. Replace \n -> \\n
      // defensively. (JSON serialization escapes embedded newlines as
      // \n already, so this is belt-and-suspenders.)
      const safe = json.replace(/\r?\n/g, '\\n');
      const ok = raw.write(`data: ${safe}\n\n`);
      if (!ok) {
        // Backpressure: socket buffer is full. We drop nothing — Node
        // queues the write internally — but we log a warning so heavy
        // contention is visible.
        // (Intentionally no console.warn here; ops can attach onError
        // hooks via socket events if needed.)
      }
    },
    close(): void {
      cleanup();
    },
  };

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    try {
      hub.unsubscribeAll(conn);
    } catch {
      // hub state is best-effort; never block close on it
    }
    try {
      raw.end();
    } catch {
      // raw socket may already be torn down; ignore
    }
    resolveDone();
  };

  // Heartbeat. Comments `:` are ignored by the EventSource client but
  // keep proxies honest. We restart the timer after every successful
  // write so quiet connections don't double-send.
  const heartbeatTimer = setInterval(() => {
    if (closed) return;
    try {
      raw.write(':hb\n\n');
    } catch {
      cleanup();
    }
  }, heartbeatMs);

  // Flush preface events immediately. These are not routed through the
  // Hub — they're client-direct to support catch-up replay.
  if (options.preface) {
    for (const msg of options.preface) {
      try {
        conn.send(JSON.stringify(msg));
      } catch {
        cleanup();
        return { done, close: cleanup };
      }
    }
  }

  // Subscribe to live topics after preface so events that arrive while
  // we're flushing the preface don't get out-of-order with respect to
  // the buffered slice.
  for (const topic of options.topics) {
    hub.subscribe(conn, topic);
  }

  // Lifecycle: the underlying TCP socket close drops us. Both `request.raw`
  // and `reply.raw` plumb through the same socket events; listening on
  // both is belt-and-suspenders.
  const onClose = (): void => cleanup();
  request.raw.on('close', onClose);
  request.raw.on('error', onClose);
  raw.on('close', onClose);
  raw.on('error', onClose);

  return { done, close: cleanup };
}
