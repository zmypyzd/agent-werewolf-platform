import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let userCounter = 0;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function registerAs(label: string): Promise<string> {
  userCounter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({
      email: `${label}${userCounter}@x.test`,
      password: 'hunter22pw',
      displayName: label,
    }),
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const sid = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? '').match(/apk_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`register did not set apk_sid: ${res.body}`);
  return sid;
}

async function injectGet(path: string, sid: string) {
  return app.inject({
    method: 'GET',
    url: path,
    cookies: { apk_sid: sid },
  });
}

async function injectPost(path: string, sid: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: CSRF,
    cookies: { apk_sid: sid },
    payload: JSON.stringify(body),
  });
}

async function createTable(sid: string) {
  const res = await injectPost('/api/v1/tables', sid, {
    name: 'Privacy Table',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    seed: 'table-history-privacy-seed',
    defaultTimeoutMs: 1000,
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as { tableId: string };
}

async function addAgent(tableId: string, sid: string, name: string) {
  const res = await injectPost(`/api/v1/tables/${tableId}/agents`, sid, {
    name,
    adapterType: 'mock',
    strategy: 'always-call',
    buyIn: 1000,
  });
  expect(res.statusCode).toBe(200);
}

async function createCompletedHand() {
  const sid = await registerAs('alice');
  const table = await createTable(sid);
  await addAgent(table.tableId, sid, 'Caller 1');
  await addAgent(table.tableId, sid, 'Caller 2');

  const hand = await injectPost(`/api/v1/tables/${table.tableId}/hands/start`, sid, {});
  expect(hand.statusCode).toBe(200);
  const handId = JSON.parse(hand.body).data.handId as string;

  return { sid, tableId: table.tableId, handId };
}

function expectPublicHandPlayers(players: Record<string, unknown>[]) {
  expect(players.length).toBeGreaterThan(0);
  for (const player of players) {
    expect(player).not.toHaveProperty('holeCards');
    expect(player).not.toHaveProperty('handEvaluation');
    expect(player).toMatchObject({
      playerId: expect.stringMatching(/^player-/),
      agentId: expect.stringMatching(/^(agent|human|http)-/),
      seatIndex: expect.any(Number),
      stackBefore: expect.any(Number),
      stackAfter: expect.any(Number),
    });
  }
}

describe('table hand-history privacy', () => {
  it('GET /api/v1/tables/:tableId/hands returns public-safe hand summaries', async () => {
    const { sid, tableId } = await createCompletedHand();

    const res = await injectGet(`/api/v1/tables/${tableId}/hands`, sid);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(body.data)).not.toContain('"handEvaluation"');
    expect(body.data.length).toBeGreaterThan(0);
    for (const hand of body.data as { players: Record<string, unknown>[] }[]) {
      expectPublicHandPlayers(hand.players);
    }
  });

  it('GET /api/v1/tables/:tableId/hands/:handId returns a public-safe hand summary', async () => {
    const { sid, tableId, handId } = await createCompletedHand();

    const res = await injectGet(`/api/v1/tables/${tableId}/hands/${handId}`, sid);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(body.data)).not.toContain('"handEvaluation"');
    expectPublicHandPlayers(body.data.players);
  });

  it('GET /api/v1/tables/:tableId/hands/:handId returns 404 when the hand belongs to another table', async () => {
    const { sid, handId } = await createCompletedHand();
    const otherTable = await createTable(sid);

    const res = await injectGet(`/api/v1/tables/${otherTable.tableId}/hands/${handId}`, sid);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('HAND_NOT_FOUND');
  });
});

describe('table management permission', () => {
  it('GET /api/v1/tables/:tableId sets canManage for the table owner only', async () => {
    const aliceSid = await registerAs('alice');
    const bobSid = await registerAs('bob');
    const table = await createTable(aliceSid);

    const aliceResponse = await injectGet(`/api/v1/tables/${table.tableId}`, aliceSid);
    const bobResponse = await injectGet(`/api/v1/tables/${table.tableId}`, bobSid);

    expect(aliceResponse.statusCode).toBe(200);
    expect(bobResponse.statusCode).toBe(200);
    expect(JSON.parse(aliceResponse.body).data.canManage).toBe(true);
    expect(JSON.parse(bobResponse.body).data.canManage).toBe(false);
  });
});
