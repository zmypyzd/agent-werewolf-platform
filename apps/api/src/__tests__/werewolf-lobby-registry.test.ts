import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';
import { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

describe('WerewolfLobbyRegistry', () => {
  let orch: WerewolfOrchestrator;
  let registry: WerewolfLobbyRegistry;

  beforeEach(() => {
    orch = new WerewolfOrchestrator();
    registry = new WerewolfLobbyRegistry({
      orchestrator: orch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
    });
  });

  it('creates a game with 9 empty seats and waiting status', () => {
    const entry = registry.create({ name: 'demo' });
    expect(entry.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.name).toBe('demo');
    expect(entry.status).toBe('waiting');
    expect(entry.seats).toHaveLength(9);
    expect(
      entry.seats.every((s, i) => s.seatIndex === i && s.playerId === `p${i + 1}`),
    ).toBe(true);
    expect(entry.seats.every((s) => s.occupant.kind === 'empty')).toBe(true);
  });

  it('never exposes seed in the returned entry', () => {
    const entry = registry.create({ name: 'demo', seed: 'top-secret' });
    expect(JSON.stringify(entry)).not.toContain('top-secret');
    expect(JSON.stringify(entry)).not.toContain('seed');
  });

  it('inviteNpc fills exactly one seat and registers an agent with the orchestrator', () => {
    const entry = registry.create({ name: 'demo', seed: 'fixed' });
    const updated = registry.inviteNpc(entry.gameId, 0);
    const seat = updated.seats[0]!;
    expect(seat.occupant.kind).toBe('npc');
    if (seat.occupant.kind === 'npc') {
      expect(seat.occupant.agentId).toBe('agent-p1');
      expect(typeof seat.occupant.displayName).toBe('string');
    }
    expect(updated.seats.slice(1).every((s) => s.occupant.kind === 'empty')).toBe(true);
    expect(updated.status).toBe('waiting');
  });

  it('inviteNpc rejects an occupied seat', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 3);
    expect(() => registry.inviteNpc(gameId, 3)).toThrowError(/already occupied/);
  });

  it('inviteNpc rejects an unknown game', () => {
    expect(() => registry.inviteNpc('nope', 0)).toThrowError(/not found/);
  });

  it('fillWithNpcs fills any remaining empty seats and flips to ready', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.inviteNpc(gameId, 4);
    const updated = registry.fillWithNpcs(gameId);
    expect(updated.status).toBe('ready');
    expect(updated.seats.every((s) => s.occupant.kind === 'npc')).toBe(true);
  });

  it('fillWithNpcs is idempotent on a full table', () => {
    const { gameId } = registry.create({ name: 'demo', seed: 'fixed' });
    registry.fillWithNpcs(gameId);
    const second = registry.fillWithNpcs(gameId);
    expect(second.status).toBe('ready');
  });

  it('start rejects when not ready', () => {
    const { gameId } = registry.create({ name: 'demo' });
    expect(() => registry.start(gameId)).toThrowError(/NOT_READY|cannot start/);
  });

  it('start flips status to running and calls attachMatch', () => {
    const attachMatch = vi.fn();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: new WerewolfOrchestrator(),
      attachMatch,
      detachMatch: vi.fn(),
    });
    const { gameId } = reg.create({ name: 'demo', seed: 'fixed' });
    reg.fillWithNpcs(gameId);
    const promise = reg.start(gameId);
    promise.catch(() => { /* may resolve later in this test */ });
    const after = reg.get(gameId)!;
    expect(after.status).toBe('running');
    expect(attachMatch).toHaveBeenCalledWith(gameId, []);
  });

  it('list returns summaries (no seats[]) sorted recent-first', async () => {
    registry.create({ name: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    registry.create({ name: 'b' });
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('b');
    expect(list[0]!.seatedCount).toBe(0);
    expect((list[0] as Record<string, unknown>).seats).toBeUndefined();
  });

  it('records winner + finalPlayers when the orchestrator completes', async () => {
    const realOrch = new WerewolfOrchestrator();
    const reg = new WerewolfLobbyRegistry({
      orchestrator: realOrch,
      attachMatch: vi.fn(),
      detachMatch: vi.fn(),
    });
    const { gameId } = reg.create({ name: 'real', seed: 'werewolf-seed-001' });
    reg.fillWithNpcs(gameId);
    const promise = reg.start(gameId);
    await promise;
    const after = reg.get(gameId)!;
    expect(after.status).toBe('completed');
    expect(after.winner).toMatch(/good|werewolf/);
    expect(after.finalPlayers).toHaveLength(9);
    expect(after.completedAt).toBeGreaterThan(0);
  });
});
