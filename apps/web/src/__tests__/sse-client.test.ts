import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SseClient,
  werewolfStreamUrl,
  type SseConnectionStatus,
  type SseMessage,
} from '../lib/sse.js';

// ─── Fake EventSource ──────────────────────────────────────────────────
// Node test env doesn't ship a native EventSource. The fake mirrors
// just enough of the browser API: readyState transitions, the on*
// handlers, and close(). Tests drive open/message/error transitions
// directly so we can assert the wrapper's behavior deterministically.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 2;
  readonly OPEN = 1;
  readonly CONNECTING = 0;
  readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  withCredentials: boolean;

  constructor(public readonly url: string, init: EventSourceInit = {}) {
    this.withCredentials = init.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  // Test helpers — not in the EventSource API.
  fireOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  fireMessage(data: unknown): void {
    const event = new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
    this.onmessage?.(event);
  }
  fireError(): void {
    this.onerror?.(new Event('error'));
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  vi.restoreAllMocks();
});

describe('SseClient', () => {
  it('constructs an EventSource with the configured URL on connect()', () => {
    const client = new SseClient('https://api.example.com/stream/g1');
    client.connect();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe('https://api.example.com/stream/g1');
  });

  it('emits connecting → connected status as the EventSource opens', () => {
    const client = new SseClient('/stream/g1');
    const statuses: SseConnectionStatus[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect();
    expect(statuses).toEqual(['connecting']);
    FakeEventSource.instances[0]!.fireOpen();
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('parses well-formed JSON messages and dispatches them to listeners', () => {
    const client = new SseClient('/stream/g1');
    const received: SseMessage[] = [];
    client.on((m) => received.push(m));
    client.connect();

    const payload = {
      topic: 'match:g1',
      type: 'engine.action_applied',
      payload: { sequence: 1, foo: 'bar' },
    };
    FakeEventSource.instances[0]!.fireMessage(payload);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  it('silently drops malformed JSON without taking the client down', () => {
    const client = new SseClient('/stream/g1');
    const received: SseMessage[] = [];
    client.on((m) => received.push(m));
    client.connect();

    FakeEventSource.instances[0]!.fireMessage('not json {{');
    expect(received).toHaveLength(0);

    // Subsequent good messages still flow.
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x', payload: {} });
    expect(received).toHaveLength(1);
  });

  it('drops messages that do not match the SseMessage shape', () => {
    const client = new SseClient('/stream/g1');
    const received: SseMessage[] = [];
    client.on((m) => received.push(m));
    client.connect();

    FakeEventSource.instances[0]!.fireMessage({ topic: 't' }); // missing type/payload
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x' }); // missing payload
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x', payload: null }); // null payload
    expect(received).toHaveLength(0);
  });

  it('emits reconnecting status on transient errors and stays connected', () => {
    const client = new SseClient('/stream/g1');
    const statuses: SseConnectionStatus[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect();
    FakeEventSource.instances[0]!.fireOpen();
    statuses.length = 0;

    FakeEventSource.instances[0]!.fireError();
    expect(statuses).toEqual(['reconnecting']);
    // Native EventSource auto-reconnects; our wrapper does not tear
    // down the underlying object. Verify the client did not create a
    // second EventSource instance.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('stops retrying once maxRetries is exceeded and emits closed', () => {
    const client = new SseClient('/stream/g1', { maxRetries: 2 });
    const statuses: SseConnectionStatus[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect();
    const es = FakeEventSource.instances[0]!;
    es.fireError();
    es.fireError();
    es.fireError(); // 3rd → exceeds the 2-cap
    expect(statuses).toContain('closed');
    expect(es.closed).toBe(true);
  });

  it('close() tears down the EventSource and emits closed', () => {
    const client = new SseClient('/stream/g1');
    const statuses: SseConnectionStatus[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect();
    FakeEventSource.instances[0]!.fireOpen();
    client.close();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(statuses).toContain('closed');
  });

  it('close() prevents reconnection on subsequent connect() calls', () => {
    const client = new SseClient('/stream/g1');
    client.connect();
    client.close();
    client.connect();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('forwards withCredentials when the option is set', () => {
    const client = new SseClient('/stream/g1', { withCredentials: true });
    client.connect();
    expect(FakeEventSource.instances[0]!.withCredentials).toBe(true);
  });

  it('listener errors are isolated from the dispatch loop', () => {
    const client = new SseClient('/stream/g1');
    const received: SseMessage[] = [];
    client.on(() => { throw new Error('boom'); });
    client.on((m) => received.push(m));
    client.connect();
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x', payload: {} });
    expect(received).toHaveLength(1);
  });

  it('on() returns an unsubscribe function that detaches the listener', () => {
    const client = new SseClient('/stream/g1');
    const received: SseMessage[] = [];
    const off = client.on((m) => received.push(m));
    client.connect();
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x', payload: { n: 1 } });
    off();
    FakeEventSource.instances[0]!.fireMessage({ topic: 't', type: 'x', payload: { n: 2 } });
    expect(received.map((m) => m.payload['n'])).toEqual([1]);
  });
});

describe('werewolfStreamUrl', () => {
  it('falls back to a same-origin path when VITE_API_BASE_URL is unset', () => {
    expect(werewolfStreamUrl('g-1')).toBe('/api/v1/werewolf/stream/g-1');
  });

  it('encodes gameId so route-injection characters are escaped', () => {
    expect(werewolfStreamUrl('a/b?c=1')).toBe('/api/v1/werewolf/stream/a%2Fb%3Fc%3D1');
  });
});
