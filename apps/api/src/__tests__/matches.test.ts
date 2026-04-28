import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { TableOrchestrator } from '@agent-poker/table-orchestrator';
import {
  FileMatchArtifactStore,
  MemoryHandStore,
  MemoryTableStore,
} from '@agent-poker/persistence';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;
let cookie: string;
let userCounter = 0;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
  userCounter += 1;
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: JSON.stringify({
      email: `match${userCounter}@x.test`,
      password: 'hunter22pw',
      displayName: `MatchUser${userCounter}`,
    }),
  });
  const setCookie = reg.headers['set-cookie'];
  const sid = (Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? '').match(/apk_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`register did not set apk_sid: ${reg.body}`);
  cookie = sid;
});

afterEach(async () => {
  await app.close();
});

async function injectPost(path: string, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: CSRF,
    cookies: { apk_sid: cookie },
    payload: JSON.stringify(body),
  });
}

async function createSimulatedMatch() {
  const sim = await injectPost('/api/v1/simulate', {
    name: 'Artifact Sim',
    maxSeats: 6,
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    seed: 'artifact-api-seed',
    defaultTimeoutMs: 1000,
    agents: [
      { name: 'B1', strategy: 'always-call', buyIn: 1000 },
      { name: 'B2', strategy: 'always-call', buyIn: 1000 },
    ],
    numHands: 1,
  });
  expect(sim.statusCode).toBe(200);
  const simBody = JSON.parse(sim.payload);
  return {
    matchId: simBody.data.matchArtifact.matchId as string,
    tableId: simBody.data.tableId as string,
  };
}

describe('match artifact API', () => {
  it('GET /api/v1/matches is public and starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/matches' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toEqual([]);
  });

  it('POST /simulate creates a match artifact visible through public routes', async () => {
    const { matchId, tableId } = await createSimulatedMatch();
    expect(matchId).toBe(tableId);

    const list = await app.inject({ method: 'GET', url: '/api/v1/matches' });
    expect(list.statusCode).toBe(200);
    const listBody = JSON.parse(list.payload);
    expect(listBody.data.map((entry: { matchId: string }) => entry.matchId)).toContain(matchId);
    expect(listBody.data[0]).not.toHaveProperty('seed');

    const record = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}` });
    expect(record.statusCode).toBe(200);
    const recordBody = JSON.parse(record.payload);
    expect(recordBody.data.summary).not.toHaveProperty('seed');
    expect(recordBody.data.summary.hands).toHaveLength(1);
    expect(recordBody.data.summary.hands[0]).not.toHaveProperty('seed');
    expect(recordBody.data.replayEvents).toBeUndefined();
    expect(recordBody.data.decisionTraces).toBeUndefined();
    expect(recordBody.data.analysisSummary).toBeUndefined();
    expect(recordBody.data.manifest).not.toHaveProperty('files');
    expect(recordBody.data.manifest.handIds).toEqual([expect.stringMatching(/^hand-/)]);

    const replay = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}/replay` });
    expect(replay.statusCode).toBe(200);
    const replayBody = JSON.parse(replay.payload);
    expect(Array.isArray(replayBody.data)).toBe(true);
    expect(replayBody.data.length).toBeGreaterThan(0);

    const decisionTrace = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/decision-trace`,
    });
    expect(decisionTrace.statusCode).toBe(200);
    const decisionTraceBody = JSON.parse(decisionTrace.payload);
    expect(Array.isArray(decisionTraceBody.data)).toBe(true);
    expect(decisionTraceBody.data.length).toBeGreaterThan(0);

    const analysis = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/analysis`,
    });
    expect(analysis.statusCode).toBe(200);
    const analysisBody = JSON.parse(analysis.payload);
    expect(analysisBody.data.matchId).toBe(matchId);
    expect(analysisBody.data.decisionCount).toBeGreaterThan(0);
    expect(analysisBody.data.totals.actionCounts.call).toBeGreaterThan(0);
  });

  it('POST /simulate rejects requests above the serverless hand cap', async () => {
    const res = await injectPost('/api/v1/simulate', {
      name: 'Too Large',
      maxSeats: 6,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      seed: 'artifact-api-seed',
      defaultTimeoutMs: 1000,
      agents: [
        { name: 'B1', strategy: 'always-call', buyIn: 1000 },
        { name: 'B2', strategy: 'always-call', buyIn: 1000 },
      ],
      numHands: 21,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('public match record strips private cards and private replay events', async () => {
    const { matchId } = await createSimulatedMatch();

    const record = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}` });
    expect(record.statusCode).toBe(200);
    const recordBody = JSON.parse(record.payload);
    expect(JSON.stringify(recordBody.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(recordBody.data)).not.toContain('"handEvaluation"');
    expect(recordBody.data.summary).not.toHaveProperty('seed');
    expect(recordBody.data.summary.hands[0]).not.toHaveProperty('seed');
    expect(recordBody.data.replayEvents).toBeUndefined();
  });

  it('public match replay strips private cards and private replay events', async () => {
    const { matchId } = await createSimulatedMatch();

    const replay = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}/replay` });
    expect(replay.statusCode).toBe(200);
    const replayBody = JSON.parse(replay.payload);
    expect(JSON.stringify(replayBody.data)).not.toContain('"holeCards"');
    expect(replayBody.data.map((event: { eventType: string }) => event.eventType))
      .not.toContain('hole_cards.dealt');
  });

  it('public match decision trace strips private cards and raw chain-of-thought', async () => {
    const { matchId } = await createSimulatedMatch();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/decision-trace`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(body.data)).not.toContain('rawChainOfThought');
    expect(JSON.stringify(body.data)).not.toContain('keyObservations');
    expect(JSON.stringify(body.data)).not.toContain('consideredActions');
    expect(JSON.stringify(body.data)).not.toContain('privateStateHash');
    expect(JSON.stringify(body.data)).not.toContain('reasoningSummary');
    expect(body.data[0].publicStateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('public match analysis summarizes decisions without reasoning text', async () => {
    const { matchId } = await createSimulatedMatch();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/analysis`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.agents.length).toBeGreaterThan(0);
    expect(body.data.totals.missingReasoningCount).toBeGreaterThan(0);
    expect(body.data.totals.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body.data)).not.toContain('"holeCards"');
    expect(JSON.stringify(body.data)).not.toContain('rawChainOfThought');
    expect(JSON.stringify(body.data)).not.toContain('keyObservations');
    expect(JSON.stringify(body.data)).not.toContain('consideredActions');
  });

  it('GET /api/v1/matches/:matchId returns 404 for an unknown match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/matches/no-such-match' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('GET /api/v1/matches/:matchId/replay returns 404 for an unknown match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/matches/no-such-match/replay' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('GET /api/v1/matches/:matchId/decision-trace returns 404 for an unknown match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/matches/no-such-match/decision-trace',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('GET /api/v1/matches/:matchId/analysis returns 404 for an unknown match', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/matches/no-such-match/analysis',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('GET /api/v1/matches/:matchId maps unsafe file-backed ids to 404', async () => {
    const fileApp = buildServer({
      matchArtifactStore: new FileMatchArtifactStore(
        path.join(os.tmpdir(), `poker-match-api-${randomUUID()}`),
      ),
    });
    await fileApp.ready();
    try {
      const res = await fileApp.inject({ method: 'GET', url: '/api/v1/matches/..%5Csecret' });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('MATCH_NOT_FOUND');
    } finally {
      await fileApp.close();
    }
  });

  it('requires an injected handStore when an orchestrator is injected', () => {
    const handStore = new MemoryHandStore();
    const orchestrator = new TableOrchestrator(new MemoryTableStore(), handStore);

    expect(() => buildServer({ orchestrator })).toThrow(
      'buildServer requires handStore when orchestrator is provided',
    );
  });
});
