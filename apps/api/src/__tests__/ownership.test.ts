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

describe('cross-user ownership over the API', () => {
  it('Bob cannot remove Alice\'s agent (403 FORBIDDEN)', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const bobSid = await registerAs('bob@x.test');

    const tableRes = await app.inject({
      method: 'POST', url: '/api/v1/tables', headers: CSRF,
      cookies: { apk_sid: aliceSid },
      payload: JSON.stringify({
        name: 'A', maxSeats: 4,
        blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
        seed: 'own-api', defaultTimeoutMs: 1000,
      }),
    });
    const tableId = JSON.parse(tableRes.body).data.tableId;

    const agentRes = await app.inject({
      method: 'POST', url: `/api/v1/tables/${tableId}/agents`, headers: CSRF,
      cookies: { apk_sid: aliceSid },
      payload: JSON.stringify({ name: 'AliceBot', adapterType: 'mock', strategy: 'random', buyIn: 1000 }),
    });
    const agentId = JSON.parse(agentRes.body).data.agentId;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tables/${tableId}/agents/${agentId}`,
      headers: CSRF,
      cookies: { apk_sid: bobSid },
    });
    expect(del.statusCode).toBe(403);
    expect(JSON.parse(del.body).error.code).toBe('FORBIDDEN');
  });

  it('Bob cannot delete Alice\'s table (403 FORBIDDEN)', async () => {
    const aliceSid = await registerAs('alice@x.test');
    const bobSid = await registerAs('bob@x.test');

    const tableRes = await app.inject({
      method: 'POST', url: '/api/v1/tables', headers: CSRF,
      cookies: { apk_sid: aliceSid },
      payload: JSON.stringify({
        name: 'A', maxSeats: 4,
        blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
        seed: 'own-api', defaultTimeoutMs: 1000,
      }),
    });
    const tableId = JSON.parse(tableRes.body).data.tableId;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tables/${tableId}`,
      headers: CSRF,
      cookies: { apk_sid: bobSid },
    });
    expect(del.statusCode).toBe(403);
    expect(JSON.parse(del.body).error.code).toBe('FORBIDDEN');
  });
});
