import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { WebSocket } from 'ws';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

interface AgentStub {
  url: string;
  receivedRequests: number;
  close: () => Promise<void>;
}

async function startAgentStub(): Promise<AgentStub> {
  let receivedRequests = 0;
  const app = Fastify({ logger: false });
  app.post('/decide', async (req) => {
    receivedRequests += 1;
    const body = req.body as {
      requestId: string;
      agentId: string;
      legalActions: Array<{ type: string; callAmount?: number; minAmount?: number; maxAmount?: number }>;
    };
    const action = pickFirstLegal(body.legalActions);
    return {
      requestId: body.requestId,
      agentId: body.agentId,
      actionType: action.actionType,
      ...(action.amount !== undefined ? { amount: action.amount } : {}),
    };
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('agent stub listen failed');
  return {
    url: `http://127.0.0.1:${addr.port}/decide`,
    get receivedRequests() { return receivedRequests; },
    close: () => app.close(),
  };
}

function pickFirstLegal(legalActions: Array<{ type: string; callAmount?: number; minAmount?: number }>): {
  actionType: string;
  amount?: number;
} {
  for (const t of ['check', 'call', 'fold']) {
    const found = legalActions.find(la => la.type === t);
    if (found) {
      return found.callAmount !== undefined
        ? { actionType: t, amount: found.callAmount }
        : { actionType: t };
    }
  }
  const first = legalActions[0]!;
  return first.minAmount !== undefined
    ? { actionType: first.type, amount: first.minAmount }
    : { actionType: first.type };
}

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let stub: AgentStub;

beforeEach(async () => {
  app = buildServer();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('server listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
  stub = await startAgentStub();
});

afterEach(async () => {
  await stub.close();
  await app.close();
});

async function registerAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register ${email}: ${await res.text()}`);
  const sid = /apk_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!sid) throw new Error('no apk_sid cookie');
  return sid;
}

async function postJson(path: string, sid: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...CSRF, cookie: `apk_sid=${sid}` },
    body: JSON.stringify(body),
  });
}

interface ConnectedWs {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  onMessage: (handler: (m: Record<string, unknown>) => void) => void;
}

function connectWs(sid: string): Promise<ConnectedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers: { cookie: `apk_sid=${sid}` } });
    const messages: Array<Record<string, unknown>> = [];
    const handlers: Array<(m: Record<string, unknown>) => void> = [];
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw.toString()) as Record<string, unknown>;
        messages.push(m);
        for (const h of handlers) h(m);
      } catch { /* ignore */ }
    });
    ws.on('error', reject);
    ws.on('open', () => resolve({
      ws,
      messages,
      onMessage(h) { handlers.push(h); },
    }));
  });
}

function awaitMessage(
  messages: Array<Record<string, unknown>>,
  predicate: (m: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
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

describe('Backend e2e — full demo flow (M11)', () => {
  it('Alice (human) + Bob\'s HTTP agent run a hand to completion via WS + REST', async () => {
    const aliceSid = await registerAs('alice@e.test');
    const bobSid = await registerAs('bob@e.test');

    // Bob registers an HTTP agent config pointing at our stub.
    const cfgRes = await postJson('/api/v1/me/agents', bobSid, {
      agentName: 'BobBot',
      endpointUrl: stub.url,
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 5000,
      description: null,
    });
    expect(cfgRes.status).toBe(201);
    const agentConfigId = (await cfgRes.json() as { data: { agentConfigId: string } }).data.agentConfigId;

    // Alice opens a WS and subscribes to lobby BEFORE the table is created so
    // she observes lobby.table_created.
    const alice = await connectWs(aliceSid);
    alice.ws.send(JSON.stringify({ topic: 'lobby', type: 'subscribe', payload: {} }));
    await new Promise(r => setTimeout(r, 50));

    // Alice creates the table.
    const tableRes = await postJson('/api/v1/tables', aliceSid, {
      name: 'E2E', maxSeats: 4,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'e2e-seed', defaultTimeoutMs: 5000,
    });
    expect(tableRes.status).toBe(201);
    const tableId = (await tableRes.json() as { data: { tableId: string } }).data.tableId;

    // Subscribe to the table topic; the seat:<userId>:<tableId> topic is
    // auto-subscribed on the server side.
    alice.ws.send(JSON.stringify({ topic: `table:${tableId}`, type: 'subscribe', payload: {} }));
    await new Promise(r => setTimeout(r, 50));

    // Auto-responder for Alice: when seat.action_requested arrives, POST a legal action.
    const submittedRequestIds = new Set<string>();
    alice.onMessage(async (m) => {
      if (m['type'] !== 'seat.action_requested') return;
      const payload = m['payload'] as {
        handId: string;
        requestId: string;
        legalActions: Array<{ type: string; callAmount?: number; minAmount?: number }>;
      };
      if (submittedRequestIds.has(payload.requestId)) return;
      submittedRequestIds.add(payload.requestId);
      const action = pickFirstLegal(payload.legalActions);
      await postJson(`/api/v1/tables/${tableId}/actions`, aliceSid, {
        handId: payload.handId,
        actionType: action.actionType,
        ...(action.amount !== undefined ? { amount: action.amount } : {}),
      });
    });

    // Alice sits at seat 0 as a human.
    const sitAlice = await postJson(`/api/v1/tables/${tableId}/seats`, aliceSid, {
      seatIndex: 0, buyIn: 1000,
    });
    expect(sitAlice.status).toBe(201);

    // Bob sits his agent at seat 1.
    const sitBob = await postJson(`/api/v1/tables/${tableId}/seats/agent`, bobSid, {
      seatIndex: 1, buyIn: 1000, agentConfigId,
    });
    expect(sitBob.status).toBe(201);

    // Start the hand. /hands/start blocks until the hand completes; fire it
    // and concurrently let Alice's auto-responder push actions in.
    const handPromise = postJson(`/api/v1/tables/${tableId}/hands/start`, aliceSid, {});

    // Wait until the hand completes (observed via WS).
    await awaitMessage(alice.messages, m => m['type'] === 'hand.completed', 15_000);

    const handRes = await handPromise;
    expect(handRes.status).toBe(200);
    const summary = (await handRes.json() as { data: {
      handId: string;
      players: Array<{ stackAfter: number; playerId: string }>;
    } }).data;

    expect(summary.handId).toBeTruthy();
    const total = summary.players.reduce((s, p) => s + p.stackAfter, 0);
    expect(total).toBe(2000);

    // Visibility invariant: no holeCards should appear on the public table:* topic.
    const tableFrames = alice.messages.filter(
      m => typeof m['topic'] === 'string' && (m['topic'] as string) === `table:${tableId}`,
    );
    for (const frame of tableFrames) {
      expect(JSON.stringify(frame)).not.toContain('"holeCards"');
    }

    // Alice did receive her own hole cards on the seat:* private topic.
    const seatFrames = alice.messages.filter(
      m => typeof m['topic'] === 'string' && (m['topic'] as string).startsWith('seat:'),
    );
    expect(seatFrames.some(m => m['type'] === 'seat.hole_cards')).toBe(true);

    // Lobby: Alice was subscribed to lobby, so she saw lobby.table_created at the top.
    expect(alice.messages.some(m => m['type'] === 'lobby.table_created')).toBe(true);
    expect(alice.messages.some(m => m['type'] === 'table.player_seated')).toBe(true);
    expect(alice.messages.some(m => m['type'] === 'hand.started')).toBe(true);

    // The HTTP agent endpoint was actually called by the engine — proves
    // HttpAgentAdapter works end-to-end.
    expect(stub.receivedRequests).toBeGreaterThanOrEqual(1);

    // Replay endpoint returns the hand events from disk/store.
    const replayRes = await fetch(
      `${baseUrl}/api/v1/tables/${tableId}/hands/${summary.handId}/replay`,
      { headers: { cookie: `apk_sid=${aliceSid}` } },
    );
    expect(replayRes.status).toBe(200);
    const replayEvents = (await replayRes.json() as { data: unknown[] }).data;
    expect(replayEvents.length).toBeGreaterThan(0);

    alice.ws.close();
  }, 30_000);
});
