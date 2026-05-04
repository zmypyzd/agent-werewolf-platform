import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AgentDecisionRequest, AgentDecisionResponse } from '@agent-poker/shared';
import { HttpAgentAdapter } from '../http-agent-adapter.js';
import { TimeoutHandler, pokerFallback } from '../timeout-handler.js';

interface ReceivedRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

async function startStub(handler: (received: ReceivedRequest) => {
  status?: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
}): Promise<{ url: string; close: () => Promise<void>; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  const app = Fastify({ logger: false });

  app.post('/decide', async (req, reply) => {
    const r: ReceivedRequest = { body: req.body, headers: req.headers };
    received.push(r);
    const result = handler(r);
    if (result.delayMs) await new Promise(res => setTimeout(res, result.delayMs));
    if (result.rawBody !== undefined) {
      return reply.status(result.status ?? 200).type('application/json').send(result.rawBody);
    }
    return reply.status(result.status ?? 200).send(result.body ?? {});
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  const url = `http://127.0.0.1:${addr.port}/decide`;
  return { url, close: () => app.close(), received };
}

const baseReq: AgentDecisionRequest = {
  requestId: 'req-1',
  handId: 'hand-1',
  tableId: 'tbl-1',
  agentId: 'agent-1',
  publicState: {
    handId: 'hand-1', tableId: 'tbl-1', phase: 'preflop',
    players: [], communityCards: [], pots: [],
    button: 0, smallBlindIndex: 0, bigBlindIndex: 1,
    currentActorIndex: 0, currentRoundMinBet: 50, minRaiseAmount: 50,
    allActions: [],
  },
  privateState: { playerId: 'player-1', holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }] },
  legalActions: [{ type: 'check' }, { type: 'call', callAmount: 50 }],
  timeoutMs: 1000,
};

describe('HttpAgentAdapter', () => {
  let stub: { url: string; close: () => Promise<void>; received: ReceivedRequest[] } | null = null;

  afterEach(async () => {
    if (stub) await stub.close();
    stub = null;
  });

  it('happy path: posts the request, returns the parsed AgentDecisionResponse', async () => {
    stub = await startStub(() => ({
      body: { requestId: 'req-1', agentId: 'agent-1', actionType: 'check' },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });

    const resp: AgentDecisionResponse = await adapter.requestDecision(baseReq);
    expect(resp.actionType).toBe('check');
    expect(resp.requestId).toBe('req-1');

    expect(stub.received).toHaveLength(1);
    expect(stub.received[0]!.body).toMatchObject({ requestId: 'req-1', agentId: 'agent-1' });
  });

  it('preserves structured public reasoning summaries from HTTP agents', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        actionType: 'check',
        reasoningSummary: {
          intent: 'pot_control',
          confidence: 0.6,
          riskLevel: 'low',
          keyObservations: ['No need to grow the pot out of position'],
          consideredActions: [
            { actionType: 'check', reason: 'Preserves showdown value' },
          ],
        },
      },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });

    const resp = await adapter.requestDecision(baseReq);
    expect(resp.reasoningSummary?.intent).toBe('pot_control');
    expect(resp.reasoningSummary?.consideredActions[0]?.reason).toBe('Preserves showdown value');
  });

  it('non-2xx response throws (TimeoutHandler then converts to fallback)', async () => {
    stub = await startStub(() => ({ status: 500, body: { error: 'boom' } }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });

    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/HTTP 500/);

    const wrapped = new TimeoutHandler(adapter, 1000, pokerFallback);
    const { response, timedOut } = await wrapped.requestDecision(baseReq);
    expect(timedOut).toBe(true);
    expect(['check', 'fold']).toContain(response.actionType);
  });

  it('malformed JSON body throws', async () => {
    stub = await startStub(() => ({ rawBody: 'not json {' }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/malformed JSON/);
  });

  it('schema-violating response throws', async () => {
    stub = await startStub(() => ({ body: { foo: 'bar' } }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/AgentDecisionResponseSchema/);
  });

  it('hangs past timeoutMs → adapter aborts; TimeoutHandler returns fallback', async () => {
    stub = await startStub(() => ({
      delayMs: 500,
      body: { requestId: 'req-1', agentId: 'agent-1', actionType: 'check' },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 50,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/aborted/);

    const wrapped = new TimeoutHandler(adapter, 50, pokerFallback);
    const result = await wrapped.requestDecision(baseReq);
    expect(result.timedOut).toBe(true);
  });

  it('sends the auth header when configured', async () => {
    stub = await startStub(() => ({
      body: { requestId: 'req-1', agentId: 'agent-1', actionType: 'check' },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url,
      authHeaderName: 'Authorization', authHeaderValue: 'Bearer SECRET-TOKEN',
      timeoutMs: 1000,
    });
    await adapter.requestDecision(baseReq);
    const headers = stub.received[0]!.headers;
    expect(headers['authorization']).toBe('Bearer SECRET-TOKEN');
  });

  it('omits the auth header when not configured (no empty header sent)', async () => {
    stub = await startStub(() => ({
      body: { requestId: 'req-1', agentId: 'agent-1', actionType: 'check' },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await adapter.requestDecision(baseReq);
    const headers = stub.received[0]!.headers;
    expect(headers['authorization']).toBeUndefined();
  });

  it('does not write the auth header value to stdout/stderr', async () => {
    stub = await startStub(() => ({
      body: { requestId: 'req-1', agentId: 'agent-1', actionType: 'check' },
    }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url,
      authHeaderName: 'Authorization', authHeaderValue: 'Bearer DO-NOT-LEAK',
      timeoutMs: 1000,
    });

    const writes: string[] = [];
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStdout(chunk as never, ...args as []);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: Uint8Array | string, ...args: unknown[]) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return origStderr(chunk as never, ...args as []);
    }) as typeof process.stderr.write;

    try {
      await adapter.requestDecision(baseReq);
    } finally {
      process.stdout.write = origStdout as typeof process.stdout.write;
      process.stderr.write = origStderr as typeof process.stderr.write;
    }

    const joined = writes.join('');
    expect(joined).not.toContain('DO-NOT-LEAK');
  });

  it('keeps throwing on errors when wrapped by TimeoutHandler — fallback contract', async () => {
    stub = await startStub(() => ({ status: 502, body: { error: 'gateway' } }));
    const adapter = new HttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    const wrapped = new TimeoutHandler(adapter, 1000, pokerFallback);
    const { response, timedOut } = await wrapped.requestDecision(baseReq);
    expect(timedOut).toBe(true);
    expect(response.requestId).toBe('req-1');
  });
});
