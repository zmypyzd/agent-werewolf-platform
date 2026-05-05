import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { RealtimeHub } from '@agent-poker/realtime';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let baseUrl: string;
let wsBaseUrl: string;
let hub: RealtimeHub;
let orch: WerewolfOrchestrator;
let attachment: WerewolfHubAttachment;
let artifactStore: MemoryWerewolfMatchArtifactStore;

beforeEach(async () => {
  hub = new RealtimeHub();
  artifactStore = new MemoryWerewolfMatchArtifactStore();
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

function awaitMessage(messages: Array<Record<string, unknown>>, predicate: (m: Record<string, unknown>) => boolean, timeoutMs = 8000) {
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

describe('werewolf E2E: live WS + persisted artifact match', () => {
  it('a spectator and an owning player both observe the match; persisted artifact is consistent and private fields stripped', async () => {
    const spectator = await registerAs('spec-werewolf@x.test');
    const player1 = await registerAs('player1-werewolf@x.test');

    const specClient = await connectWs(spectator.sid);
    const playerClient = await connectWs(player1.sid);

    const gameId = 'g-e2e';
    const matchTopic = `match:${gameId}`;
    const player1Topic = `player:${player1.userId}:${gameId}`;

    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'subscribe', payload: {} }));
    specClient.ws.send(JSON.stringify({ topic: matchTopic, type: 'ping', payload: {} }));
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'pong');

    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'subscribe', payload: {} }));
    playerClient.ws.send(JSON.stringify({ topic: player1Topic, type: 'ping', payload: {} }));
    await awaitMessage(playerClient.messages, (m) => m['topic'] === player1Topic && m['type'] === 'pong');

    // Build the match.
    const { matchId, initialState } = orch.createMatch({ gameId, seed: 'seed-e2e' });
    for (const p of initialState.players) {
      orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
    }
    // Map every player to player1.userId so player1's WS topic receives every
    // private-state emission regardless of which role acts. The cross-leak
    // assertion below still verifies the spectator never sees these frames.
    attachment.attachMatch(
      matchId,
      initialState.players.map((p) => ({ playerId: p.id, userId: player1.userId })),
    );

    await orch.runMatch(matchId);
    await awaitMessage(specClient.messages, (m) => m['topic'] === matchTopic && m['type'] === 'match.completed');

    // Live WS observed events: count the public replay events the spectator saw.
    const liveEventTypes: Array<{ type: string; sequence: number }> = specClient.messages
      .filter((m) => m['topic'] === matchTopic && m['type'] !== 'pong')
      .map((m) => ({
        type: m['type'] as string,
        sequence: ((m['payload'] as Record<string, unknown>)['sequence'] as number) ?? -1,
      }));
    expect(liveEventTypes.length).toBeGreaterThan(0);
    // Defensive: confirm sequence extraction is producing real numbers, not the
    // `?? -1` fallback. If the wire shape changes and `sequence` moves elsewhere,
    // every entry would be -1 and the monotonicity loop would pass vacuously.
    expect(liveEventTypes.every((e) => e.sequence >= 0)).toBe(true);
    // Sequence must be monotonically non-decreasing.
    for (let i = 1; i < liveEventTypes.length; i++) {
      expect(liveEventTypes[i]!.sequence).toBeGreaterThanOrEqual(liveEventTypes[i - 1]!.sequence);
    }

    // The owning player saw at least one private-state frame, and only on their own topic.
    const playerPrivate = playerClient.messages.filter(
      (m) => m['topic'] === player1Topic && m['type'] === 'werewolf.private_state',
    );
    expect(playerPrivate.length).toBeGreaterThan(0);
    expect(specClient.messages.filter((m) => m['topic'] === player1Topic).length).toBe(0);

    // Persisted artifact reachable through HTTP.
    const replayRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/replay`);
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json() as { data: Array<{ eventType: string; sequence: number; data: Record<string, unknown> }> };
    expect(replayBody.data.length).toBe(liveEventTypes.length);
    // Persisted match.started carries no seed.
    expect(replayBody.data.find((e) => e.eventType === 'match.started')?.data['seed']).toBeUndefined();

    const traceRes = await fetch(`${baseUrl}/api/v1/werewolf-matches/${gameId}/decision-trace`);
    expect(traceRes.status).toBe(200);
    const traceBody = await traceRes.text();
    const traceData = JSON.parse(traceBody) as { data: unknown[] };
    expect(traceData.data.length).toBeGreaterThan(0);
    expect(traceBody).not.toContain('privateStateHash');
    expect(traceBody).not.toContain('reasoningSummary');

    specClient.ws.close();
    playerClient.ws.close();
  }, 20_000);
});
