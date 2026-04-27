import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({ email: 'lobby@x.test', password: 'hunter22pw', displayName: 'L' }),
  });
  if (reg.statusCode !== 201) throw new Error(`register: ${reg.body}`);
  const sc = reg.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)![1]!;
});

afterEach(async () => { await app.close(); });

async function createTable(maxSeats = 4) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tables', headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify({
      name: 'L', maxSeats,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'lobby-seed', defaultTimeoutMs: 1000,
    }),
  });
  return JSON.parse(r.body).data;
}

async function listTables() {
  const r = await app.inject({ method: 'GET', url: '/api/v1/tables', cookies: { apk_sid: cookie } });
  return JSON.parse(r.body).data;
}

describe('GET /tables — TableSummary shape', () => {
  it('returns the full TableSummary shape (tableName/canSit/spectatorCount/blinds)', async () => {
    const t = await createTable();
    const list = await listTables();
    expect(list).toHaveLength(1);
    const summary = list[0];
    expect(summary.tableId).toBe(t.tableId);
    expect(summary.tableName).toBe('L');
    expect(summary.status).toBe('preparing');
    expect(summary.seatedCount).toBe(0);
    expect(summary.maxSeats).toBe(4);
    expect(summary.spectatorCount).toBe(0);
    expect(summary.blinds).toEqual({ smallBlind: 25, bigBlind: 50, ante: 0 });
    expect(summary.canSit).toBe(true);
    expect(summary.currentHandId).toBeNull();
  });

  it('canSit becomes false when the table is full', async () => {
    const t = await createTable(2);
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST', url: `/api/v1/tables/${t.tableId}/agents`, headers: CSRF,
        cookies: { apk_sid: cookie },
        payload: JSON.stringify({ name: `B${i}`, adapterType: 'mock', strategy: 'always-call', buyIn: 1000 }),
      });
    }
    const summary = (await listTables())[0];
    expect(summary.seatedCount).toBe(2);
    expect(summary.canSit).toBe(false);
  });

  it('seatedCount tracks new seats and reflects in lobby summary', async () => {
    const t = await createTable();
    const before = (await listTables())[0];
    expect(before.seatedCount).toBe(0);
    await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/agents`, headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'B1', adapterType: 'mock', strategy: 'always-call', buyIn: 1000 }),
    });
    const after = (await listTables())[0];
    expect(after.seatedCount).toBe(1);
  });
});
