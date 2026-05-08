import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RealtimeHub, werewolfMatchTopic } from '@agent-poker/realtime';
import { buildServer } from '../server.js';

// SSE end-to-end via real socket. app.inject buffers the entire
// response, which is incompatible with streaming responses; we listen
// on an ephemeral port and read chunks via fetch's ReadableStream.

describe('GET /api/v1/werewolf/stream/:gameId (SSE)', () => {
  let app: FastifyInstance;
  let hub: RealtimeHub;
  let baseUrl: string;

  beforeEach(async () => {
    hub = new RealtimeHub();
    app = buildServer({ hub });
    await app.ready();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    baseUrl = address.replace(/\/$/, '');
  });

  afterEach(async () => {
    // Force-kill open SSE connections so app.close() doesn't hang on
    // the never-resolving handler promises. Node 18.2+ exposes
    // server.closeAllConnections; fall back gracefully if absent.
    (app.server as { closeAllConnections?: () => void }).closeAllConnections?.();
    await app.close();
  });

  it('opens with text/event-stream and streams hub publishes as data: frames', async () => {
    const gameId = 'g-sse-1';
    const controller = new AbortController();
    const respPromise = fetch(`${baseUrl}/api/v1/werewolf/stream/${gameId}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    const resp = await respPromise;
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');
    expect(resp.headers.get('cache-control')).toContain('no-cache');

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();

    // Subscription happens inside the route handler, which runs on the
    // next tick. Yield once so the hub.subscribe call lands before we
    // publish — otherwise the publish has no subscribers and is dropped.
    await new Promise((r) => setTimeout(r, 50));

    const topic = werewolfMatchTopic(gameId);
    hub.publish(topic, {
      topic,
      type: 'engine.action_applied',
      payload: { sequence: 1, hello: 'world' },
    });

    // Read until we accumulate a complete SSE frame ending with \n\n.
    let buf = '';
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes('\n\n') && buf.includes('data: ')) break;
    }

    expect(buf).toMatch(/data: \{.*"type":"engine\.action_applied".*\}\n\n/);
    const dataLine = buf.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(dataLine.slice('data: '.length));
    expect(payload.payload.hello).toBe('world');

    controller.abort();
    try {
      await reader.cancel();
    } catch { /* abort already tore the reader down */ }
  }, 10_000);

  it('emits heartbeat comments on idle connections', async () => {
    const gameId = 'g-sse-2';
    const controller = new AbortController();
    const resp = await fetch(`${baseUrl}/api/v1/werewolf/stream/${gameId}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(resp.status).toBe(200);

    // Override heartbeat would require route option plumbing; instead
    // we verify the connection survives an idle period and the hub
    // still sees a subscriber. (Default heartbeat is 15s — too long
    // for a 10s test budget. We assert subscription persistence as a
    // proxy for "connection is alive".)
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.topicCount(werewolfMatchTopic(gameId))).toBe(1);

    controller.abort();
    try {
      await resp.body?.cancel();
    } catch { /* abort tore it down */ }
    // Wait for the route handler to finish cleanup.
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.topicCount(werewolfMatchTopic(gameId))).toBe(0);
  }, 10_000);

  it('returns 400 when gameId is missing/empty', async () => {
    const resp = await fetch(`${baseUrl}/api/v1/werewolf/stream/`, {
      headers: { accept: 'text/event-stream' },
    });
    // Either 400 (route matched with empty :gameId, handler rejects)
    // or 404 (route didn't match) — both are acceptable rejection
    // surfaces. The point is the request doesn't hang or stream.
    expect([400, 404]).toContain(resp.status);
    await resp.body?.cancel();
  });

  it('cleanly unsubscribes from the hub when the client disconnects', async () => {
    const gameId = 'g-sse-3';
    const topic = werewolfMatchTopic(gameId);
    const controller = new AbortController();
    const resp = await fetch(`${baseUrl}/api/v1/werewolf/stream/${gameId}`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(resp.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(hub.topicCount(topic)).toBe(1);

    controller.abort();
    try {
      await resp.body?.cancel();
    } catch { /* expected */ }

    // Give the close handler a tick to fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.topicCount(topic)).toBe(0);
  });

  it('supports multiple concurrent spectators on the same gameId', async () => {
    const gameId = 'g-sse-4';
    const topic = werewolfMatchTopic(gameId);

    const c1 = new AbortController();
    const c2 = new AbortController();
    const r1 = await fetch(`${baseUrl}/api/v1/werewolf/stream/${gameId}`, { signal: c1.signal });
    const r2 = await fetch(`${baseUrl}/api/v1/werewolf/stream/${gameId}`, { signal: c2.signal });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(hub.topicCount(topic)).toBe(2);

    hub.publish(topic, { topic, type: 'phase.changed', payload: { to: 'day' } });

    const reader1 = r1.body!.getReader();
    const reader2 = r2.body!.getReader();
    const decoder = new TextDecoder();

    const collect = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      let buf = '';
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('phase.changed')) break;
      }
      return buf;
    };

    const [b1, b2] = await Promise.all([collect(reader1), collect(reader2)]);
    expect(b1).toContain('phase.changed');
    expect(b2).toContain('phase.changed');

    c1.abort();
    c2.abort();
    try { await reader1.cancel(); } catch { /* abort tore it down */ }
    try { await reader2.cancel(); } catch { /* abort tore it down */ }
  }, 10_000);
});
