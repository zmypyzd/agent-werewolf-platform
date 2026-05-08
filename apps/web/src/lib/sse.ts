// Auto-reconnecting SSE client. Mirrors the surface of WsClient (on /
// onStatus / connect / close) so existing pages can swap import lines
// without restructuring.
//
// Differences vs WsClient:
//   - SSE is one-way (server → client). There is no subscribe()
//     method; the topic is encoded in the URL path itself.
//   - Native EventSource auto-reconnects with `retry:` hints from the
//     server. We layer a manual close + reconnect on top to surface
//     `reconnecting` status to the UI.
//   - SSE comments (`:hb`) are silently dropped by EventSource — the
//     server's heartbeat lands as noise the client never sees.

export interface SseMessage {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
}

type Listener = (m: SseMessage) => void;
export type SseConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';
type StatusListener = (status: SseConnectionStatus) => void;

export interface SseClientOptions {
  // Forward credentials (cookies) on the EventSource handshake. Default
  // false — public spectator streams don't need it. Set true for the
  // Phase 2.5 player-topic path.
  withCredentials?: boolean;
  // Backoff cap for reconnect attempts. Native EventSource manages its
  // own retry interval; this is the upper bound we tolerate before
  // giving up. Default Infinity (retry forever, like WsClient).
  maxRetries?: number;
}

export class SseClient {
  private eventSource: EventSource | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: SseConnectionStatus | null = null;
  private retries = 0;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly options: SseClientOptions = {},
  ) {}

  connect(): void {
    if (this.closed) return;
    if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) return;

    this.emitStatus(this.eventSource ? 'reconnecting' : 'connecting');
    const init: EventSourceInit = {};
    if (this.options.withCredentials) init.withCredentials = true;
    const es = new EventSource(this.url, init);
    this.eventSource = es;

    es.onopen = () => {
      this.retries = 0;
      this.emitStatus('connected');
    };

    es.onmessage = (event) => {
      // Server publishes are JSON-serialized WsServerMessage envelopes
      // wrapped in `data: <json>`. Parse and forward; silently drop
      // anything that doesn't match the shape (defensive — a
      // malformed line shouldn't take down the live feed).
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isSseMessage(parsed)) return;
      for (const listener of this.listeners) {
        try {
          listener(parsed);
        } catch {
          // listener errors are isolated; keep the dispatch loop alive
        }
      }
    };

    es.onerror = () => {
      // EventSource fires onerror both for transient drops (it'll
      // auto-reconnect) and for terminal closes. We can't distinguish
      // the two reliably; closing + recreating gives us a clean
      // reconnect cycle and a `reconnecting` status emission.
      if (this.closed) return;
      this.retries += 1;
      const cap = this.options.maxRetries ?? Infinity;
      if (this.retries > cap) {
        this.emitStatus('closed');
        try { es.close(); } catch { /* swallow */ }
        this.eventSource = null;
        return;
      }
      this.emitStatus('reconnecting');
      // Native EventSource will retry on its own; we don't manually
      // tear it down (doing so would race with its built-in
      // reconnect timer). Leaving readyState=CONNECTING is the
      // canonical EventSource state.
    };
  }

  close(): void {
    this.closed = true;
    if (this.eventSource) {
      try { this.eventSource.close(); } catch { /* swallow */ }
      this.eventSource = null;
    }
    this.emitStatus('closed');
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    if (this.status !== null) {
      try { listener(this.status); } catch { /* swallow */ }
    }
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(s: SseConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const listener of this.statusListeners) {
      try { listener(s); } catch { /* swallow */ }
    }
  }
}

function isSseMessage(x: unknown): x is SseMessage {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o['topic'] === 'string' &&
    typeof o['type'] === 'string' &&
    typeof o['payload'] === 'object' &&
    o['payload'] !== null
  );
}

// Resolves the werewolf SSE endpoint URL. Empty VITE_API_BASE_URL →
// same-origin (the dev / Vercel-rewrite path). Absolute URL → split-
// origin deploy (rare; needs CORS on the API side).
export function werewolfStreamUrl(gameId: string): string {
  const root: string = import.meta.env?.VITE_API_BASE_URL ?? '';
  const safeGameId = encodeURIComponent(gameId);
  return `${root}/api/v1/werewolf/stream/${safeGameId}`;
}
