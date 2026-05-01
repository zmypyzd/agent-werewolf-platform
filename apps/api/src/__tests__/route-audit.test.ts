import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  // Pre-register a user so the audit's "auth ok but CSRF missing" branch can
  // actually reach the CSRF check.
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({ email: 'audit@x.test', password: 'hunter22pw', displayName: 'A' }),
  });
  if (r.statusCode !== 201) throw new Error(`audit register failed: ${r.body}`);
  const sc = r.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)![1]!;
});

afterEach(async () => { await app.close(); });

type Method = 'POST' | 'PATCH' | 'DELETE';

interface RouteCase {
  method: Method;
  url: string;
  // Open auth routes (register/login) and idempotent logout don't return 401
  // on a missing cookie — they're either pre-auth or auth-tolerant. They MUST
  // still enforce CSRF.
  authOptional?: boolean;
}

const ROUTES: RouteCase[] = [
  // /auth — register, login, logout don't require an existing session.
  { method: 'POST', url: '/api/v1/auth/register', authOptional: true },
  { method: 'POST', url: '/api/v1/auth/login', authOptional: true },
  { method: 'POST', url: '/api/v1/auth/logout', authOptional: true },

  // /tables
  { method: 'POST', url: '/api/v1/tables' },
  { method: 'DELETE', url: '/api/v1/tables/tbl-x' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/agents' },
  { method: 'DELETE', url: '/api/v1/tables/tbl-x/agents/a-x' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/hands/start' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/actions' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/watch' },
  { method: 'DELETE', url: '/api/v1/tables/tbl-x/watch' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/seats' },
  { method: 'DELETE', url: '/api/v1/tables/tbl-x/seats/me' },
  { method: 'POST', url: '/api/v1/tables/tbl-x/seats/agent' },

  // /me/agents
  { method: 'POST', url: '/api/v1/me/agents' },
  { method: 'PATCH', url: '/api/v1/me/agents/cfg-x' },
  { method: 'DELETE', url: '/api/v1/me/agents/cfg-x' },

  // /agents/invites — register is token-authenticated and intentionally public.
  { method: 'POST', url: '/api/v1/agents/invites' },
  { method: 'DELETE', url: '/api/v1/agents/invites/inv-x' },

  // /simulate
  { method: 'POST', url: '/api/v1/simulate' },
];

describe('Route audit — auth + CSRF coverage on every mutating /api/v1 route', () => {
  for (const route of ROUTES) {
    it(`${route.method} ${route.url}: authed request without X-Requested-With → 403 CSRF_FAILED`, async () => {
      const r = await app.inject({
        method: route.method,
        url: route.url,
        headers: { 'content-type': 'application/json' },
        cookies: { apk_sid: cookie },
        payload: '{}',
      });
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.body).error.code).toBe('CSRF_FAILED');
    });

    if (!route.authOptional) {
      it(`${route.method} ${route.url}: unauthenticated request → 401 UNAUTHENTICATED`, async () => {
        const r = await app.inject({
          method: route.method,
          url: route.url,
          headers: CSRF,
          payload: '{}',
        });
        expect(r.statusCode).toBe(401);
        expect(JSON.parse(r.body).error.code).toBe('UNAUTHENTICATED');
      });
    }
  }
});
