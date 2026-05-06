import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
  type IWerewolfMatchArtifactStore,
  type WerewolfMatchArtifactIndexEntry,
} from '@agent-poker/persistence';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { AppError } from '@agent-poker/shared';
import { werewolfMatchesRoutes } from '../routes/werewolf-matches.js';

let app: FastifyInstance;
let artifactStore: MemoryWerewolfMatchArtifactStore;
let traceStore: MemoryWerewolfDecisionTraceStore;
let orch: WerewolfOrchestrator;

beforeEach(async () => {
  artifactStore = new MemoryWerewolfMatchArtifactStore();
  traceStore = new MemoryWerewolfDecisionTraceStore();
  orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      reply.status(error.code === 'MATCH_NOT_FOUND' ? 404 : 500).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  });
  await app.register(werewolfMatchesRoutes, {
    prefix: '/api/v1',
    werewolfMatchArtifactStore: artifactStore,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function runMatch(gameId: string): Promise<void> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed: `seed-${gameId}` });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  await orch.runMatch(matchId);
}

describe('werewolf match artifact routes', () => {
  it('GET /api/v1/werewolf-matches is public and starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);
  });

  it('GET /api/v1/werewolf-matches lists a completed match without seed', async () => {
    await runMatch('g-list');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.map((e: { matchId: string }) => e.matchId)).toContain('g-list');
    for (const entry of body.data) {
      expect(entry).not.toHaveProperty('seed');
    }
  });

  it('strips seed from index entries even if a future widening surfaces one', async () => {
    // Defense-in-depth: WerewolfMatchArtifactIndexEntry intentionally omits
    // `seed` today. If a future PR ever widens the type to include one (or any
    // other private field appears via ducktyping), the route must still drop
    // it before the response. We simulate that future state by wrapping the
    // store with a `listMatchArtifacts` that injects a phantom `seed`, and
    // assert the route never relays it.
    const baseStore = new MemoryWerewolfMatchArtifactStore();
    const baseTraceStore = new MemoryWerewolfDecisionTraceStore();
    const baseOrch = new WerewolfOrchestrator({
      artifactStore: baseStore,
      decisionTraceStore: baseTraceStore,
    });
    const { matchId, initialState } = baseOrch.createMatch({
      gameId: 'g-defense-in-depth',
      seed: 'seed-defense',
    });
    for (const p of initialState.players) {
      baseOrch.registerAgent(
        matchId,
        p.id,
        new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }),
      );
    }
    await baseOrch.runMatch(matchId);

    const widenedStore: IWerewolfMatchArtifactStore = {
      saveMatchArtifact: (input) => baseStore.saveMatchArtifact(input),
      getMatchArtifact: (id, options) => baseStore.getMatchArtifact(id, options),
      async listMatchArtifacts() {
        const entries = await baseStore.listMatchArtifacts();
        return entries.map(
          (e) =>
            ({ ...e, seed: 'leaked-seed' }) as unknown as WerewolfMatchArtifactIndexEntry,
        );
      },
    };

    const widenedApp = Fastify({ logger: false });
    await widenedApp.register(werewolfMatchesRoutes, {
      prefix: '/api/v1',
      werewolfMatchArtifactStore: widenedStore,
    });
    await widenedApp.ready();

    try {
      const res = await widenedApp.inject({
        method: 'GET',
        url: '/api/v1/werewolf-matches',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { data: Array<Record<string, unknown>> };
      expect(body.data.length).toBeGreaterThan(0);
      for (const entry of body.data) {
        expect(entry).not.toHaveProperty('seed');
      }
    } finally {
      await widenedApp.close();
    }
  });

  it('GET /api/v1/werewolf-matches/:id returns manifest+summary stripped of files+seed', async () => {
    await runMatch('g-detail');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/g-detail' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.summary.matchId).toBe('g-detail');
    expect(body.data.summary).not.toHaveProperty('seed');
    expect(body.data.manifest).not.toHaveProperty('files');
    expect(body.data.replayEvents).toBeUndefined();
    expect(body.data.decisionTraces).toBeUndefined();
  });

  it('GET /api/v1/werewolf-matches/:id/replay returns persisted (already public) events with no actor identity in night phases and no seed', async () => {
    await runMatch('g-replay');
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/g-replay/replay' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const matchStarted = body.data.find((e: { eventType: string }) => e.eventType === 'match.started');
    expect(matchStarted.data.seed).toBeUndefined();
    const nightPrivate = body.data.filter(
      (e: { eventType: string; data: Record<string, unknown> }) =>
        ['agent.action_requested', 'agent.action_received'].includes(e.eventType) &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(e.data['phase'] as string),
    );
    expect(nightPrivate.length).toBeGreaterThan(0);
    for (const e of nightPrivate) {
      expect(e.data.playerId).toBeUndefined();
      expect(e.data.agentId).toBeUndefined();
    }
  });

  it('GET /api/v1/werewolf-matches/:id/decision-trace strips privateStateHash + reasoningSummary', async () => {
    await runMatch('g-trace');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf-matches/g-trace/decision-trace',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.data)).not.toContain('privateStateHash');
    expect(JSON.stringify(body.data)).not.toContain('reasoningSummary');
    for (const t of body.data) {
      expect(t.publicStateHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([
    '/api/v1/werewolf-matches/no-such',
    '/api/v1/werewolf-matches/no-such/replay',
    '/api/v1/werewolf-matches/no-such/decision-trace',
  ])('%s returns 404 with MATCH_NOT_FOUND', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });
});
