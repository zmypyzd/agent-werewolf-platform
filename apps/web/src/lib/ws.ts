// Auto-reconnecting WebSocket client. Maintains the set of subscribed topics
// across reconnects and dispatches every server-pushed message to listeners.
export interface WsMessage {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
}

type Listener = (m: WsMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly subscriptions = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly url: string = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {}

  connect(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const topic of this.subscriptions) {
        ws.send(JSON.stringify({ topic, type: 'subscribe', payload: {} }));
      }
    };
    ws.onmessage = (event) => {
      try {
        const m = JSON.parse(event.data as string) as WsMessage;
        for (const listener of this.listeners) listener(m);
      } catch { /* ignore non-JSON frames */ }
    };
    ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // close will follow; reconnect happens there.
      try { ws.close(); } catch { /* swallow */ }
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  subscribe(topic: string): void {
    this.subscriptions.add(topic);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ topic, type: 'subscribe', payload: {} }));
    }
  }

  unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ topic, type: 'unsubscribe', payload: {} }));
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { this.ws?.close(); } catch { /* swallow */ }
    this.ws = null;
  }
}
