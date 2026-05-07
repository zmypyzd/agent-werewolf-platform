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
    method: 'POST', url: '/api/v1/auth/register', headers: CSRF,
    payload: JSON.stringify({ email: 'agents@x.test', password: 'hunter22pw', displayName: 'A' }),
  });
  cookie = (Array.isArray(reg.headers['set-cookie']) ? reg.headers['set-cookie'].join(';') : reg.headers['set-cookie'] ?? '').match(/apk_sid=([^;]+)/)![1]!;
});
afterEach(async () => { await app.close(); });

const baseConfig = {
  agentName: 'MyBot',
  endpointUrl: 'https://example.test/agent',
  authHeaderName: 'Authorization',
  authHeaderValue: 'Bearer secret-do-not-leak',
  timeoutMs: 4000,
  description: 'a bot',
};

async function create(body: unknown = baseConfig) {
  return app.inject({
    method: 'POST', url: '/api/v1/me/agents', headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify(body),
  });
}

describe('User agent CRUD', () => {
  it('creates + lists + reads an agent config (auth header value never returned)', async () => {
    const c = await create();
    expect(c.statusCode).toBe(201);
    const created = JSON.parse(c.body).data;
    expect(created.hasAuthHeader).toBe(true);
    expect(JSON.stringify(created)).not.toContain('secret-do-not-leak');

    const list = await app.inject({ method: 'GET', url: '/api/v1/me/agents', cookies: { apk_sid: cookie } });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('secret-do-not-leak');

    const get = await app.inject({
      method: 'GET', url: `/api/v1/me/agents/${created.agentConfigId}`, cookies: { apk_sid: cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.stringify(get.body)).not.toContain('secret-do-not-leak');
  });

  it('PATCH updates a partial subset and never echoes the auth header value', async () => {
    const c = await create();
    const id = JSON.parse(c.body).data.agentConfigId;
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/me/agents/${id}`, headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ agentName: 'Renamed', timeoutMs: 1234 }),
    });
    expect(patch.statusCode).toBe(200);
    const data = JSON.parse(patch.body).data;
    expect(data.agentName).toBe('Renamed');
    expect(data.timeoutMs).toBe(1234);
    expect(JSON.stringify(data)).not.toContain('secret-do-not-leak');
  });

  it('rejects an http:// non-localhost endpoint with 400', async () => {
    const r = await create({ ...baseConfig, endpointUrl: 'http://example.test/agent' });
    expect(r.statusCode).toBe(400);
  });

  it('accepts http://localhost endpoints (dev convenience)', async () => {
    const r = await create({ ...baseConfig, endpointUrl: 'http://localhost:9999/agent' });
    expect(r.statusCode).toBe(201);
  });

  it('accepts timeoutMs at the new 60s ceiling for slow LLM-backed agents', async () => {
    const r = await create({ ...baseConfig, timeoutMs: 60000 });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).data.timeoutMs).toBe(60000);
  });

  it('rejects timeoutMs above the 60s ceiling', async () => {
    const r = await create({ ...baseConfig, timeoutMs: 60001 });
    expect(r.statusCode).toBe(400);
  });

  it('DELETE removes the config', async () => {
    const c = await create();
    const id = JSON.parse(c.body).data.agentConfigId;
    const del = await app.inject({
      method: 'DELETE', url: `/api/v1/me/agents/${id}`, headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: 'GET', url: `/api/v1/me/agents/${id}`, cookies: { apk_sid: cookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it('cannot read another user\'s agent config (404)', async () => {
    const c = await create();
    const id = JSON.parse(c.body).data.agentConfigId;
    // Switch user
    const reg = await app.inject({
      method: 'POST', url: '/api/v1/auth/register', headers: CSRF,
      payload: JSON.stringify({ email: 'other@x.test', password: 'hunter22pw', displayName: 'O' }),
    });
    const otherSid = (Array.isArray(reg.headers['set-cookie']) ? reg.headers['set-cookie'].join(';') : reg.headers['set-cookie'] ?? '').match(/apk_sid=([^;]+)/)![1]!;
    const get = await app.inject({
      method: 'GET', url: `/api/v1/me/agents/${id}`, cookies: { apk_sid: otherSid },
    });
    expect(get.statusCode).toBe(404);
  });
});

describe('Sit-as-agent + AGENT_IN_USE', () => {
  it('seats a user agent at a table; subsequent DELETE is blocked with AGENT_IN_USE', async () => {
    // Need a real local agent endpoint? No — for this test we use http://localhost which the schema accepts.
    // We never actually call it because we don't start a hand.
    const created = await create({
      agentName: 'B', endpointUrl: 'http://localhost:1/decide',
      authHeaderName: null, authHeaderValue: null,
      timeoutMs: 1000, description: null,
    });
    const cfg = JSON.parse(created.body).data;

    const tableRes = await app.inject({
      method: 'POST', url: '/api/v1/tables', headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({
        name: 'T', maxSeats: 4,
        blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
        seed: 's', defaultTimeoutMs: 1000,
      }),
    });
    const tableId = JSON.parse(tableRes.body).data.tableId;

    const sit = await app.inject({
      method: 'POST', url: `/api/v1/tables/${tableId}/seats/agent`, headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ seatIndex: 0, buyIn: 1000, agentConfigId: cfg.agentConfigId }),
    });
    expect(sit.statusCode).toBe(201);
    expect(JSON.parse(sit.body).data.adapterType).toBe('http');

    const del = await app.inject({
      method: 'DELETE', url: `/api/v1/me/agents/${cfg.agentConfigId}`, headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(del.statusCode).toBe(409);
    expect(JSON.parse(del.body).error.code).toBe('AGENT_IN_USE');
  });
});
