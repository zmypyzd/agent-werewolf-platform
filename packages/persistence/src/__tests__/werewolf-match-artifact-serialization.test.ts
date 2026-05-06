import { describe, expect, it } from 'vitest';
import type { WerewolfDecisionTrace, WerewolfHistoryEntry } from '@agent-poker/shared';
import { buildWerewolfArtifact } from '../werewolf-match-artifact-serialization.js';

describe('buildWerewolfArtifact', () => {
  const baseInput = () => ({
    matchId: 'g-1',
    startedAt: 1_000,
    completedAt: 2_000,
    nightCount: 1,
    dayCount: 1,
    stepCount: 12,
    replayEventCount: 30,
    winner: 'good' as const,
    finalPlayers: [
      { id: 'p1', seatIndex: 0, name: 'A', role: 'villager' as const, side: 'good' as const, alive: true },
    ],
    fullHistory: [
      { type: 'role-assigned', playerId: 'p1', role: 'villager' },
      { type: 'night-action', night: 1, record: {
        werewolfTarget: 'p1', witchSaved: null, witchPoisoned: null, seerTarget: null, seerResult: null,
      } },
      { type: 'death', day: 1, playerId: 'p2', cause: 'wolf-kill' },
      { type: 'speech', day: 1, record: { playerId: 'p1', inner: 'SECRET', performance: 'X', speech: 'Y' } },
      { type: 'game-over', winner: 'good' },
    ] as WerewolfHistoryEntry[],
    replayEvents: [
      {
        eventId: 'e1', gameId: 'g-1', sequence: 0,
        eventType: 'agent.action_received' as const, timestamp: 100,
        data: {
          requestId: 'r', agentId: 'a', playerId: 'p1',
          phase: 'night-werewolf-vote', // private
          action: { type: 'werewolf-vote' },
          usedFallback: false, timedOut: false, elapsedMs: 10,
        },
      },
      {
        eventId: 'e2', gameId: 'g-1', sequence: 1,
        eventType: 'engine.action_applied' as const, timestamp: 110,
        data: {
          phase: 'day-speeches',
          action: { type: 'speak', playerId: 'p1', inner: 'SECRET', performance: 'X', speech: 'Y' },
          newPhase: 'day-speeches',
        },
      },
    ],
    decisionTraces: [] as WerewolfDecisionTrace[],
  });

  it('produces a manifest with sha256 + bytes for every blob', () => {
    const { record, summaryRaw, replayRaw, decisionTraceRaw } = buildWerewolfArtifact(
      baseInput(),
      1_500,
    );
    expect(record.manifest.matchId).toBe('g-1');
    expect(record.manifest.createdAt).toBe(1_500);
    expect(record.manifest.files.summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.manifest.files.summary.bytes).toBeGreaterThan(0);
    expect(record.manifest.files.replay.bytes).toBeGreaterThan(0);
    expect(summaryRaw).toContain('"matchId": "g-1"');
    expect(replayRaw.split('\n').filter((l) => l.length > 0).length).toBe(2);
    expect(decisionTraceRaw).toBe('');
  });

  it('public summary strips role-assigned + night-action + speak.inner from history', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const types = record.summary.history.map((h) => h.type);
    expect(types).toEqual(['death', 'speech', 'game-over']);
    const speech = record.summary.history.find((h) => h.type === 'speech');
    expect(speech).toBeDefined();
    // speech record has no `inner`
    expect((speech as { record: Record<string, unknown> }).record.inner).toBeUndefined();
  });

  it('public replay events strip actor identity in private phases', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const e0 = record.replayEvents.find((e) => e.eventId === 'e1')!;
    expect(e0.data['playerId']).toBeUndefined();
    expect(e0.data['agentId']).toBeUndefined();
  });

  it('public replay events strip speak.inner', () => {
    const { record } = buildWerewolfArtifact(baseInput(), 1_500);
    const e1 = record.replayEvents.find((e) => e.eventId === 'e2')!;
    const action = e1.data['action'] as Record<string, unknown>;
    expect(action['inner']).toBeUndefined();
    expect(action['performance']).toBe('X');
  });

  it('rejects matchId with path separators', () => {
    const input = { ...baseInput(), matchId: 'a/b' };
    expect(() => buildWerewolfArtifact(input, 1_500)).toThrow(/Invalid matchId path segment/);
  });

  it('summary JSON does not contain match seed', () => {
    const out = buildWerewolfArtifact({
      matchId: 'm-seed-redaction',
      startedAt: 1_000,
      completedAt: 2_000,
      nightCount: 1,
      dayCount: 1,
      stepCount: 10,
      replayEventCount: 12,
      winner: 'good',
      finalPlayers: [],
      fullHistory: [],
      replayEvents: [],
      decisionTraces: [],
    });
    expect(out.summaryRaw).not.toContain('"seed"');
    expect(out.record.summary as unknown as Record<string, unknown>).not.toHaveProperty('seed');
  });
});
