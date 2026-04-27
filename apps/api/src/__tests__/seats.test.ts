import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});
afterEach(async () => { await app.close(); });

async function registerAs(email: string): Promise<string> {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/auth/register', headers: CSRF,
    payload: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (r.statusCode !== 201) throw new Error(`register failed: ${r.body}`);
  const sc = r.headers['set-cookie'];
  return (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)![1]!;
}

async function createTable(sid: string, maxSeats = 4) {
  const r = await app.inject({
    method: 'POST', url: '/api/v1/tables', headers: CSRF,
    cookies: { apk_sid: sid },
    payload: JSON.stringify({
      name: 'S', maxSeats,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'seat-seed', defaultTimeoutMs: 1000,
    }),
  });
  return JSON.parse(r.body).data;
}

describe('POST /tables/:id/seats (sit as human)', () => {
  it('sits the user as a human player at the requested seat', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const r = await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ seatIndex: 2, buyIn: 1000 }),
    });
    expect(r.statusCode).toBe(201);
    const seat = JSON.parse(r.body).data;
    expect(seat.seatIndex).toBe(2);
    expect(seat.adapterType).toBe('human');
    expect(seat.stack).toBe(1000);
  });

  it('rejects sitting twice at the same table (FORBIDDEN — single human seat per user)', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ seatIndex: 0, buyIn: 1000 }),
    });
    const r = await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ seatIndex: 1, buyIn: 1000 }),
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects sitting at a seat already taken (SEAT_TAKEN)', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const bobSid = await registerAs('bob@x.test');
    const t = await createTable(aliceSid);
    await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: aliceSid },
      payload: JSON.stringify({ seatIndex: 0, buyIn: 1000 }),
    });
    const r = await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: bobSid },
      payload: JSON.stringify({ seatIndex: 0, buyIn: 1000 }),
    });
    expect(r.statusCode).toBe(409);
    expect(JSON.parse(r.body).error.code).toBe('SEAT_TAKEN');
  });
});

describe('DELETE /tables/:id/seats/me (leave seat)', () => {
  it('frees the seat immediately when the table is preparing', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/seats`, headers: CSRF,
      cookies: { apk_sid: sid },
      payload: JSON.stringify({ seatIndex: 1, buyIn: 1000 }),
    });
    const r = await app.inject({
      method: 'DELETE', url: `/api/v1/tables/${t.tableId}/seats/me`, headers: CSRF,
      cookies: { apk_sid: sid },
    });
    expect(r.statusCode).toBe(204);
    const fresh = await app.inject({
      method: 'GET', url: `/api/v1/tables/${t.tableId}`, cookies: { apk_sid: sid },
    });
    const data = JSON.parse(fresh.body).data;
    expect(data.seats[1]).toBeNull();
  });

  it('returns 404 when the user has no seat at the table', async () => {
    const sid = await registerAs('alice@x.test');
    const t = await createTable(sid);
    const r = await app.inject({
      method: 'DELETE', url: `/api/v1/tables/${t.tableId}/seats/me`, headers: CSRF,
      cookies: { apk_sid: sid },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST/DELETE /tables/:id/watch (spectator)', () => {
  it('watch + unwatch update spectator count', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const bobSid = await registerAs('bob@x.test');
    const t = await createTable(aliceSid);

    const watch = await app.inject({
      method: 'POST', url: `/api/v1/tables/${t.tableId}/watch`, headers: CSRF,
      cookies: { apk_sid: bobSid },
    });
    expect(watch.statusCode).toBe(204);

    const list1 = await app.inject({ method: 'GET', url: '/api/v1/tables', cookies: { apk_sid: aliceSid } });
    expect(JSON.parse(list1.body).data[0].spectatorCount).toBe(1);

    const unwatch = await app.inject({
      method: 'DELETE', url: `/api/v1/tables/${t.tableId}/watch`, headers: CSRF,
      cookies: { apk_sid: bobSid },
    });
    expect(unwatch.statusCode).toBe(204);

    const list2 = await app.inject({ method: 'GET', url: '/api/v1/tables', cookies: { apk_sid: aliceSid } });
    expect(JSON.parse(list2.body).data[0].spectatorCount).toBe(0);
  });
});
