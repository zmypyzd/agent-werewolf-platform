import { describe, expect, it } from 'vitest';
import { ArtifactLimitExceededError } from '@agent-poker/shared';
import { MemoryObjectStore } from '../object-store.js';
import {
  MemoryWerewolfMatchArtifactStore,
  ObjectWerewolfMatchArtifactStore,
} from '../werewolf-match-artifact-store.js';
import type { BuildWerewolfArtifactInput } from '../werewolf-match-artifact-serialization.js';

const baseInput = (overrides: Partial<BuildWerewolfArtifactInput> = {}): BuildWerewolfArtifactInput => ({
  matchId: 'g-1',
  startedAt: 1_000,
  completedAt: 2_000,
  nightCount: 1,
  dayCount: 1,
  stepCount: 5,
  replayEventCount: 10,
  winner: 'good',
  finalPlayers: [
    { id: 'p1', seatIndex: 0, name: 'A', role: 'villager', side: 'good', alive: true },
  ],
  fullHistory: [{ type: 'game-over', winner: 'good' }],
  replayEvents: [],
  decisionTraces: [],
  ...overrides,
});

describe('MemoryWerewolfMatchArtifactStore', () => {
  it('save+get round trip', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    const rec = await store.saveMatchArtifact(baseInput());
    expect(rec.manifest.matchId).toBe('g-1');
    const loaded = await store.getMatchArtifact('g-1');
    expect(loaded?.summary.winner).toBe('good');
  });

  it('returns null for unknown match', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    expect(await store.getMatchArtifact('does-not-exist')).toBeNull();
  });

  it('list returns most-recently-created first', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(baseInput({ matchId: 'g-a' }));
    await store.saveMatchArtifact(baseInput({ matchId: 'g-b' }));
    const list = await store.listMatchArtifacts();
    expect(list[0]?.matchId).toBe('g-b');
  });

  it('options.includeReplayEvents=false returns empty replay array', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(
      baseInput({
        replayEvents: [{
          eventId: 'e', gameId: 'g-1', sequence: 0,
          eventType: 'phase.changed', timestamp: 1, data: { from: 'setup', to: 'night-werewolf-vote' },
        }],
      }),
    );
    const rec = await store.getMatchArtifact('g-1', { includeReplayEvents: false });
    expect(rec?.replayEvents).toEqual([]);
  });

  it('options.includeDecisionTraces=false returns empty traces array', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(baseInput());
    const rec = await store.getMatchArtifact('g-1', { includeDecisionTraces: false });
    expect(rec?.decisionTraces).toEqual([]);
  });

  it('rejects path-traversal matchId', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await expect(store.saveMatchArtifact(baseInput({ matchId: '../boom' }))).rejects.toThrow(
      /Invalid matchId path segment/,
    );
  });
});

describe('ObjectWerewolfMatchArtifactStore (over MemoryObjectStore)', () => {
  it('round trip via object store', async () => {
    const obj = new MemoryObjectStore();
    const store = new ObjectWerewolfMatchArtifactStore(obj);
    await store.saveMatchArtifact(baseInput());
    expect(await obj.exists('matches/g-1/manifest.json')).toBe(true);
    expect(await obj.exists('matches/g-1/summary.json')).toBe(true);
    expect(await obj.exists('matches/g-1/replay.jsonl')).toBe(true);
    expect(await obj.exists('matches/g-1/decision-trace.jsonl')).toBe(true);
    const loaded = await store.getMatchArtifact('g-1');
    expect(loaded?.summary.matchId).toBe('g-1');
  });

  it('rejects oversized replay payload', async () => {
    const obj = new MemoryObjectStore();
    const store = new ObjectWerewolfMatchArtifactStore(obj, { maxReplayBytes: 100 });
    const huge = baseInput({
      replayEvents: Array.from({ length: 50 }, (_, i) => ({
        eventId: `e${i}`, gameId: 'g-1', sequence: i,
        eventType: 'phase.changed', timestamp: i,
        data: { from: 'a-very-very-very-long-phase-name', to: 'another-extremely-long-phase' },
      })),
    });
    await expect(store.saveMatchArtifact(huge)).rejects.toThrow(ArtifactLimitExceededError);
  });

  it('deleteMatchArtifact removes blobs and prunes the index', async () => {
    const obj = new MemoryObjectStore();
    const store = new ObjectWerewolfMatchArtifactStore(obj);
    await store.saveMatchArtifact(baseInput({ matchId: 'g-keep' }));
    await store.saveMatchArtifact(baseInput({ matchId: 'g-drop' }));
    await store.deleteMatchArtifact!('g-drop');

    expect(await obj.exists('matches/g-drop/manifest.json')).toBe(false);
    expect(await obj.exists('matches/g-drop/summary.json')).toBe(false);
    expect(await obj.exists('matches/g-keep/manifest.json')).toBe(true);

    const list = await store.listMatchArtifacts();
    expect(list.map((e) => e.matchId)).toEqual(['g-keep']);
  });
});

describe('MemoryWerewolfMatchArtifactStore.deleteMatchArtifact', () => {
  it('removes the saved record', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await store.saveMatchArtifact(baseInput());
    await store.deleteMatchArtifact!('g-1');
    expect(await store.getMatchArtifact('g-1')).toBeNull();
    expect(await store.listMatchArtifacts()).toEqual([]);
  });

  it('rejects path-traversal matchId', async () => {
    const store = new MemoryWerewolfMatchArtifactStore();
    await expect(store.deleteMatchArtifact!('../bad')).rejects.toThrow(/Invalid matchId path segment/);
  });
});
