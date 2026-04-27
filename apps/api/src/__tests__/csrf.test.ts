import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('CSRF: mutating /auth routes reject without X-Requested-With', () => {
  it.each([
    ['POST', '/api/v1/auth/register', { email: 'a@x.test', password: 'hunter22pw', displayName: 'A' }],
    ['POST', '/api/v1/auth/login', { email: 'a@x.test', password: 'hunter22pw' }],
    ['POST', '/api/v1/auth/logout', {}],
  ])('%s %s without X-Requested-With → 403 CSRF_FAILED', async (method, url, payload) => {
    const res = await app.inject({
      method: method as 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CSRF_FAILED');
  });

  it.each([
    ['POST', '/api/v1/auth/register', { email: 'a@x.test', password: 'hunter22pw', displayName: 'A' }],
    ['POST', '/api/v1/auth/login', { email: 'a@x.test', password: 'hunter22pw' }],
  ])('%s %s with X-Requested-With: fetch is not blocked by CSRF', async (method, url, payload) => {
    const res = await app.inject({
      method: method as 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('GET requests are not subject to CSRF', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
