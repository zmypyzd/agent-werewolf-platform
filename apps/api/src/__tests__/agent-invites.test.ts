import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { MockAuthService } from '@agent-poker/auth';
import type { FastifyInstance } from 'fastify';

// Routes under /agents/invites were migrated to JWT auth (Tasks 10, 13b).
// Without supabaseConfig the Postgres stores are not configured, so all
// business-logic paths return 501 NOT_IMPLEMENTED.
//
// These tests verify two layers:
//   A) Auth gate  — owner-scoped routes return 401 when Authorization is absent
//   B) Config guard — with valid Bearer but no supabaseConfig, routes return 501

describe('agent-invites routes (JWT path)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildServer({
      authService: new MockAuthService('owner-1'),
      // No supabaseConfig → all Postgres-backed routes return 501 NOT_IMPLEMENTED
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── A) Auth gate ────────────────────────────────────────────────────────────
  describe('auth gate — owner-scoped routes return 401 without Authorization', () => {
    it('POST /agents/invites without Authorization → 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/invites',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'X', ttlSec: 3600 }),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('GET /agents/invites without Authorization → 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/invites',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('DELETE /agents/invites/:token without Authorization → 401', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/agents/invites/some-token',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ─── B) Config guard — auth passes, no supabaseConfig → 501 ─────────────────
  describe('config-missing fallback — authenticated requests return 501 without supabaseConfig', () => {
    const authHeader = { 'content-type': 'application/json', authorization: 'Bearer mock-token' };

    it('POST /agents/invites with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/invites',
        headers: authHeader,
        payload: JSON.stringify({ displayName: 'X', ttlSec: 3600 }),
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('GET /agents/invites with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/invites',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    it('DELETE /agents/invites/:token with Bearer token but no supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/agents/invites/some-token',
        headers: { authorization: 'Bearer mock-token' },
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });

    // The register endpoint is public (no auth guard). requireSupabaseConfig fires
    // before Zod body parsing, so even an empty-body request returns 501.
    it('POST /agents/invites/:token/register (public) without supabaseConfig → 501 NOT_IMPLEMENTED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/invites/some-token/register',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(501);
      expect(res.json().error.code).toBe('NOT_IMPLEMENTED');
    });
  });
});
