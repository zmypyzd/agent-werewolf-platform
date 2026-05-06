import { describe, expect, it } from 'vitest';
import { RealtimeHub, type HubConnection } from '@agent-poker/realtime';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { WerewolfReplayEvent } from '@agent-poker/shared';
import { WerewolfOrchestrator } from '../orchestrator.js';
import { attachWerewolfHub, buildPublicMatchPayload } from '../hub-integration.js';

interface CapturedFrame {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
}

function fakeConnection(userId: string): { conn: HubConnection; frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  const conn: HubConnection = {
    userId,
    send(json: string) { frames.push(JSON.parse(json) as CapturedFrame); },
  };
  return { conn, frames };
}

async function runMatch(orch: WerewolfOrchestrator, gameId: string, seed: string): Promise<{
  matchId: string;
  players: Array<{ id: string }>;
}> {
  const { matchId, initialState } = orch.createMatch({ gameId, seed });
  for (const p of initialState.players) {
    orch.registerAgent(matchId, p.id, new WerewolfRandomMockAgent(`a-${p.id}`, p.name, { seed: `r-${p.id}` }));
  }
  return { matchId, players: initialState.players.map((p) => ({ id: p.id })) };
}

describe('attachWerewolfHub', () => {
  it('publishes public replay events to match:<gameId> with actor identity stripped in night phases', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId } = await runMatch(orch, 'g-public', 's-public');
    attachment.attachMatch(matchId, []); // no ownership; only match: topic gets pushes

    const spectator = fakeConnection('user-spec');
    hub.subscribe(spectator.conn, `match:${matchId}`);

    await orch.runMatch(matchId);

    const matchFrames = spectator.frames.filter((f) => f.topic === `match:${matchId}`);
    expect(matchFrames.length).toBeGreaterThan(0);

    // match.started carries no seed
    const started = matchFrames.find((f) => f.type === 'match.started');
    expect(started).toBeDefined();
    expect(started!.payload['seed']).toBeUndefined();

    // night-phase agent.action_received frames have no actor identity
    const nightFrames = matchFrames.filter(
      (f) =>
        (f.type === 'agent.action_requested' || f.type === 'agent.action_received') &&
        ['night-werewolf-vote', 'night-witch', 'night-seer'].includes(f.payload['phase'] as string),
    );
    expect(nightFrames.length).toBeGreaterThan(0);
    for (const f of nightFrames) {
      expect(f.payload['playerId']).toBeUndefined();
      expect(f.payload['agentId']).toBeUndefined();
    }
  });

  it("publishes per-player private-state snapshots only to that player's player:<userId>:<gameId> topic", async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId, players } = await runMatch(orch, 'g-priv', 's-priv');
    // Map first player to user-A, second to user-B; the rest unowned.
    const ownership = [
      { playerId: players[0]!.id, userId: 'user-A' },
      { playerId: players[1]!.id, userId: 'user-B' },
    ];
    attachment.attachMatch(matchId, ownership);

    const userA = fakeConnection('user-A');
    const userB = fakeConnection('user-B');
    hub.subscribe(userA.conn, `player:user-A:${matchId}`);
    hub.subscribe(userB.conn, `player:user-B:${matchId}`);

    await orch.runMatch(matchId);

    const aFrames = userA.frames.filter((f) => f.type === 'werewolf.private_state');
    const bFrames = userB.frames.filter((f) => f.type === 'werewolf.private_state');
    expect(aFrames.length).toBeGreaterThan(0);
    expect(bFrames.length).toBeGreaterThan(0);

    // No cross-leak.
    for (const f of aFrames) {
      expect(f.topic).toBe(`player:user-A:${matchId}`);
      expect((f.payload['privateState'] as { selfId: string }).selfId).toBe(players[0]!.id);
    }
    for (const f of bFrames) {
      expect(f.topic).toBe(`player:user-B:${matchId}`);
      expect((f.payload['privateState'] as { selfId: string }).selfId).toBe(players[1]!.id);
    }
  });

  it('detachMatch removes all listeners for that match', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const { matchId } = await runMatch(orch, 'g-detach', 's-detach');
    attachment.attachMatch(matchId, []);
    attachment.detachMatch(matchId);

    const spectator = fakeConnection('user-spec');
    hub.subscribe(spectator.conn, `match:${matchId}`);

    await orch.runMatch(matchId);
    expect(spectator.frames.length).toBe(0);
  });

  it('attaching the same matchId twice throws', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);
    const { matchId } = await runMatch(orch, 'g-twice', 's-twice');
    attachment.attachMatch(matchId, []);
    expect(() => attachment.attachMatch(matchId, [])).toThrow(/already attached/);
  });

  it('detachAll removes all listeners across every attached match', async () => {
    const hub = new RealtimeHub();
    const orch = new WerewolfOrchestrator();
    const attachment = attachWerewolfHub(orch, hub);

    const a = await runMatch(orch, 'g-all-1', 's-all-1');
    const b = await runMatch(orch, 'g-all-2', 's-all-2');
    attachment.attachMatch(a.matchId, []);
    attachment.attachMatch(b.matchId, []);

    attachment.detachAll();

    const spec1 = fakeConnection('user-1');
    const spec2 = fakeConnection('user-2');
    hub.subscribe(spec1.conn, `match:${a.matchId}`);
    hub.subscribe(spec2.conn, `match:${b.matchId}`);

    await orch.runMatch(a.matchId);
    await orch.runMatch(b.matchId);

    expect(spec1.frames.length).toBe(0);
    expect(spec2.frames.length).toBe(0);

    // After detachAll, attachMatch must be valid again — confirms the internal
    // handle map was cleared, not just emptied of subscriptions.
    expect(() => attachment.attachMatch(a.matchId, [])).not.toThrow();
  });

  it('buildPublicMatchPayload: publish-time metadata wins over event.data fields with shadowing names', () => {
    // Construct a synthetic public event whose `data` carries shadow metadata.
    // If the spread order ever flips, these assertions catch it: the spoofed
    // values inside `data` would leak past the publish-time wrappers and
    // silently break sequence-based ordering downstream.
    const synthetic: WerewolfReplayEvent = {
      eventId: 'real-event-id',
      gameId: 'g-precedence',
      sequence: 42,
      timestamp: 1_000_000,
      eventType: 'phase.changed',
      data: {
        eventId: 'spoofed-event-id',
        sequence: -1,
        timestamp: 0,
        phase: 'day-vote',
      },
    };

    const payload = buildPublicMatchPayload(synthetic);

    expect(payload['eventId']).toBe('real-event-id');
    expect(payload['sequence']).toBe(42);
    expect(payload['timestamp']).toBe(1_000_000);
    // Non-shadow data field still flows through.
    expect(payload['phase']).toBe('day-vote');
  });
});
