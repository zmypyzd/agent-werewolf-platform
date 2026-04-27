import { describe, expect, it } from 'vitest';
import {
  MatchArtifactIndexEntrySchema,
  MatchArtifactManifestSchema,
  MatchArtifactRecordSchema,
  MatchSummarySchema,
  SimulateRequestSchema,
} from '../schemas.js';

const now = 1_777_280_000_000;

const hand = {
  handId: 'hand-001-abc123',
  tableId: 'tbl-12345678',
  handNumber: 1,
  seed: 'seed-1',
  startedAt: now,
  completedAt: now + 1000,
  players: [],
  blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
  communityCards: [],
  allActions: [],
  results: [],
  finalPots: [],
};

const fileRef = {
  path: 'summary.json',
  sha256: 'a'.repeat(64),
  bytes: 128,
  contentType: 'application/json',
};

const artifactFiles = {
  summary: fileRef,
  replay: { ...fileRef, path: 'replay.jsonl', contentType: 'application/x-ndjson' },
  decisionTrace: { ...fileRef, path: 'decision-trace.jsonl', contentType: 'application/x-ndjson' },
  analysisSummary: { ...fileRef, path: 'analysis-summary.json', contentType: 'application/json' },
};

const analysisSummary = {
  matchId: 'tbl-12345678',
  tableId: 'tbl-12345678',
  generatedAt: now + 1500,
  handCount: 1,
  agentCount: 1,
  decisionCount: 0,
  totals: {
    decisionCount: 0,
    actionCounts: {},
    streetCounts: {},
    intentCounts: {},
    riskCounts: {},
    missingReasoningCount: 0,
    timeoutCount: 0,
    invalidActionCount: 0,
    fallbackCount: 0,
    averageConfidence: null,
    averageLatencyMs: null,
    maxLatencyMs: null,
  },
  agents: [],
};

describe('match artifact schemas', () => {
  it('accepts a valid match summary', () => {
    const parsed = MatchSummarySchema.parse({
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      name: 'Daily Showcase',
      seed: 'seed-1',
      startedAt: now,
      completedAt: now + 1000,
      handIds: ['hand-001-abc123'],
      hands: [hand],
      finalStacks: { 'bot-a': 1050 },
      agentIds: ['bot-a'],
    });

    expect(parsed.matchId).toBe('tbl-12345678');
    expect(parsed.handIds).toEqual(['hand-001-abc123']);
  });

  it('accepts a valid manifest and index entry', () => {
    const manifest = MatchArtifactManifestSchema.parse({
      artifactVersion: 1,
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      createdAt: now,
      handIds: ['hand-001-abc123'],
      files: artifactFiles,
    });

    const entry = MatchArtifactIndexEntrySchema.parse({
      matchId: manifest.matchId,
      tableId: manifest.tableId,
      name: 'Daily Showcase',
      seed: 'seed-1',
      handCount: 1,
      agentIds: ['bot-a'],
      startedAt: now,
      completedAt: now + 1000,
      createdAt: now + 1200,
      artifactPath: 'matches/tbl-12345678/manifest.json',
    });

    expect(entry.artifactPath).toBe('matches/tbl-12345678/manifest.json');
    expect(manifest.files.decisionTrace.path).toBe('decision-trace.jsonl');
    expect(manifest.files.analysisSummary.path).toBe('analysis-summary.json');
  });

  it('accepts a complete artifact record', () => {
    const record = MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-001-abc123'],
        files: artifactFiles,
      },
      summary: {
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-001-abc123'],
        hands: [hand],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [],
      decisionTraces: [],
      analysisSummary,
    });

    expect(record.summary.hands).toHaveLength(1);
    expect(record.decisionTraces).toEqual([]);
    expect(record.analysisSummary.matchId).toBe('tbl-12345678');
  });

  it('rejects an artifact record with inconsistent match ids', () => {
    expect(() => MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-001-abc123'],
        files: artifactFiles,
      },
      summary: {
        matchId: 'tbl-different',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-001-abc123'],
        hands: [hand],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [],
      decisionTraces: [],
    })).toThrow();
  });

  it('rejects an artifact record with replay events outside the listed hands', () => {
    expect(() => MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-001-abc123'],
        files: artifactFiles,
      },
      summary: {
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-001-abc123'],
        hands: [hand],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [{
        eventId: 'event-001',
        handId: 'hand-not-listed',
        tableId: 'tbl-12345678',
        sequence: 0,
        eventType: 'hand.started',
        timestamp: now,
        data: {},
      }],
      decisionTraces: [],
    })).toThrow();
  });

  it('rejects an artifact record when summary.handIds differ from summary.hands', () => {
    expect(() => MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-999-missing'],
        files: artifactFiles,
      },
      summary: {
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-999-missing'],
        hands: [hand],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [],
      decisionTraces: [],
    })).toThrow();
  });

  it('rejects an artifact record when a summary hand uses another tableId', () => {
    expect(() => MatchArtifactRecordSchema.parse({
      manifest: {
        artifactVersion: 1,
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        createdAt: now,
        handIds: ['hand-001-abc123'],
        files: artifactFiles,
      },
      summary: {
        matchId: 'tbl-12345678',
        tableId: 'tbl-12345678',
        name: 'Daily Showcase',
        seed: 'seed-1',
        startedAt: now,
        completedAt: now + 1000,
        handIds: ['hand-001-abc123'],
        hands: [{ ...hand, tableId: 'tbl-other' }],
        finalStacks: { 'bot-a': 1050 },
        agentIds: ['bot-a'],
      },
      replayEvents: [],
      decisionTraces: [],
    })).toThrow();
  });

  it('rejects an invalid checksum', () => {
    expect(() => MatchArtifactManifestSchema.parse({
      artifactVersion: 1,
      matchId: 'tbl-12345678',
      tableId: 'tbl-12345678',
      createdAt: now,
      handIds: ['hand-001-abc123'],
      files: {
        summary: { ...fileRef, sha256: 'not-a-sha' },
        replay: { ...fileRef, path: 'replay.jsonl', contentType: 'application/x-ndjson' },
        decisionTrace: { ...fileRef, path: 'decision-trace.jsonl', contentType: 'application/x-ndjson' },
      },
    })).toThrow();
  });

  it('rejects simulations above the configured hand cap', () => {
    expect(() => SimulateRequestSchema.parse({
      name: 'Too Large',
      maxSeats: 6,
      blindConfig: { smallBlind: 25, bigBlind: 50, ante: 0 },
      agents: [
        { name: 'A', strategy: 'always-call', buyIn: 1000 },
        { name: 'B', strategy: 'always-call', buyIn: 1000 },
      ],
      numHands: 21,
    })).toThrow();
  });
});
