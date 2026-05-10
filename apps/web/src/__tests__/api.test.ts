import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import * as authLib from '../lib/auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api wrapper', () => {
  it('GET sends X-Requested-With and credentials: include, parses .data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ ok: boolean }>('/foo');
    expect(result).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/foo');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
      'X-Requested-With': 'fetch',
    });
  });

  it('POST stringifies body and sets content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'x' } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/bar', { hello: 'world' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ hello: 'world' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('204 returns undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.del('/x');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with code + statusCode on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'EMAIL_TAKEN', message: 'taken', statusCode: 409 } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await api.post('/bad');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('EMAIL_TAKEN');
      expect((e as ApiError).statusCode).toBe(409);
    }
  });

  it('falls back to a generic ApiError when the body is non-JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('plain text', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it.each(['/auth/me', '/tables', '/me-werewolf-agents'])(
    'throws ApiError without auto-signOut on 401 from %s when a Supabase session exists',
    async (path) => {
      // Regression: the old api wrapper auto-signed-out + hard-redirected
      // on any 401 when a Supabase session existed. Most legacy routes
      // are still cookie-only and legitimately 401 for Supabase users;
      // that interceptor bounced every successful login back to /login
      // because /auth/me (AuthProvider mount), /tables (LobbyPage mount),
      // and similar cookie-only routes all 401 on JWT-only users.
      const sessionStub = { access_token: 'fake-jwt', user: { id: 'u1' } } as never;
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: sessionStub },
        error: null,
      } as never);
      const signOutSpy = vi.spyOn(authLib, 'signOut').mockResolvedValue({});

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'authentication required', statusCode: 401 } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(api.get(path)).rejects.toBeInstanceOf(ApiError);
      expect(signOutSpy).not.toHaveBeenCalled();
    },
  );

  it('GET match analysis calls the analysis endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          matchId: 'match-1',
          tableId: 'tbl-1',
          generatedAt: 1_777_280_000_000,
          handCount: 1,
          agentCount: 1,
          decisionCount: 2,
          totals: {
            decisionCount: 2,
            actionCounts: { call: 2 },
            streetCounts: { preflop: { call: 2 } },
            intentCounts: {},
            riskCounts: {},
            missingReasoningCount: 2,
            timeoutCount: 0,
            invalidActionCount: 0,
            fallbackCount: 0,
            averageConfidence: null,
            averageLatencyMs: 12,
            maxLatencyMs: 18,
          },
          agents: [],
        },
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getMatchAnalysis('match-1');

    expect(result.decisionCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/matches/match-1/analysis');
  });
});
