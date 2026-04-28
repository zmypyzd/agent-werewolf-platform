import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildServer } from '../server.js';

vi.mock('@agent-poker/table-orchestrator', async () => import('../../../../packages/table-orchestrator/src/index.js'));

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

async function subscribeAndWaitForPong(
  client: { ws: WebSocket; messages: Array<Record<string, unknown>> },
  topic: string,
): Promise<void> {
  client.ws.send(JSON.stringify({ topic, type: 'subscribe', payload: {} }));
  client.ws.send(JSON.stringify({ topic, type: 'ping', payload: {} }));
  await awaitMessage(client.messages, m => m['topic'] === topic && m['type'] === 'pong');
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

  it('a spectator receives revealed hole cards for each player on the table topic', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const spectatorSid = await registerAs('spec@x.test');
    const tableId = await createTable(aliceSid);
    const tableTopic = `table:${tableId}`;

    const spec = await connectWs(spectatorSid);
    await subscribeAndWaitForPong(spec, tableTopic);

    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/api/v1/tables/${tableId}/agents`, {
        method: 'POST',
        headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
        body: JSON.stringify({
          name: `Bot${i}`,
          adapterType: 'mock',
          strategy: 'always-call',
          buyIn: 1000,
        }),
      });
    }

    await fetch(`${baseUrl}/api/v1/tables/${tableId}/hands/start`, {
      method: 'POST',
      headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
      body: JSON.stringify({}),
    });

    await awaitMessage(spec.messages, m => m['type'] === 'hand.completed', 4000);

    const revealFrames = spec.messages.filter(m => m['type'] === 'table.hole_cards_revealed');
    expect(revealFrames).toHaveLength(2);

    const tableFrames = spec.messages.filter(m => m['topic'] === tableTopic);
    expect(tableFrames.some(m => m['type'] === 'table.hole_cards_revealed')).toBe(true);
    expect(tableFrames.some(m => m['type'] === 'hole_cards.dealt')).toBe(false);
    expect(tableFrames.some(m => m['type'] === 'seat.hole_cards')).toBe(false);
    expect(spec.messages.some(m => m['type'] === 'seat.hole_cards')).toBe(false);

    for (const frame of tableFrames) {
      if (JSON.stringify(frame).includes('"holeCards"')) {
        expect(frame['type']).toBe('table.hole_cards_revealed');
      }
    }

    const seenPlayers = new Set<string>();
    for (const frame of revealFrames) {
      expect(frame['topic']).toBe(tableTopic);
      const payload = frame['payload'] as Record<string, unknown>;
      expect(payload['handId']).toEqual(expect.stringMatching(/^hand-/));
      expect(payload['playerId']).toEqual(expect.stringMatching(/^player-/));
      expect(payload['agentId']).toEqual(expect.stringMatching(/^agent-/));
      expect(typeof payload['seatIndex']).toBe('number');
      expect(payload['holeCards']).toHaveLength(2);
      seenPlayers.add(String(payload['playerId']));
    }

    expect(seenPlayers.size).toBe(2);

    spec.ws.close();
  }, 10_000);

  it('private hole-card frames include the owning seat identity', async () => {
    const aliceSid = await registerAs('alice-private@x.test');
    const tableId = await createTable(aliceSid);
    const tableTopic = `table:${tableId}`;

    const alice = await connectWs(aliceSid);
    await subscribeAndWaitForPong(alice, tableTopic);

    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/api/v1/tables/${tableId}/agents`, {
        method: 'POST',
        headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
        body: JSON.stringify({
          name: `PrivateBot${i}`,
          adapterType: 'mock',
          strategy: 'always-call',
          buyIn: 1000,
        }),
      });
    }

    await fetch(`${baseUrl}/api/v1/tables/${tableId}/hands/start`, {
      method: 'POST',
      headers: { ...CSRF, cookie: `apk_sid=${aliceSid}` },
      body: JSON.stringify({}),
    });

    await awaitMessage(alice.messages, m => m['type'] === 'hand.completed', 4000);

    const seatFrames = alice.messages.filter(
      m => typeof m['topic'] === 'string' && (m['topic'] as string).startsWith('seat:') && m['type'] === 'seat.hole_cards',
    );
    expect(seatFrames).toHaveLength(2);

    for (const frame of seatFrames) {
      const payload = frame['payload'] as Record<string, unknown>;
      expect(payload['handId']).toEqual(expect.stringMatching(/^hand-/));
      expect(payload['playerId']).toEqual(expect.stringMatching(/^player-/));
      expect(payload['agentId']).toEqual(expect.stringMatching(/^agent-/));
      expect(typeof payload['seatIndex']).toBe('number');
      expect(payload['holeCards']).toHaveLength(2);
    }

    alice.ws.close();
  }, 10_000);
});
