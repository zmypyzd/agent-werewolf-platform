import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.statusCode !== 201) throw new Error(`register ${email} failed: ${res.body}`);
  const sc = res.headers['set-cookie'];
  const sid = (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error('no apk_sid cookie');
  return sid;
}

async function createTable(sid: string) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tables', headers: CSRF,
    cookies: { apk_sid: sid },
    payload: JSON.stringify({
      name: 'A', maxSeats: 4,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'act-api', defaultTimeoutMs: 1000,
    }),
  });
  return JSON.parse(r.body).data;
}

describe('POST /tables/:tableId/actions', () => {
  it('rejects unauthenticated submit with 401', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.tableId}/actions`,
      headers: CSRF,
      payload: JSON.stringify({ handId: 'h', actionType: 'check' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects missing X-Requested-With (CSRF) with 403', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.tableId}/actions`,
      headers: { 'content-type': 'application/json' },
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ handId: 'h', actionType: 'check' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects malformed body with 400 SCHEMA_VALIDATION_FAILED', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.tableId}/actions`,
      headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ handId: 'h', actionType: 'NOPE' }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('rejects a user with no seat at the table (403 FORBIDDEN)', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.tableId}/actions`,
      headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ handId: 'h', actionType: 'check' }),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('rejects when the seat is not human (403 FORBIDDEN)', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    // Sit a mock agent — that gives the user a seat with adapterType='mock'.
    await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/agents`, headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ name: 'Bot', adapterType: 'mock', strategy: 'always-call', buyIn: 1000 }),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${t.tableId}/actions`,
      headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ handId: 'h', actionType: 'check' }),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });
});
