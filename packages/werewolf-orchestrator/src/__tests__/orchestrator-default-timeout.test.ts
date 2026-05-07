import { describe, expect, it } from 'vitest';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
} from '@agent-poker/shared';
import { WerewolfOrchestrator } from '../orchestrator.js';

// The runner stamps each WerewolfDecisionRequest with deadlineMs equal to
// the per-call agent budget, so the cleanest way to assert the orchestrator
// default actually reaches the runner is to capture an inbound request.
class CapturingAgent
  implements IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>
{
  public capturedDeadline: number | null = null;
  constructor(
    public readonly agentId: string,
    public readonly name: string,
    private readonly inner: IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>,
  ) {}
  async requestDecision(req: WerewolfDecisionRequest): Promise<WerewolfDecisionResponse> {
    if (this.capturedDeadline === null) this.capturedDeadline = req.deadlineMs;
    return this.inner.requestDecision(req);
  }
}

describe('WerewolfOrchestrator default timeout', () => {
  it('defaults to 60_000ms when no override is provided', async () => {
    const orch = new WerewolfOrchestrator();
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-default',
      seed: 'seed-default',
    });
    const captures: CapturingAgent[] = [];
    for (const p of initialState.players) {
      const inner = new WerewolfRandomMockAgent(`a-${p.id}`, p.name, {
        seed: `r-${p.id}`,
      });
      const wrapper = new CapturingAgent(`a-${p.id}`, p.name, inner);
      orch.registerAgent(matchId, p.id, wrapper);
      captures.push(wrapper);
    }
    await orch.runMatch(matchId);

    const seen = captures
      .map((c) => c.capturedDeadline)
      .filter((d): d is number => d !== null);
    expect(seen.length).toBeGreaterThan(0);
    for (const d of seen) {
      expect(d).toBe(60_000);
    }
  });

  it('honors the constructor-level defaultTimeoutMs override', async () => {
    const orch = new WerewolfOrchestrator({ defaultTimeoutMs: 12_345 });
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-override',
      seed: 'seed-override',
    });
    const captures: CapturingAgent[] = [];
    for (const p of initialState.players) {
      const inner = new WerewolfRandomMockAgent(`a-${p.id}`, p.name, {
        seed: `r-${p.id}`,
      });
      const wrapper = new CapturingAgent(`a-${p.id}`, p.name, inner);
      orch.registerAgent(matchId, p.id, wrapper);
      captures.push(wrapper);
    }
    await orch.runMatch(matchId);

    const seen = captures
      .map((c) => c.capturedDeadline)
      .filter((d): d is number => d !== null);
    expect(seen.length).toBeGreaterThan(0);
    for (const d of seen) {
      expect(d).toBe(12_345);
    }
  });

  it('lets per-match defaultTimeoutMs override the constructor-level default', async () => {
    const orch = new WerewolfOrchestrator({ defaultTimeoutMs: 12_345 });
    const { matchId, initialState } = orch.createMatch({
      gameId: 'g-permatch',
      seed: 'seed-permatch',
      defaultTimeoutMs: 99_999,
    });
    const captures: CapturingAgent[] = [];
    for (const p of initialState.players) {
      const inner = new WerewolfRandomMockAgent(`a-${p.id}`, p.name, {
        seed: `r-${p.id}`,
      });
      const wrapper = new CapturingAgent(`a-${p.id}`, p.name, inner);
      orch.registerAgent(matchId, p.id, wrapper);
      captures.push(wrapper);
    }
    await orch.runMatch(matchId);

    const seen = captures
      .map((c) => c.capturedDeadline)
      .filter((d): d is number => d !== null);
    expect(seen.length).toBeGreaterThan(0);
    for (const d of seen) {
      expect(d).toBe(99_999);
    }
  });
});
