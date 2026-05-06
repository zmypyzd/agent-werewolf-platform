import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  MemoryWerewolfMatchArtifactStore,
  MemoryWerewolfDecisionTraceStore,
} from '@agent-poker/persistence';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeEach(async () => {
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  const orch = new WerewolfOrchestrator({ artifactStore, decisionTraceStore: traceStore });
  app = buildServer({
    werewolfMatchArtifactStore: artifactStore,
    werewolfDecisionTraceStore: traceStore,
    werewolfOrchestrator: orch,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('buildServer wires werewolf routes', () => {
  it('GET /api/v1/werewolf-matches succeeds and returns an empty list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);
  });

  it('GET /api/v1/werewolf-matches/:id returns 404 for unknown matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/werewolf-matches/nope' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error.code).toBe('MATCH_NOT_FOUND');
  });

  it('default path (no werewolf options) still serves /api/v1/werewolf-matches', async () => {
    const defaultApp = buildServer();
    await defaultApp.ready();
    try {
      const res = await defaultApp.inject({ method: 'GET', url: '/api/v1/werewolf-matches' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data).toEqual([]);
    } finally {
      await defaultApp.close();
    }
  });
});
