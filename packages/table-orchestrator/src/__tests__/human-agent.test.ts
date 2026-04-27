import { describe, it, expect, vi } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryHandStore, MemoryTableStore } from '@agent-poker/persistence';
import { AlwaysCallAgent, HumanAgent } from '@agent-poker/agent-runtime';
import {
  ActionConflictError, ForbiddenError, InvalidActionError,
  type BlindConfig, type LegalAction, type HandSummary,
} from '@agent-poker/shared';

const BLINDS: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

function pickFirstLegal(legalActions: LegalAction[]): { actionType: LegalAction['type']; amount?: number } {
  // Prefer check, then call, then fold — keeps things short and avoids variable bet sizing.
  for (const t of ['check', 'call', 'fold'] as const) {
    const found = legalActions.find(la => la.type === t);
    if (found) {
      return found.callAmount !== undefined
        ? { actionType: found.type, amount: found.callAmount }
        : { actionType: found.type };
    }
  }
  // Fall back to the first legal action's minAmount if it's bet/raise/all-in.
  const first = legalActions[0]!;
  return first.minAmount !== undefined
    ? { actionType: first.type, amount: first.minAmount }
    : { actionType: first.type };
}

async function drainHumans(
  orch: TableOrchestrator,
  tableId: string,
  humans: { user: string; agent: HumanAgent }[],
  handPromise: Promise<HandSummary>,
): Promise<HandSummary> {
  let resolved = false;
  let summary: HandSummary | null = null;
  let error: unknown = null;
  handPromise.then(s => { summary = s; resolved = true; }).catch(e => { error = e; resolved = true; });

  // Hard upper bound to fail loud rather than hang.
  for (let i = 0; i < 1000 && !resolved; i++) {
    await new Promise(r => setImmediate(r));
    for (const h of humans) {
      const pending = h.agent.pendingRequest;
      if (!pending) continue;
      const action = pickFirstLegal(pending.legalActions);
      await orch.submitHumanAction(tableId, h.user, {
        handId: pending.handId,
        actionType: action.actionType,
        ...(action.amount !== undefined ? { amount: action.amount } : {}),
      });
    }
  }
  if (error) throw error;
  if (!summary) throw new Error('drainHumans did not see hand finish within iteration cap');
  return summary;
}

async function tableWith(humans: number) {
  const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
  const table = await orch.createTable(
    { name: 'H', maxSeats: 4, blindConfig: BLINDS, defaultTimeoutMs: 5_000, seed: 'h-seed' },
    'usr-owner',
  );
  const agents: { user: string; agent: HumanAgent }[] = [];
  for (let i = 0; i < humans; i++) {
    const agentId = `human-${i}`;
    const user = `usr-h-${i}`;
    const agent = new HumanAgent(agentId, agentId);
    await orch.addAgent(
      table.tableId,
      { agentId, name: agentId, adapterType: 'mock' },
      agent,
      1000,
      { ownerUserId: user, adapterType: 'human' },
    );
    agents.push({ user, agent });
  }
  return { orch, tableId: table.tableId, agents };
}

describe('HumanAgent unit', () => {
  it('requestDecision pends until submit() resolves it', async () => {
    const ha = new HumanAgent('a', 'A');
    const promise = ha.requestDecision({
      requestId: 'req-1', handId: 'hand-1', tableId: 't', agentId: 'a',
      publicState: {} as never, privateState: {} as never,
      legalActions: [{ type: 'check' }],
      timeoutMs: 1000,
    });
    expect(ha.pendingRequest).not.toBeNull();
    ha.submit({ handId: 'hand-1', actionType: 'check' });
    const resp = await promise;
    expect(resp.actionType).toBe('check');
    expect(resp.requestId).toBe('req-1');
    expect(ha.pendingRequest).toBeNull();
  });

  it('submit() with a wrong handId throws ActionConflictError', () => {
    const ha = new HumanAgent('a', 'A');
    void ha.requestDecision({
      requestId: 'r', handId: 'hand-1', tableId: 't', agentId: 'a',
      publicState: {} as never, privateState: {} as never,
      legalActions: [{ type: 'check' }], timeoutMs: 1000,
    });
    expect(() => ha.submit({ handId: 'hand-OTHER', actionType: 'check' })).toThrow(ActionConflictError);
  });

  it('submit() without a pending request throws ActionConflictError', () => {
    const ha = new HumanAgent('a', 'A');
    expect(() => ha.submit({ handId: 'h', actionType: 'check' })).toThrow(ActionConflictError);
  });

  it('cancel() rejects the pending promise', async () => {
    const ha = new HumanAgent('a', 'A');
    const promise = ha.requestDecision({
      requestId: 'r', handId: 'h', tableId: 't', agentId: 'a',
      publicState: {} as never, privateState: {} as never,
      legalActions: [{ type: 'check' }], timeoutMs: 1000,
    });
    ha.cancel('test cancel');
    await expect(promise).rejects.toThrow(/test cancel/);
    expect(ha.pendingRequest).toBeNull();
  });
});

describe('Orchestrator + HumanAgent: full hand', () => {
  it('runs a full hand end-to-end with two HumanAgents posting actions programmatically', async () => {
    const { orch, tableId, agents } = await tableWith(2);
    const handPromise = orch.startHand(tableId);
    const summary = await drainHumans(orch, tableId, agents, handPromise);
    expect(summary.handId).toBeTruthy();
    // Chip conservation
    const total = summary.players.reduce((s, p) => s + p.stackAfter, 0);
    expect(total).toBe(2000);
    // Status should be paused with seats remaining
    const after = await orch.getTable(tableId);
    expect(after.status).toBe('paused');
  });

  it('a HumanAgent that never submits triggers timeout fallback (check/fold)', async () => {
    const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
    const table = await orch.createTable(
      { name: 'T', maxSeats: 4, blindConfig: BLINDS, defaultTimeoutMs: 50, seed: 't-seed' },
      'usr-owner',
    );
    const ha = new HumanAgent('h', 'H');
    await orch.addAgent(
      table.tableId, { agentId: 'h', name: 'H', adapterType: 'mock' }, ha, 1000,
      { ownerUserId: 'usr-h', adapterType: 'human' },
    );
    await orch.addAgent(
      table.tableId, { agentId: 'a', name: 'A', adapterType: 'mock' },
      new AlwaysCallAgent('a', 'A'), 1000,
      { ownerUserId: 'usr-a', adapterType: 'mock' },
    );

    const summary = await orch.startHand(table.tableId);
    expect(summary.handId).toBeTruthy();
    // Pending request was cleared by the engine consuming the timeout fallback.
    expect(ha.pendingRequest).toBeNull();
  }, 15_000);
});

describe('Orchestrator.submitHumanAction', () => {
  it('rejects an action with the wrong handId (ActionConflictError)', async () => {
    const { orch, tableId, agents } = await tableWith(2);
    const handPromise = orch.startHand(tableId);
    // Wait for a pending request to appear.
    while (agents.every(h => h.agent.pendingRequest === null)) {
      await new Promise(r => setImmediate(r));
    }
    const target = agents.find(h => h.agent.pendingRequest !== null)!;
    await expect(
      orch.submitHumanAction(tableId, target.user, {
        handId: 'hand-WRONG',
        actionType: target.agent.pendingRequest!.legalActions[0]!.type,
      }),
    ).rejects.toBeInstanceOf(ActionConflictError);
    // Cleanup so the test process doesn't hang on the still-pending hand.
    await drainHumans(orch, tableId, agents, handPromise);
  });

  it('rejects an action whose actionType is not in legalActions (InvalidActionError)', async () => {
    const { orch, tableId, agents } = await tableWith(2);
    const handPromise = orch.startHand(tableId);
    while (agents.every(h => h.agent.pendingRequest === null)) {
      await new Promise(r => setImmediate(r));
    }
    const target = agents.find(h => h.agent.pendingRequest !== null)!;
    const allTypes = ['fold', 'check', 'call', 'bet', 'raise', 'all-in'] as const;
    const illegal = allTypes.find(t => !target.agent.pendingRequest!.legalActions.some(la => la.type === t))!;
    await expect(
      orch.submitHumanAction(tableId, target.user, {
        handId: target.agent.pendingRequest!.handId,
        actionType: illegal,
      }),
    ).rejects.toBeInstanceOf(InvalidActionError);
    await drainHumans(orch, tableId, agents, handPromise);
  });

  it('rejects a cross-user submit with ForbiddenError', async () => {
    const { orch, tableId, agents } = await tableWith(2);
    const handPromise = orch.startHand(tableId);
    while (agents.every(h => h.agent.pendingRequest === null)) {
      await new Promise(r => setImmediate(r));
    }
    await expect(
      orch.submitHumanAction(tableId, 'usr-stranger', {
        handId: agents[0]!.agent.pendingRequest?.handId ?? agents[1]!.agent.pendingRequest!.handId,
        actionType: 'check',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await drainHumans(orch, tableId, agents, handPromise);
  });

  it('rejects an out-of-bounds raise amount (InvalidActionError)', async () => {
    const { orch, tableId, agents } = await tableWith(2);
    const handPromise = orch.startHand(tableId);
    while (agents.every(h => h.agent.pendingRequest === null)) {
      await new Promise(r => setImmediate(r));
    }
    const target = agents.find(h => h.agent.pendingRequest !== null)!;
    const raise = target.agent.pendingRequest!.legalActions.find(la => la.type === 'raise');
    if (raise && raise.maxAmount !== undefined) {
      await expect(
        orch.submitHumanAction(tableId, target.user, {
          handId: target.agent.pendingRequest!.handId,
          actionType: 'raise',
          amount: raise.maxAmount + 1_000_000,
        }),
      ).rejects.toBeInstanceOf(InvalidActionError);
    }
    await drainHumans(orch, tableId, agents, handPromise);
  });
});
