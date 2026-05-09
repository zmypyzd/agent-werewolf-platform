import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockAuthService } from '@agent-poker/auth';
import { buildServer } from '../server.js';

// ─── Cookie-session CSRF audit ────────────────────────────────────────────────
// Routes that still use cookie-based requireAuth (Tasks 7-9 untouched paths).
// An authenticated request WITHOUT the X-Requested-With header must return 403
// CSRF_FAILED. An unauthenticated request (no cookie) must return 401.
// ─────────────────────────────────────────────────────────────────────────────

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let cookieApp: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  cookieApp = buildServer();
  await cookieApp.ready();
  // Pre-register a user so the audit's "auth ok but CSRF missing" branch can
  // actually reach the CSRF check.
  const r = await cookieApp.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({ email: 'audit@x.test', password: 'hunter22pw', displayName: 'A' }),
  });
  if (r.statusCode !== 201) throw new Error(`audit register failed: ${r.body}`);
  const sc = r.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc.join(';') : sc ?? '').match(/apk_sid=([^;]+)/)![1]!;
});

afterEach(async () => { await cookieApp.close(); });

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface CookieRouteCase {
  method: Method;
  url: string;
  // Open auth routes (register/login) and idempotent logout don't return 401
  // on a missing cookie — they're either pre-auth or auth-tolerant. They MUST
  // still enforce CSRF.
  authOptional?: boolean;
}

const COOKIE_ROUTES: CookieRouteCase[] = [
  // /auth — register, login, logout don't require an existing session.
  { method: 'POST', url: '/api/v1/auth/register', authOptional: true },
  { method: 'POST', url: '/api/v1/auth/login', authOptional: true },
  { method: 'POST', url: '/api/v1/auth/logout', authOptional: true },

  // /tables — still on cookie auth
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

  // /simulate — still on cookie auth
  { method: 'POST', url: '/api/v1/simulate' },
];

describe('Route audit — cookie+CSRF coverage on unmigrated routes', () => {
  for (const route of COOKIE_ROUTES) {
    it(`${route.method} ${route.url}: authed request without X-Requested-With → 403 CSRF_FAILED`, async () => {
      const r = await cookieApp.inject({
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
        const r = await cookieApp.inject({
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

// ─── JWT-auth audit ───────────────────────────────────────────────────────────
// Routes migrated to requireJwtAuth (Tasks 10-11: agent-invites, me-agents).
// These routes ignore cookies and CSRF headers entirely. They authenticate via
// Authorization: Bearer <jwt>. Without the header → 401. With a valid Bearer
// token (any string accepted by MockAuthService) → passes auth guard.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'usr-audit-test';
const MOCK_TOKEN = 'mock-jwt-token-for-audit';

interface JwtRouteCase {
  method: Method;
  url: string;
  // When true, the route is fully public (no auth guard at all — e.g. the
  // invite registration endpoint). Expect 401-exempt even without Bearer.
  public?: boolean;
}

// Routes migrated to JWT auth in Tasks 10-11.
// POST /agents/invites/:token/register is intentionally public (no guard).
const JWT_ROUTES: JwtRouteCase[] = [
  // agent-invites — owner-authenticated
  { method: 'POST', url: '/api/v1/agents/invites' },
  { method: 'GET',  url: '/api/v1/agents/invites' },
  { method: 'DELETE', url: '/api/v1/agents/invites/inv-x' },

  // agent-invites — public registration endpoint (no auth required)
  { method: 'POST', url: '/api/v1/agents/invites/inv-x/register', public: true },

  // me-agents — owner-authenticated
  { method: 'GET',    url: '/api/v1/me/agents' },
  { method: 'POST',   url: '/api/v1/me/agents' },
  { method: 'GET',    url: '/api/v1/me/agents/cfg-x' },
  { method: 'PATCH',  url: '/api/v1/me/agents/cfg-x' },
  { method: 'DELETE', url: '/api/v1/me/agents/cfg-x' },
];

let jwtApp: FastifyInstance;

beforeEach(async () => {
  jwtApp = buildServer({ authService: new MockAuthService(TEST_USER_ID) });
  await jwtApp.ready();
});

afterEach(async () => { await jwtApp.close(); });

describe('Route audit — JWT-migrated routes (Tasks 10-11)', () => {
  // Section A: owner-authenticated routes return 401 when no Bearer token is present
  for (const route of JWT_ROUTES.filter(r => !r.public)) {
    it(`${route.method} ${route.url}: no Authorization header → 401 UNAUTHENTICATED`, async () => {
      const r = await jwtApp.inject({
        method: route.method,
        url: route.url,
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(r.statusCode).toBe(401);
      expect(JSON.parse(r.body).error.code).toBe('UNAUTHENTICATED');
    });

    it(`${route.method} ${route.url}: with Authorization: Bearer <token> → auth guard passes (not 401)`, async () => {
      const r = await jwtApp.inject({
        method: route.method,
        url: route.url,
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${MOCK_TOKEN}`,
        },
        payload: '{}',
      });
      // The auth guard passed — we get something other than 401 UNAUTHENTICATED.
      // The exact status depends on route logic (likely 501 NOT_IMPLEMENTED when
      // supabaseConfig is absent, or 404/400 on invalid params). We only verify
      // the auth decorator did not block the request.
      expect(r.statusCode).not.toBe(401);
      const body = JSON.parse(r.body);
      if (body.error) {
        expect(body.error.code).not.toBe('UNAUTHENTICATED');
      }
    });
  }

  // Section B: public endpoint — no auth guard, accessible without any header
  for (const route of JWT_ROUTES.filter(r => r.public)) {
    it(`${route.method} ${route.url}: public endpoint — no auth required (not 401)`, async () => {
      const r = await jwtApp.inject({
        method: route.method,
        url: route.url,
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
      // Public route: no auth guard, so not 401. Likely 501 (no supabaseConfig).
      expect(r.statusCode).not.toBe(401);
      const body = JSON.parse(r.body);
      if (body.error) {
        expect(body.error.code).not.toBe('UNAUTHENTICATED');
      }
    });
  }
});
