import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  startFirstNight,
  getValidActions,
  getPublicState,
  getPrivateState,
} from '@agent-poker/werewolf-engine';
import type { WerewolfGameState } from '@agent-poker/shared';
import { WerewolfMockAgent } from '../werewolf-mock-agent.js';
import { buildWerewolfDecisionRequest } from '../werewolf-decision-request.js';

describe('werewolf engine + agent-runtime integration', () => {
  it('drives a complete 9-AI game to game-over via WerewolfMockAgent + buildWerewolfDecisionRequest', async () => {
    const agents = new Map<string, WerewolfMockAgent>();
    let s: WerewolfGameState = createGame({ gameId: 'g-int-1', seed: 'seed-int-1' });
    s = startFirstNight(s);
    for (const p of s.players) {
      agents.set(p.id, new WerewolfMockAgent(`agent-${p.id}`, p.name));
    }

    let steps = 0;
    while (s.phase !== 'game-over' && steps < 1000) {
      let progressed = false;
      for (const player of s.players) {
        const valid = getValidActions(s, player.id);
        if (valid.length === 0) continue;
        const agent = agents.get(player.id)!;
        const req = buildWerewolfDecisionRequest({
          requestId: `${player.id}-${steps}`,
          gameId: s.gameId,
          agentId: agent.agentId,
          playerId: player.id,
          publicState: getPublicState(s),
          privateState: getPrivateState(s, player.id),
          validActions: valid,
          deadlineMs: 5000,
        });
        const res = await agent.requestDecision(req);
        s = applyAction(s, res.action);
        progressed = true;
        steps++;
        if (s.phase === 'game-over') break;
      }
      if (!progressed) break;
    }

    expect(s.phase).toBe('game-over');
    expect(['good', 'werewolf']).toContain(s.winner);
  });

  it('publicState passed to agents never leaks role-assigned or night-action history entries', async () => {
    let s: WerewolfGameState = createGame({ gameId: 'g-int-2', seed: 'seed-leak-1' });
    s = startFirstNight(s);
    const wolves = s.players.filter((p) => p.role === 'werewolf');
    const target = s.players.find((p) => p.role === 'villager')!;
    for (const w of wolves) s = applyAction(s, { type: 'werewolf-vote', voterId: w.id, targetId: target.id });
    s = applyAction(s, { type: 'witch-skip-save' });
    s = applyAction(s, { type: 'witch-skip-poison' });
    const seer = s.players.find((p) => p.role === 'seer')!;
    const t = s.players.find((p) => p.id !== seer.id && p.alive)!;
    s = applyAction(s, { type: 'seer-divine', targetId: t.id });

    const villager = s.players.find((p) => p.role === 'villager' && p.alive)!;
    const req = buildWerewolfDecisionRequest({
      requestId: 'r',
      gameId: s.gameId,
      agentId: 'a',
      playerId: villager.id,
      publicState: getPublicState(s),
      privateState: getPrivateState(s, villager.id),
      validActions: getValidActions(s, villager.id),
      deadlineMs: 5000,
    });

    // History redaction
    const hasRoleAssigned = req.publicState.history.some((e) => (e as { type: string }).type === 'role-assigned');
    const hasNightAction = req.publicState.history.some((e) => (e as { type: string }).type === 'night-action');
    expect(hasRoleAssigned).toBe(false);
    expect(hasNightAction).toBe(false);

    // privateState gating: villager is NOT a werewolf, so knownAllies is empty.
    expect(req.privateState.knownAllies).toEqual([]);
    expect(req.privateState.seerKnowledge).toEqual([]);
    expect(req.privateState.witchView).toBeNull();
  });

  it('werewolf agent sees their teammates in privateState.knownAllies', async () => {
    const s = createGame({ gameId: 'g', seed: 'seed-leak-2' });
    const wolf = s.players.find((p) => p.role === 'werewolf')!;
    const allWolves = s.players.filter((p) => p.role === 'werewolf').map((p) => p.id);

    const req = buildWerewolfDecisionRequest({
      requestId: 'r',
      gameId: s.gameId,
      agentId: 'a',
      playerId: wolf.id,
      publicState: getPublicState(s),
      privateState: getPrivateState(s, wolf.id),
      validActions: [],
      deadlineMs: 5000,
    });

    expect(new Set(req.privateState.knownAllies)).toEqual(new Set(allWolves.filter((id) => id !== wolf.id)));
    expect(req.privateState.selfRole).toBe('werewolf');
  });
});
