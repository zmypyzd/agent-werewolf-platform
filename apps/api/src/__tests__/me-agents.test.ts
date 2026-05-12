import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { MockAuthService } from '@agent-poker/auth';
import type { FastifyInstance } from 'fastify';

// Routes under /me/agents were migrated to JWT auth (Tasks 11, 13b).
// Without supabaseConfig the PostgresAgentStore is not configured, so all
// business-logic paths return 501 NOT_IMPLEMENTED.
//
// These tests verify two layers:
//   A) Auth gate  — all /me/agents routes return 401 when Authorization is absent
//   B) Config guard — with valid Bearer but no supabaseConfig, routes return 501

describe('me-agents routes (JWT path)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildServer({
      authService: new MockAuthService('user-1'),
      // No supabaseConfig → all Postgres-backed routes return 501 NOT_IMPLEMENTED
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── A) Auth gate ────────────────────────────────────────────────────────────
  describe('auth gate — all /me/agents routes return 401 without Authorization', () => {
    it('GET /me/agents without Authorization → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me/agents' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('POST /me/agents without Authorization → 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/agents',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ agentName: 'Bot', endpointUrl: 'https://example.com/decide' }),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('GET /me/agents/:id without Authorization → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me/agents/cfg-x' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('PATCH /me/agents/:id without Authorization → 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/agents/cfg-x',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ agentName: 'Renamed' }),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('DELETE /me/agents/:id without Authorization → 401', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/v1/me/agents/cfg-x' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ─── B) Config guard — auth passes, no supabaseConfig → 501 ─────────────────
  describe('config-missing fallback — authenticated requests return 501 without supabaseConfig', () => {
    const authHeader = { 'content-type': 'application/json', authorization: 'Bearer mock-token' };

    it('GET /me/agents with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/agents',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('POST /me/agents with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      // Auth check runs first (preHandler), then requireSupabaseConfig fires before
      // Zod body validation, so even a minimal valid body yields 501.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/agents',
        headers: authHeader,
        payload: JSON.stringify({
          agentName: 'Bot',
          endpointUrl: 'https://example.com/decide',
          timeoutMs: 5000,
        }),
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('GET /me/agents/:id with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/agents/cfg-x',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('PATCH /me/agents/:id with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      // Auth check first, then requireSupabaseConfig, then Zod — 501 before body parsed.
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/agents/cfg-x',
        headers: authHeader,
        payload: JSON.stringify({ agentName: 'Renamed' }),
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('DELETE /me/agents/:id with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/agents/cfg-x',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });
  });

  // ─── C) Cache-Control: no-store on every /me/agents response ─────────────
  // Parallels PR #35 (me-werewolf-agents GET no-store). The agent inventory
  // returned by /me/agents is per-user personal data (names, endpoints,
  // hasAuthHeader booleans). Even on auth-failure or config-missing error
  // responses, a shared cache or browser bfcache could cross-leak inventory
  // between sessions on the same device. An `onSend` hook (rather than
  // per-handler `.header(...)`) ensures the defense applies uniformly
  // across success + error paths.
  describe('Cache-Control: no-store on every response (PR #35 parallel)', () => {
    it('401 response on missing auth carries Cache-Control: no-store + Pragma: no-cache', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me/agents' });
      expect(res.statusCode).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('501 response on missing supabaseConfig carries Cache-Control: no-store + Pragma: no-cache', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/agents',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });

    it('POST 501 response also carries the headers (covers the credential-bearing path)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/agents',
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock-token' },
        payload: JSON.stringify({
          agentName: 'Bot',
          endpointUrl: 'https://example.com/decide',
          timeoutMs: 5000,
        }),
      });
      expect(res.statusCode).toBe(501);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
    });
  });
});
