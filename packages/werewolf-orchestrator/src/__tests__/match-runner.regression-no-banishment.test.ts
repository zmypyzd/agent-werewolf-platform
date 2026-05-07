import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import { WerewolfMatchRunner } from '../match-runner.js';
import type { IAgent } from '@agent-poker/agent-runtime';
import { createSeededRng } from '@agent-poker/agent-runtime';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { WerewolfReplayEvent } from '../replay-event.js';

// Regression: ISSUE-001 — when the engine exhausts all PK rounds without a
// strict majority it sets banished=null and rolls into the next night with
// no death. The phase.changed payload that fired on the transition carried
// no signal that the day's vote had flopped, so the spectator UI silently
// skipped from "投票 / PK 第 N 轮" to "🌙 夜 N+1" with nothing in between.
// Fix: orchestrator surfaces a dayVoteOutcome:'no-banishment' field on the
// phase.changed event that follows a vote-history entry whose record has
// banished===null && tied===true and whose final phase is not day-vote.

class AlwaysAbstainAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  private readonly rng: () => number;

  constructor(
    public readonly agentId: string,
    public readonly name: string,
    seed: string,
  ) {
    this.rng = createSeededRng(seed);
  }

  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    if (req.validActions.length === 0) {
      throw new Error(`AlwaysAbstainAgent ${this.agentId}: no valid action in phase ${req.phase}`);
    }
    // For day-vote, the first valid action is always abstain
    // (targetId=null) per valid-actions.ts:96. Picking it forces the engine
    // through every PK round into the no-banishment branch.
    if (req.phase === 'day-vote') {
      const abstain = req.validActions.find(
        (a) => a.type === 'day-vote' && a.targetId === null,
      );
      if (!abstain) {
        throw new Error(
          `AlwaysAbstainAgent ${this.agentId}: no abstain option in day-vote validActions`,
        );
      }
      return { requestId: req.requestId, agentId: this.agentId, action: abstain };
    }
    // For all other phases, pick a random valid action so the match
    // progresses normally.
    const idx = Math.floor(this.rng() * req.validActions.length);
    const chosen = req.validActions[idx]!;
    return { requestId: req.requestId, agentId: this.agentId, action: chosen };
  }
}

async function runAlwaysAbstain(seed: string): Promise<WerewolfReplayEvent[]> {
  const initial = createGame({ gameId: `g-${seed}`, seed });
  const agents = new Map(
    initial.players.map((p) => [
      p.id,
      new AlwaysAbstainAgent(`agent-${p.id}`, p.name, `r-${seed}-${p.id}`),
    ]),
  );
  const emitter = new EventEmitter();
  const events: WerewolfReplayEvent[] = [];
  emitter.on('replay-event', (e: WerewolfReplayEvent) => events.push(e));
  const runner = new WerewolfMatchRunner(initial, agents, 5_000, emitter);
  await runner.run();
  return events;
}

describe('match-runner — phase.changed no-banishment outcome', () => {
  it('phase.changed that follows the final tied vote carries dayVoteOutcome:"no-banishment"', async () => {
    const events = await runAlwaysAbstain('no-banishment-seed-a');
    const noBanishment = events.filter(
      (e) =>
        e.eventType === 'phase.changed' &&
        e.data['dayVoteOutcome'] === 'no-banishment',
    );
    expect(noBanishment.length).toBeGreaterThan(0);
    for (const e of noBanishment) {
      // The transition that carries this signal is the one OUT of day-vote
      // (engine has already advanced into night-werewolf-vote / hunter-shoot
      // / game-over by the time the orchestrator emits).
      expect(e.data['phase']).not.toBe('day-vote');
    }
  });

  it('the no-banishment phase.changed has no eliminated[] (no body to surface)', async () => {
    const events = await runAlwaysAbstain('no-banishment-seed-b');
    const noBanishment = events.filter(
      (e) =>
        e.eventType === 'phase.changed' &&
        e.data['dayVoteOutcome'] === 'no-banishment',
    );
    expect(noBanishment.length).toBeGreaterThan(0);
    for (const e of noBanishment) {
      // No death lands on a flopped vote, so the eliminated field must be
      // absent (the orchestrator omits it when empty).
      expect(e.data['eliminated']).toBeUndefined();
    }
  });

  it('PK revote phase.changed (still day-vote) does NOT carry dayVoteOutcome', async () => {
    const events = await runAlwaysAbstain('no-banishment-seed-c');
    const pkRevotes = events.filter(
      (e) =>
        e.eventType === 'phase.changed' &&
        e.data['phase'] === 'day-vote' &&
        typeof e.data['pkRound'] === 'number' &&
        (e.data['pkRound'] as number) >= 1,
    );
    expect(pkRevotes.length).toBeGreaterThan(0);
    for (const e of pkRevotes) {
      // Mid-loop revotes are not the no-banishment moment. The signal only
      // fires on the transition that LEAVES day-vote with no body.
      expect(e.data['dayVoteOutcome']).toBeUndefined();
    }
  });
});
