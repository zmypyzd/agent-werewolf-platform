import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
beforeEach(async () => {
  // 2 hits per 60s — easy to exceed in-test.
  app = buildServer({ authRateLimit: { max: 2, windowMs: 60_000 } });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('Auth rate limiter', () => {
  it('rejects the (max+1)th /auth/login with 429 + Retry-After', async () => {
    const body = JSON.stringify({ email: 'no@x.test', password: 'whatever' });
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: CSRF, payload: body });
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: CSRF, payload: body });
    const r3 = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: CSRF, payload: body });
    expect(r1.statusCode).toBe(401); // bad credentials, not rate limited
    expect(r2.statusCode).toBe(401);
    expect(r3.statusCode).toBe(429);
    expect(JSON.parse(r3.body).error.code).toBe('RATE_LIMITED');
    expect(r3.headers['retry-after']).toBeDefined();
  });

  it('also rate-limits /auth/register', async () => {
    const mk = (i: number) => JSON.stringify({
      email: `u${i}@x.test`, password: 'hunter22pw', displayName: `U${i}`,
    });
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: CSRF, payload: mk(1) });
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: CSRF, payload: mk(2) });
    const r3 = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: CSRF, payload: mk(3) });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r3.statusCode).toBe(429);
  });

  it('does not rate-limit GET /health', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'GET', url: '/health' });
      expect(r.statusCode).toBe(200);
    }
  });
});
