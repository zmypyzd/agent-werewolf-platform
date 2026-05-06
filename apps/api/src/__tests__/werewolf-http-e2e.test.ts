import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { WebSocket } from 'ws';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import {
  WerewolfHttpAgentAdapter,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import { WerewolfDecisionRequestSchema } from '@agent-poker/agent-protocol';
import { RealtimeHub } from '@agent-poker/realtime';
import type { WerewolfPlayerId } from '@agent-poker/shared';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;

interface AgentServer {
  readonly playerId: WerewolfPlayerId;
  readonly agentId: string;
  readonly url: string;
  close(): Promise<void>;
}

async function startAgentServer(
  playerId: WerewolfPlayerId,
  playerName: string,
  seedBase: string,
): Promise<AgentServer> {
  const agentId = `agent-${playerId}`;
  const worker = new WerewolfRandomMockAgent(agentId, playerName, {
    seed: `${seedBase}-${playerId}`,
  });
  const a = Fastify({ logger: false });
  a.post('/decide', async (req, reply) => {
    const parsed = WerewolfDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const response = await worker.requestDecision(
      parsed.data as unknown as Parameters<typeof worker.requestDecision>[0],
    );
    return reply.send(response);
  });
  await a.listen({ host: '127.0.0.1', port: 0 });
  const addr = a.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  return {
    playerId,
    agentId,
    url: `http://127.0.0.1:${addr.port}/decide`,
    close: () => a.close(),
  };
}

beforeEach(async () => {
  hub = new RealtimeHub();
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  attachment = attachWerewolfHub(orch, hub);

  app = buildServer({
    hub,
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
    werewolfHubAttachment: attachment,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

async function registerAs(email: string): Promise<{ sid: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST', headers: CSRF,
    body: JSON.stringify({ email, password: 'hunter22pw', displayName: email }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${await res.text()}`);
  const sid = /apk_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: `apk_sid=${sid}` } });
  const meBody = await me.json() as { data: { user: { userId: string } } };
  return { sid, userId: meBody.data.user.userId };
}

function connectWs(sid: string): Promise<{ ws: WebSocket; messages: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, { headers: { cookie: `apk_sid=${sid}` } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function awaitMessage(
  messages: Array<Record<string, unknown>>,
  predicate: (m: Record<string, unknown>) => boolean,
  timeoutMs = 15_000,
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('awaitMessage timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('werewolf E2E over real HTTP adapters', () => {
  it('orchestrator drives 9 HTTP-mediated mock agents; WS public stream and persisted artifact stay consistent and private fields stay redacted', async () => {
    const spectator = await registerAs('spec-w-http@x.test');
    const player1 = await registerAs('p1-w-http@x.test');

    const specClient = await connectWs(spectator.sid);
    const playerClient = await connectWs(player1.sid);

    const gameId = 'g-http-e2e';
    const matchTopic = `match:${gameId}`;
    const player1Topic = `player:${player1.userId}:${gameId}`;

    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'subscribe', payload: {} }));
    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'ping', payload: {} }));
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'pong');

    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'subscribe', payload: {} }));
    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'ping', payload: {} }));
    await awaitMessage(playerClient.messages, (m) => m['topic'] === player1Topic && m['type'] === 'pong');

    // Build the match.
    const { matchId, initialState } = orch.createMatch({
      gameId, seed: 'seed-http-e2e', defaultTimeoutMs: 5_000,
    });

    // Stand up 9 in-process agent servers and register HTTP adapters.
    const servers: AgentServer[] = [];
    try {
      for (const p of initialState.players) {
        const server = await startAgentServer(p.id, p.name, 'seed-http-e2e');
        servers.push(server);
        orch.registerAgent(
          matchId,
          p.id,
          new WerewolfHttpAgentAdapter({
            agentId: server.agentId,
            name: p.name,
            endpointUrl: server.url,
            timeoutMs: 5_000,
          }),
        );
      }

      // Map every player to player1.userId so player1's WS topic receives
      // every private-state emission regardless of role. Spectator must
      // still never see them — that is the cross-leak assertion.
      attachment.attachMatch(
        matchId,
        initialState.players.map((p) => ({ playerId: p.id, userId: player1.userId })),
      );

      await orch.runMatch(matchId);
      await awaitMessage(
        specClient.messages,
        (m) => m['topic'] === matchTopic && m['type'] === 'match.completed',
      );

      // 1. WS public stream observed events; sequence is monotonic; no actor
      //    identity in night-phase action frames.
      const liveEvents = specClient.messages
        .filter((m) => m['topic'] === matchTopic && m['type'] !== 'pong')
        .map((m) => ({
          type: m['type'] as string,
          payload: m['payload'] as Record<string, unknown>,
          sequence: ((m['payload'] as Record<string, unknown>)['sequence'] as number) ?? -1,
        }));
      expect(liveEvents.length).toBeGreaterThan(0);
      expect(liveEvents.every((e) => e.sequence >= 0)).toBe(true);
      for (let i = 1; i < liveEvents.length; i++) {
        expect(liveEvents[i]!.sequence).toBeGreaterThanOrEqual(liveEvents[i - 1]!.sequence);
      }
      const nightActionFrames = liveEvents.filter(
        (e) =>
          ['agent.action_requested', 'agent.action_received'].includes(e.type) &&
          ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.payload['phase'] as string),
      );
      expect(nightActionFrames.length).toBeGreaterThan(0);
      for (const f of nightActionFrames) {
        expect(f.payload['playerId']).toBeUndefined();
        expect(f.payload['agentId']).toBeUndefined();
      }

      // 2. The owning player saw private-state frames; spectator never did.
      const playerPrivate = playerClient.messages.filter(
        (m) => m['topic'] === player1Topic && m['type'] === 'werewolf.private_state',
      );
      expect(playerPrivate.length).toBeGreaterThan(0);
      expect(specClient.messages.filter((m) => m['topic'] === player1Topic).length).toBe(0);

      // 3. Persisted artifact replay matches the public WS frame count and
      //    carries no seed on match.started.
      const replayRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/replay`);
      expect(replayRes.status).toBe(200);
      const replayBody = await replayRes.json() as {
        data: Array<{ eventType: string; sequence: number; data: Record<string, unknown> }>;
      };
      expect(replayBody.data.length).toBe(liveEvents.length);
      expect(
        replayBody.data.find((e) => e.eventType === 'match.started')?.data['seed'],
      ).toBeUndefined();

      // 4. Persisted decision-trace strips privateStateHash + reasoningSummary.
      const traceRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/decision-trace`);
      expect(traceRes.status).toBe(200);
      const traceText = await traceRes.text();
      const traceData = JSON.parse(traceText) as { data: unknown[] };
      expect(traceData.data.length).toBeGreaterThan(0);
      expect(traceText).not.toContain('privateStateHash');
      expect(traceText).not.toContain('reasoningSummary');

      // 5. The match summary at /werewolf-matches/:id strips seed and files block.
      const summaryRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}`);
      expect(summaryRes.status).toBe(200);
      const summaryBody = await summaryRes.json() as {
        data: { manifest: Record<string, unknown>; summary: Record<string, unknown> };
      };
      expect(summaryBody.data.manifest['files']).toBeUndefined();
      expect(summaryBody.data.summary['seed']).toBeUndefined();
    } finally {
      await Promise.all(servers.map((s) => s.close()));
      specClient.ws.close();
      playerClient.ws.close();
    }
  }, 30_000);
});
