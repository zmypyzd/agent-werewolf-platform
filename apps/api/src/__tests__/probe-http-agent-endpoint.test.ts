import { describe, it, expect } from 'vitest';
import {
  probeHttpAgentEndpoint,
  PROBE_TIMEOUT_CEILING_MS,
  PROBE_TIMEOUT_FLOOR_MS,
} from '../services/probe-http-agent-endpoint.js';

// Helpers to build a fake fetch that returns whatever you want, while
// capturing the request the probe sent for assertion.
type CapturedRequest = { url: string; init: RequestInit; body: unknown };
function fakeFetchReturning(
  response: Response,
  captured?: CapturedRequest[],
): typeof fetch {
  return async (url, init) => {
    if (captured && init) {
      const bodyText = init.body as string;
      captured.push({
        url: typeof url === 'string' ? url : url.toString(),
        init,
        body: bodyText ? JSON.parse(bodyText) : null,
      });
    }
    return response;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_RESPONSE_BODY = {
  requestId: 'probe-X',
  agentId: 'probe-agent',
  action: { type: 'day-vote', voterId: 'p1', targetId: null },
};

describe('probeHttpAgentEndpoint', () => {
  it('POSTs a synthetic decide request and accepts a schema-valid response', async () => {
    const captured: CapturedRequest[] = [];
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 3000,
      fetchImpl: fakeFetchReturning(jsonResponse(200, VALID_RESPONSE_BODY), captured),
    });
    expect(outcome.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe('https://example.test/decide');
    expect(req.init.method).toBe('POST');
    expect((req.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    // Synthetic body shape — minimum to satisfy WerewolfDecisionRequestSchema
    const body = req.body as Record<string, unknown>;
    expect(typeof body['requestId']).toBe('string');
    expect((body['requestId'] as string).startsWith('probe-')).toBe(true);
    expect(body['phase']).toBe('day-vote');
    expect(body['validActions']).toEqual([{ type: 'day-vote', voterId: 'p1', targetId: null }]);
  });

  it('forwards the configured auth header to the probe request', async () => {
    const captured: CapturedRequest[] = [];
    await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: 'X-Custom-Auth',
      authHeaderValue: 'secret-token',
      timeoutMs: 3000,
      fetchImpl: fakeFetchReturning(jsonResponse(200, VALID_RESPONSE_BODY), captured),
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['X-Custom-Auth']).toBe('secret-token');
  });

  it('returns ENDPOINT_UNREACHABLE on a connection failure', async () => {
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 3000,
      fetchImpl: async () => {
        throw new TypeError('fetch failed: connection refused');
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ENDPOINT_UNREACHABLE');
    expect(outcome.reason).toMatch(/failed to reach endpoint/);
  });

  it('returns ENDPOINT_UNREACHABLE on HTTP non-2xx', async () => {
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 3000,
      fetchImpl: fakeFetchReturning(new Response('not found', { status: 404 })),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ENDPOINT_UNREACHABLE');
    expect(outcome.reason).toMatch(/HTTP 404/);
  });

  it('returns ENDPOINT_INVALID_RESPONSE on non-JSON body', async () => {
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 3000,
      fetchImpl: fakeFetchReturning(
        new Response('<html>oops</html>', { status: 200 }),
      ),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ENDPOINT_INVALID_RESPONSE');
    expect(outcome.reason).toMatch(/not valid JSON/);
  });

  it('returns ENDPOINT_INVALID_RESPONSE on schema mismatch', async () => {
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 3000,
      fetchImpl: fakeFetchReturning(
        jsonResponse(200, { not: 'the right shape' }),
      ),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ENDPOINT_INVALID_RESPONSE');
    expect(outcome.reason).toMatch(/schema/);
  });

  it('respects the timeout via AbortController (reports ENDPOINT_UNREACHABLE on abort)', async () => {
    const outcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      // Floor is 1000; pass below it to exercise the clamp from below.
      // The fake fetch waits for the controller's signal then throws an
      // AbortError, simulating undici's behaviour on a timed-out request.
      timeoutMs: 0,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (!signal) return reject(new Error('test fake expected an abort signal'));
          if (signal.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            return reject(err);
          }
          signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ENDPOINT_UNREACHABLE');
    expect(outcome.reason).toMatch(/did not respond within \d+ms/);
  });

  it('clamps the budget to [floor, ceiling]', async () => {
    // The clamp behavior is exercised via the error message produced
    // when a timeout fires. The reason embeds the actual budget used,
    // so we can read the clamp out of it.
    const tinyOutcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 1,
      fetchImpl: (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    });
    expect(tinyOutcome.reason).toContain(`${PROBE_TIMEOUT_FLOOR_MS}ms`);

    const hugeOutcome = await probeHttpAgentEndpoint({
      endpointUrl: 'https://example.test/decide',
      authHeaderName: null,
      authHeaderValue: null,
      timeoutMs: 999_999_999,
      fetchImpl: (_u, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    });
    expect(hugeOutcome.reason).toContain(`${PROBE_TIMEOUT_CEILING_MS}ms`);
  }, 15_000);
});
