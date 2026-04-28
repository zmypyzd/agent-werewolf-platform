import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;
let userCounter = 0;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  userCounter += 1;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({
      email: `u${userCounter}@x.test`,
      password: 'hunter22pw',
      displayName: `U${userCounter}`,
    }),
  });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  const setCookie = reg.headers['set-cookie'];
  const sid = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? '').match(/apk_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error('register did not set apk_sid');
  cookie = sid;
});

afterEach(async () => {
  await app.close();
});

async function injectPost(path: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify(body),
  });
}

async function injectGet(path: string) {
  return app.inject({ method: 'GET', url: path, cookies: { apk_sid: cookie } });
}

async function injectDelete(path: string) {
  return app.inject({
    method: 'DELETE',
    url: path,
    headers: CSRF,
    cookies: { apk_sid: cookie },
  });
}

const baseTable = {
  name: 'Test Table',
  maxSeats: 6,
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  seed: 'test-seed',
  defaultTimeoutMs: 1000,
};

async function createTable() {
  const res = await injectPost('/api/v1/tables', baseTable);
  return JSON.parse(res.payload).data;
}

async function addAgent(tableId: string, strategy = 'always-call') {
  const res = await injectPost(`/api/v1/tables/${tableId}/agents`, {
    name: `Bot-${strategy}`,
    adapterType: 'mock',
    strategy,
    buyIn: 1000,
  });
  return JSON.parse(res.payload).data;
}

describe('API Integration Tests', () => {
  it('api-001: POST /tables → 201 + tableId', async () => {
    const res = await injectPost('/api/v1/tables', baseTable);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data.tableId).toBeTruthy();
  });

  it('api-002: POST /tables missing blindConfig → 400', async () => {
    const res = await injectPost('/api/v1/tables', { name: 'No Blind', maxSeats: 6 });
    expect(res.statusCode).toBe(400);
  });

  it('api-003: GET /tables → 200 array', async () => {
    await createTable();
    const res = await injectGet('/api/v1/tables');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('api-004: GET /tables/:tableId → 200 full TableState', async () => {
    const table = await createTable();
    const res = await injectGet(`/api/v1/tables/${table.tableId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.tableId).toBe(table.tableId);
  });

  it('api-005: GET /tables/nonexistent → 404', async () => {
    const res = await injectGet('/api/v1/tables/no-such-table');
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
  });

  it('api-006: POST /tables/:id/agents → 200 SeatInfo', async () => {
    const table = await createTable();
    const res = await injectPost(`/api/v1/tables/${table.tableId}/agents`, {
      name: 'Bot1',
      adapterType: 'mock',
      strategy: 'random',
      buyIn: 1000,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.seatIndex).toBe(0);
    expect(body.data.ownerUserId).toBeTruthy();
    expect(body.data.adapterType).toBe('mock');
  });

  it('api-007: 2nd agent gets different seatIndex', async () => {
    const table = await createTable();
    const a1 = await addAgent(table.tableId, 'random');
    const a2 = await addAgent(table.tableId, 'random');
    expect(a1.seatIndex).not.toBe(a2.seatIndex);
  });

  it('api-008: table full → 409 TABLE_FULL', async () => {
    const res = await injectPost('/api/v1/tables', { ...baseTable, maxSeats: 2 });
    const table = JSON.parse(res.payload).data;
    await addAgent(table.tableId);
    await addAgent(table.tableId);
    const r3 = await injectPost(`/api/v1/tables/${table.tableId}/agents`, {
      name: 'B3', adapterType: 'mock', strategy: 'random', buyIn: 1000,
    });
    expect(r3.statusCode).toBe(409);
  });

  it('api-009: DELETE /tables/:id/agents/:agentId → 200', async () => {
    const table = await createTable();
    const agent = await addAgent(table.tableId);
    const res = await injectDelete(`/api/v1/tables/${table.tableId}/agents/${agent.agentId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.removed).toBe(true);
  });

  it('api-010: POST /tables/:id/hands/start 0 agents → 400', async () => {
    const table = await createTable();
    const res = await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, {});
    expect(res.statusCode).toBe(400);
  });

  it('api-011: POST /tables/:id/hands/start 2 agents → 200 HandSummary', async () => {
    const table = await createTable();
    await addAgent(table.tableId, 'always-call');
    await addAgent(table.tableId, 'always-call');
    const res = await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.handId).toBeTruthy();
    expect(body.data.communityCards).toBeDefined();
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(body.data)).not.toContain('"handEvaluation"');
  });

  it('api-012: GET /tables/:id/hands → 200 array', async () => {
    const table = await createTable();
    await addAgent(table.tableId, 'always-call');
    await addAgent(table.tableId, 'always-call');
    await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, {});
    const res = await injectGet(`/api/v1/tables/${table.tableId}/hands`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('api-013: GET /tables/:id/hands/:handId → 200 HandSummary', async () => {
    const table = await createTable();
    await addAgent(table.tableId, 'always-call');
    await addAgent(table.tableId, 'always-call');
    const handRes = await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, {});
    const handId = JSON.parse(handRes.payload).data.handId;
    const res = await injectGet(`/api/v1/tables/${table.tableId}/hands/${handId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.handId).toBe(handId);
  });

  it('api-014: GET /tables/:id/hands/:handId/replay → 200 ReplayEvent[]', async () => {
    const table = await createTable();
    await addAgent(table.tableId, 'always-call');
    await addAgent(table.tableId, 'always-call');
    const handRes = await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, {});
    const handId = JSON.parse(handRes.payload).data.handId;
    const res = await injectGet(`/api/v1/tables/${table.tableId}/hands/${handId}/replay`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((event: Record<string, unknown>) => event['eventType'] === 'hole_cards.dealt')).toBe(false);
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(body.data.some((event: Record<string, unknown>) => event['eventType'] !== 'hole_cards.dealt')).toBe(true);
  });

  it('api-015: GET /tables/:id/hands/nonexistent → 404', async () => {
    const table = await createTable();
    const res = await injectGet(`/api/v1/tables/${table.tableId}/hands/no-such-hand`);
    expect(res.statusCode).toBe(404);
  });

  it('api-016: POST /simulate 4 agents, 3 hands → 200', async () => {
    const res = await injectPost('/api/v1/simulate', {
      name: 'Sim Test',
      maxSeats: 6,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'sim-seed-api',
      defaultTimeoutMs: 1000,
      agents: [
        { name: 'B1', strategy: 'random', buyIn: 1000 },
        { name: 'B2', strategy: 'always-call', buyIn: 1000 },
        { name: 'B3', strategy: 'aggressive', buyIn: 1000 },
        { name: 'B4', strategy: 'always-fold', buyIn: 1000 },
      ],
      numHands: 3,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.hands.length).toBeGreaterThan(0);
    expect(body.data.tableId).toBeTruthy();
  });

  it('api-017: POST /simulate invalid body → 400', async () => {
    const res = await injectPost('/api/v1/simulate', { name: 'bad' });
    expect(res.statusCode).toBe(400);
  });

  it('api-018: GET /tables/:id/state no hand → 200 null', async () => {
    const table = await createTable();
    const res = await injectGet(`/api/v1/tables/${table.tableId}/state`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toBeNull();
  });

  it('api-019: DELETE /tables/:id → 200', async () => {
    const table = await createTable();
    const res = await injectDelete(`/api/v1/tables/${table.tableId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.deleted).toBe(true);
  });

  it('api-020: error format has code, message, statusCode', async () => {
    const res = await injectGet('/api/v1/tables/no-such-table');
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    expect(body.error.statusCode).toBe(404);
  });
});

describe('API Auth gating (negative)', () => {
  it('rejects unauthenticated POST /tables with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tables',
      headers: CSRF,
      payload: JSON.stringify(baseTable),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unauthenticated GET /tables with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tables' });
    expect(res.statusCode).toBe(401);
  });
});
