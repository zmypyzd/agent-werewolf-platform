import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { WerewolfHttpAgentAdapter } from '../werewolf-http-agent-adapter.js';
import { TimeoutHandler } from '../timeout-handler.js';
import { werewolfFallback } from '@agent-poker/werewolf-orchestrator';

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
    if (result.delayMs) await new Promise((res) => setTimeout(res, result.delayMs));
    if (result.rawBody !== undefined) {
      return reply.status(result.status ?? 200).type('application/json').send(result.rawBody);
    }
    return reply.status(result.status ?? 200).send(result.body ?? {});
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  return { url: `http://127.0.0.1:${addr.port}/decide`, close: () => app.close(), received };
}

const baseReq: WerewolfDecisionRequest = {
  requestId: 'req-1',
  gameId: 'g-1',
  agentId: 'agent-1',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
    history: [],
    winner: null,
  },
  privateState: {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  },
  validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
  deadlineMs: 1000,
};

describe('WerewolfHttpAgentAdapter', () => {
  let stub: { url: string; close: () => Promise<void>; received: ReceivedRequest[] } | null = null;

  afterEach(async () => {
    if (stub) await stub.close();
    stub = null;
  });

  it('happy path: posts the request, returns the parsed WerewolfDecisionResponse', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    const resp: WerewolfDecisionResponse = await adapter.requestDecision(baseReq);
    expect(resp.requestId).toBe('req-1');
    expect(resp.action.type).toBe('werewolf-vote');
    expect(stub.received).toHaveLength(1);
    expect(stub.received[0]!.body).toMatchObject({ requestId: 'req-1', agentId: 'agent-1' });
  });

  it('passes structured public reasoning summaries through verbatim', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
        reasoningSummary: {
          intent: 'eliminate-suspected-seer',
          confidence: 0.7,
          keyObservations: ['p2 voted defensively last day'],
        },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    const resp = await adapter.requestDecision(baseReq);
    expect(resp.reasoningSummary?.intent).toBe('eliminate-suspected-seer');
    expect(resp.reasoningSummary?.confidence).toBe(0.7);
    expect(resp.reasoningSummary?.keyObservations).toEqual(['p2 voted defensively last day']);
  });

  it('non-2xx response throws — TimeoutHandler then converts to werewolfFallback', async () => {
    stub = await startStub(() => ({ status: 500, body: { error: 'boom' } }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/HTTP 500/);

    const wrapped = new TimeoutHandler(adapter, 1000, werewolfFallback);
    const { response, timedOut } = await wrapped.requestDecision(baseReq);
    expect(timedOut).toBe(true);
    expect(response.action).toEqual(baseReq.validActions[0]);
    expect(response.requestId).toBe('req-1');
  });

  it('malformed JSON body throws', async () => {
    stub = await startStub(() => ({ rawBody: 'not json {' }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/malformed JSON/);
  });

  it('schema-violating response throws with WerewolfDecisionResponseSchema in the message', async () => {
    stub = await startStub(() => ({ body: { foo: 'bar' } }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/WerewolfDecisionResponseSchema/);
  });

  it('hangs past timeoutMs → adapter aborts; TimeoutHandler returns fallback', async () => {
    stub = await startStub(() => ({
      delayMs: 500,
      body: {
        requestId: 'req-1', agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 50,
    });
    await expect(adapter.requestDecision(baseReq)).rejects.toThrow(/aborted/);

    const wrapped = new TimeoutHandler(adapter, 50, werewolfFallback);
    const result = await wrapped.requestDecision(baseReq);
    expect(result.timedOut).toBe(true);
  });

  it('omits the auth header when not configured (no empty header sent)', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1',
        agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
      agentId: 'agent-1', name: 'A', endpointUrl: stub.url, timeoutMs: 1000,
    });
    await adapter.requestDecision(baseReq);
    const headers = stub.received[0]!.headers;
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends the auth header when configured, and does not write the value to stdout/stderr', async () => {
    stub = await startStub(() => ({
      body: {
        requestId: 'req-1', agentId: 'agent-1',
        action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
      },
    }));
    const adapter = new WerewolfHttpAgentAdapter({
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

    expect(stub.received[0]!.headers['authorization']).toBe('Bearer DO-NOT-LEAK');
    expect(writes.join('')).not.toContain('DO-NOT-LEAK');
  });
});
