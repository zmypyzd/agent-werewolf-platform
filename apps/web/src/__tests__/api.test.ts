import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api.js';

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
});
