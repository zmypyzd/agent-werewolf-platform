import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;

beforeEach(async () => {
  app = buildServer();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register ${email} failed: ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sid = /apk_sid=([^;]+)/.exec(setCookie)?.[1];
  if (!sid) throw new Error('no apk_sid cookie');
  return sid;
}

async function createTable(sid: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/tables`, {
    method: 'POST',
    headers: { ...CSRF, cookie: `apk_sid=${sid}` },
    body: JSON.stringify({
      name: 'WS', maxSeats: 4,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'ws-seed', defaultTimeoutMs: 1000,
    }),
  });
  return (await res.json() as { data: { tableId: string } }).data.tableId;
}

function connectWs(sid: string | null): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (sid) headers.cookie = `apk_sid=${sid}`;
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
    ws.on('close', (_code, _reason) => {
      // resolve the open promise on early close so the no-cookie test can inspect.
      resolve({ ws, messages });
    });
  });
}

function awaitMessage(messages: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('awaitMessage timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('WS /ws', () => {
  it('rejects unauthenticated upgrade', async () => {
    const { ws } = await connectWs(null);
    await new Promise(r => setTimeout(r, 100));
    expect([WebSocket.CLOSED, WebSocket.CLOSING]).toContain(ws.readyState);
  });

  it('two clients on the same table topic both receive the lobby + table_created broadcast', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const bobSid = await registerAs('bob@x.test');

    const a = await connectWs(aliceSid);
    const b = await connectWs(bobSid);

    a.ws.send(JSON.stringify({ topic: 'lobby', type: 'subscribe', payload: {} }));
    b.ws.send(JSON.stringify({ topic: 'lobby', type: 'subscribe', payload: {} }));
    await new Promise(r => setTimeout(r, 50));

    await createTable(aliceSid);

    const m1 = await awaitMessage(a.messages, m => m['type'] === 'lobby.table_created');
    const m2 = await awaitMessage(b.messages, m => m['type'] === 'lobby.table_created');
    const p1 = m1['payload'] as Record<string, unknown>;
    const p2 = m2['payload'] as Record<string, unknown>;
    expect(p1['tableId']).toBe(p2['tableId']);
    expect(p1['status']).toBe('preparing');

    a.ws.close();
    b.ws.close();
  });

  it('a spectator does not receive any frame containing holeCards while a hand runs with mock agents', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const spectatorSid = await registerAs('spec@x.test');
    const tableId = await createTable(aliceSid);

    const spec = await connectWs(spectatorSid);
    spec.ws.send(JSON.stringify({ topic: `table:${tableId}`, type: 'subscribe', payload: {} }));
    await new Promise(r => setTimeout(r, 50));

    // Sit two mock agents under Alice and start a hand. Mock agents complete instantly.
    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/api/v1/tables/${tableId}/agents`, {
        method: 'POST',
        headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
        body: JSON.stringify({ name: `Bot${i}`, adapterType: 'mock', strategy: 'always-call', buyIn: 1000 }),
      });
    }
    await fetch(`${baseUrl}/api/v1/tables/${tableId}/hands/start`, {
      method: 'POST',
      headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
      body: JSON.stringify({}),
    });

    await awaitMessage(spec.messages, m => m['type'] === 'hand.completed', 4000);

    // Capture every frame the spectator received and confirm no hole cards.
    const dump = JSON.stringify(spec.messages);
    expect(dump).not.toContain('"holeCards"');
    // Sanity: did receive *some* table events.
    const tableFrames = spec.messages.filter(m => typeof m['topic'] === 'string' && (m['topic'] as string).startsWith('table:'));
    expect(tableFrames.length).toBeGreaterThan(0);

    spec.ws.close();
  }, 10_000);
});
