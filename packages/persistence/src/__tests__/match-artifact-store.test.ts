import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ArtifactLimitExceededError, type DecisionTrace, type HandSummary, type ReplayEvent } from '@agent-poker/shared';
import {
  FileMatchArtifactStore,
  MemoryMatchArtifactStore,
  ObjectMatchArtifactStore,
} from '../match-artifact-store.js';
import { MemoryObjectStore } from '../object-store.js';

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `poker-match-artifact-${randomUUID()}`);
}

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeHand(handNumber: number, stackAfter: number): HandSummary {
  return {
    handId: `hand-${String(handNumber).padStart(3, '0')}-abc123`,
    tableId: 'tbl-12345678',
    handNumber,
    seed: `seed-${handNumber}`,
    startedAt: 1_777_280_000_000 + handNumber,
    completedAt: 1_777_280_001_000 + handNumber,
    players: [{
      playerId: 'player-bot-a',
      agentId: 'bot-a',
      seatIndex: 0,
      stackBefore: 1000,
      stackAfter,
      holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }],
      handEvaluation: {
        category: 'high_card',
        categoryRank: 0,
        tiebreakers: [14],
        bestCards: [
          { rank: 'A', suit: 's' },
          { rank: 'K', suit: 's' },
          { rank: 'Q', suit: 'd' },
          { rank: 'J', suit: 'c' },
          { rank: '9', suit: 'h' },
        ],
        description: 'Ace high',
      },
    }],
    blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
    communityCards: [],
    allActions: [],
    results: [],
    finalPots: [],
  };
}

function makeEvent(handId: string, sequence: number): ReplayEvent {
  return {
    eventId: `evt-${handId}-${sequence}`,
    handId,
    tableId: 'tbl-12345678',
    sequence,
    eventType: 'test.event',
    timestamp: 1_777_280_002_000 + sequence,
    data: { sequence },
  };
}

function makePrivateEvent(handId: string, sequence: number): ReplayEvent {
  return {
    eventId: `evt-${handId}-${sequence}`,
    handId,
    tableId: 'tbl-12345678',
    sequence,
    eventType: 'hole_cards.dealt',
    timestamp: 1_777_280_002_000 + sequence,
    data: {
      playerId: 'player-bot-a',
      holeCards: [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }],
    },
  };
}

function makeDecisionTrace(handId: string, sequence = 0): DecisionTrace {
  return {
    traceId: `trace-${sequence}`,
    matchId: 'tbl-12345678',
    handId,
    actionId: `action-${sequence}`,
    requestId: `request-${sequence}`,
    agentId: 'bot-a',
    playerId: 'player-bot-a',
    phase: 'preflop',
    publicStateHash: 'a'.repeat(64),
    privateStateHash: 'b'.repeat(64),
    legalActions: [{ type: 'call', callAmount: 50 }, { type: 'fold' }],
    responseAction: { actionType: 'call', amount: 50 },
    appliedAction: { actionType: 'call', amount: 50 },
    latencyMs: 12,
    timedOut: false,
    invalidReason: null,
    reasoningSummary: {
      intent: 'pot_control',
      confidence: 0.6,
      riskLevel: 'low',
      keyObservations: ['Keeps range wide without exposing private cards'],
      consideredActions: [
        { actionType: 'call', amount: 50, reason: 'Continues at a bounded price' },
      ],
    },
    createdAt: 1_777_280_003_000 + sequence,
  };
}

describe('MatchArtifactStore', () => {
  it('FileMatchArtifactStore writes manifest, summary, replay JSONL, decision trace JSONL, and index', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    });

    expect(record.manifest.files.summary.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.manifest.files.decisionTrace.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.summary.finalStacks).toEqual({ 'bot-a': 1050 });
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'summary.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'replay.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'tbl-12345678', 'decision-trace.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'matches', 'index.json'))).toBe(true);
  });

  it('FileMatchArtifactStore rejects unsafe matchId path segments', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);

    await expect(store.saveMatchArtifact({
      matchId: '../outside',
      tableId: 'tbl-12345678',
      name: 'Unsafe',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    })).rejects.toThrow('Invalid matchId path segment: ../outside');

    expect(fs.existsSync(path.join(dir, 'outside'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(dir), 'outside'))).toBe(false);
  });

  it('FileMatchArtifactStore manifest checksums and bytes match written files', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    });

    const summaryRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'summary.json'),
      'utf-8',
    );
    const replayRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'replay.jsonl'),
      'utf-8',
    );
    const decisionTraceRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'decision-trace.jsonl'),
      'utf-8',
    );

    expect(record.manifest.files.summary.sha256).toBe(sha256(summaryRaw));
    expect(record.manifest.files.summary.bytes).toBe(Buffer.byteLength(summaryRaw, 'utf-8'));
    expect(record.manifest.files.replay.sha256).toBe(sha256(replayRaw));
    expect(record.manifest.files.replay.bytes).toBe(Buffer.byteLength(replayRaw, 'utf-8'));
    expect(record.manifest.files.decisionTrace.sha256).toBe(sha256(decisionTraceRaw));
    expect(record.manifest.files.decisionTrace.bytes).toBe(Buffer.byteLength(decisionTraceRaw, 'utf-8'));
  });

  it('FileMatchArtifactStore writes public-safe summary and replay artifacts', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makePrivateEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
      decisionTraces: [{
        ...makeDecisionTrace(hand.handId),
        rawChainOfThought: 'private hidden reasoning',
        reasoningSummary: {
          ...makeDecisionTrace(hand.handId).reasoningSummary!,
          rawChainOfThought: 'private hidden reasoning',
        },
      } as DecisionTrace],
    });

    const summaryRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'summary.json'),
      'utf-8',
    );
    const replayRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'replay.jsonl'),
      'utf-8',
    );
    const decisionTraceRaw = fs.readFileSync(
      path.join(dir, 'matches', 'tbl-12345678', 'decision-trace.jsonl'),
      'utf-8',
    );

    expect(summaryRaw).not.toContain('"holeCards"');
    expect(summaryRaw).not.toContain('"handEvaluation"');
    expect(replayRaw).not.toContain('"holeCards"');
    expect(replayRaw).not.toContain('hole_cards.dealt');
    expect(decisionTraceRaw).not.toContain('"holeCards"');
    expect(decisionTraceRaw).not.toContain('rawChainOfThought');
    expect(decisionTraceRaw).not.toContain('private hidden reasoning');
  });

  it('FileMatchArtifactStore loads a saved artifact', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    });

    const loaded = await store.getMatchArtifact('tbl-12345678');
    expect(loaded?.summary.matchId).toBe('tbl-12345678');
    expect(loaded?.replayEvents).toHaveLength(2);
    expect(loaded?.decisionTraces).toHaveLength(1);
  });

  it('FileMatchArtifactStore can load metadata without reading the replay file', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
    });
    fs.unlinkSync(path.join(dir, 'matches', 'tbl-12345678', 'replay.jsonl'));

    const loaded = await store.getMatchArtifact('tbl-12345678', { includeReplayEvents: false });
    expect(loaded?.summary.matchId).toBe('tbl-12345678');
    expect(loaded?.replayEvents).toEqual([]);
  });

  it('FileMatchArtifactStore lists newest index entries first', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const store = new FileMatchArtifactStore(dir);
    await store.saveMatchArtifact({
      matchId: 'match-a',
      tableId: 'tbl-a',
      name: 'A',
      seed: 'seed-a',
      hands: [makeHand(1, 1000)],
      replayEvents: [],
    });
    await store.saveMatchArtifact({
      matchId: 'match-b',
      tableId: 'tbl-b',
      name: 'B',
      seed: 'seed-b',
      hands: [makeHand(2, 1100)],
      replayEvents: [],
    });

    const entries = await store.listMatchArtifacts();
    expect(entries.map(e => e.matchId)).toEqual(['match-b', 'match-a']);
  });

  it('MemoryMatchArtifactStore stores and loads records', async () => {
    const store = new MemoryMatchArtifactStore();
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });

    const entries = await store.listMatchArtifacts();
    const loaded = await store.getMatchArtifact('tbl-12345678');
    expect(entries).toHaveLength(1);
    expect(loaded?.summary.agentIds).toEqual(['bot-a']);
  });

  it('MemoryMatchArtifactStore returns public-safe records', async () => {
    const store = new MemoryMatchArtifactStore();
    const hand = makeHand(1, 1050);
    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makePrivateEvent(hand.handId, 0), makeEvent(hand.handId, 1)],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    });

    expect(JSON.stringify(record)).not.toContain('"holeCards"');
    expect(JSON.stringify(record)).not.toContain('"handEvaluation"');
    expect(record.replayEvents.map(event => event.eventType)).not.toContain('hole_cards.dealt');
    expect(record.decisionTraces).toHaveLength(1);
  });

  it('MemoryMatchArtifactStore lists newest first when saves share the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_777_280_000_000);
    const store = new MemoryMatchArtifactStore();
    await store.saveMatchArtifact({
      matchId: 'match-a',
      tableId: 'tbl-a',
      name: 'A',
      seed: 'seed-a',
      hands: [makeHand(1, 1000)],
      replayEvents: [],
    });
    await store.saveMatchArtifact({
      matchId: 'match-b',
      tableId: 'tbl-b',
      name: 'B',
      seed: 'seed-b',
      hands: [makeHand(2, 1100)],
      replayEvents: [],
    });

    const entries = await store.listMatchArtifacts();
    expect(entries.map(e => e.matchId)).toEqual(['match-b', 'match-a']);
  });

  it('sorts multi-hand summaries and replay events by hand number then sequence', async () => {
    const store = new MemoryMatchArtifactStore();
    const firstHand = makeHand(1, 1050);
    const secondHand = makeHand(2, 900);

    const record = await store.saveMatchArtifact({
      matchId: 'match-multi',
      tableId: 'tbl-12345678',
      name: 'Multi',
      seed: 'seed-main',
      hands: [secondHand, firstHand],
      replayEvents: [
        makeEvent(secondHand.handId, 1),
        makeEvent(firstHand.handId, 2),
        makeEvent(secondHand.handId, 0),
        makeEvent(firstHand.handId, 1),
      ],
      decisionTraces: [
        makeDecisionTrace(secondHand.handId, 1),
        makeDecisionTrace(firstHand.handId, 0),
      ],
    });

    expect(record.summary.handIds).toEqual([firstHand.handId, secondHand.handId]);
    expect(record.summary.finalStacks).toEqual({ 'bot-a': 900 });
    expect(record.replayEvents.map(event => `${event.handId}:${event.sequence}`)).toEqual([
      `${firstHand.handId}:1`,
      `${firstHand.handId}:2`,
      `${secondHand.handId}:0`,
      `${secondHand.handId}:1`,
    ]);
    expect(record.decisionTraces.map(trace => trace.handId)).toEqual([
      firstHand.handId,
      secondHand.handId,
    ]);
  });

  it('ObjectMatchArtifactStore writes manifest, summary, replay JSONL, decision trace JSONL, and index objects', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore);
    const hand = makeHand(1, 1050);

    const record = await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    });

    expect(record.manifest.matchId).toBe('tbl-12345678');
    expect(await objectStore.exists('matches/tbl-12345678/manifest.json')).toBe(true);
    expect(await objectStore.exists('matches/tbl-12345678/summary.json')).toBe(true);
    expect(await objectStore.exists('matches/tbl-12345678/replay.jsonl')).toBe(true);
    expect(await objectStore.exists('matches/tbl-12345678/decision-trace.jsonl')).toBe(true);
    expect(await objectStore.exists('matches/index.json')).toBe(true);
  });

  it('ObjectMatchArtifactStore loads metadata without reading replay JSONL', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore);
    const hand = makeHand(1, 1050);
    await store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    });
    await objectStore.delete?.('matches/tbl-12345678/replay.jsonl');

    const loaded = await store.getMatchArtifact('tbl-12345678', { includeReplayEvents: false });
    expect(loaded?.summary.matchId).toBe('tbl-12345678');
    expect(loaded?.replayEvents).toEqual([]);
  });

  it('ObjectMatchArtifactStore rejects oversized replay artifacts', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore, {
      maxReplayBytes: 10,
      maxSummaryBytes: 256 * 1024,
      maxIndexEntries: 100,
    });
    const hand = makeHand(1, 1050);

    await expect(store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [makeEvent(hand.handId, 0)],
    })).rejects.toBeInstanceOf(ArtifactLimitExceededError);
  });

  it('ObjectMatchArtifactStore rejects oversized decision trace artifacts', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore, {
      maxReplayBytes: 1024 * 1024,
      maxSummaryBytes: 256 * 1024,
      maxDecisionTraceBytes: 10,
      maxIndexEntries: 100,
    });
    const hand = makeHand(1, 1050);

    await expect(store.saveMatchArtifact({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-main',
      hands: [hand],
      replayEvents: [],
      decisionTraces: [makeDecisionTrace(hand.handId)],
    })).rejects.toBeInstanceOf(ArtifactLimitExceededError);

    expect(await objectStore.exists('matches/tbl-12345678/decision-trace.jsonl')).toBe(false);
  });

  it('ObjectMatchArtifactStore truncates index entries to the configured cap', async () => {
    const objectStore = new MemoryObjectStore();
    const store = new ObjectMatchArtifactStore(objectStore, {
      maxReplayBytes: 1024 * 1024,
      maxSummaryBytes: 256 * 1024,
      maxIndexEntries: 2,
    });

    await store.saveMatchArtifact({
      matchId: 'match-a',
      tableId: 'tbl-a',
      name: 'A',
      seed: 'a',
      hands: [makeHand(1, 1000)],
      replayEvents: [],
    });
    await store.saveMatchArtifact({
      matchId: 'match-b',
      tableId: 'tbl-b',
      name: 'B',
      seed: 'b',
      hands: [makeHand(2, 1100)],
      replayEvents: [],
    });
    await store.saveMatchArtifact({
      matchId: 'match-c',
      tableId: 'tbl-c',
      name: 'C',
      seed: 'c',
      hands: [makeHand(3, 1200)],
      replayEvents: [],
    });

    const entries = await store.listMatchArtifacts();
    expect(entries.map(entry => entry.matchId)).toEqual(['match-c', 'match-b']);
  });
});
