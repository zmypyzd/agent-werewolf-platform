import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { createGame } from '@agent-poker/werewolf-engine';
import {
  buildDefaultWerewolfBriefing,
  type WerewolfDecisionRequest,
  type WerewolfDecisionResponse,
} from '@agent-poker/shared';
import type { IAgent } from '@agent-poker/agent-runtime';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import { WerewolfMatchRunner } from '../match-runner.js';

// Wraps another agent and captures the inbound decision-request envelopes
// so the test can assert what the runner sent without having to hook
// emit('agent.action_requested') (the briefing is intentionally not in
// the event shape — it's part of the request only).
class CapturingAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  public readonly capturedRequests: WerewolfDecisionRequest[] = [];
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    private readonly inner: IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>,
  ) {}
  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    this.capturedRequests.push(req);
    return this.inner.requestDecision(req);
  }
}

function makeAgents(playerIds: ReadonlyArray<{ id: string; name: string }>) {
  const agents = new Map<string, CapturingAgent>();
  for (const p of playerIds) {
    const inner = new WerewolfRandomMockAgent(`agent-${p.id}`, p.name, {
      seed: `r-${p.id}`,
    });
    agents.set(p.id, new CapturingAgent(`agent-${p.id}`, p.name, inner));
  }
  return agents;
}

describe('match-runner briefing forwarding', () => {
  it('includes briefing on every decision-request when the option is set', async () => {
    const initial = createGame({ gameId: 'g-brief-on', seed: 'seed-brief-on' });
    const agents = makeAgents(initial.players);
    const briefing = buildDefaultWerewolfBriefing({
      docsUrl: 'https://example.com/werewolf-guide',
    });

    const runner = new WerewolfMatchRunner(
      initial,
      agents as unknown as Map<string, CapturingAgent>,
      5_000,
      new EventEmitter(),
      { briefing },
    );
    await runner.run();

    const allCaptured = [...agents.values()].flatMap((a) => a.capturedRequests);
    expect(allCaptured.length).toBeGreaterThan(0);
    for (const req of allCaptured) {
      expect(req.briefing).toEqual(briefing);
    }
  });

  it('omits briefing on every decision-request when no option is set', async () => {
    const initial = createGame({ gameId: 'g-brief-off', seed: 'seed-brief-off' });
    const agents = makeAgents(initial.players);

    const runner = new WerewolfMatchRunner(
      initial,
      agents as unknown as Map<string, CapturingAgent>,
      5_000,
      new EventEmitter(),
    );
    await runner.run();

    const allCaptured = [...agents.values()].flatMap((a) => a.capturedRequests);
    expect(allCaptured.length).toBeGreaterThan(0);
    for (const req of allCaptured) {
      expect(req.briefing).toBeUndefined();
    }
  });
});
