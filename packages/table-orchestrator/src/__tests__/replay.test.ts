import { describe, it, expect } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryTableStore, MemoryHandStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { BlindConfig } from '@agent-poker/shared';

const BLIND_CONFIG: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

async function runOneHand(seed: string) {
  const handStore = new MemoryHandStore();
  const orch = new TableOrchestrator(new MemoryTableStore(), handStore);
  const table = await orch.createTable({ name: 'Replay', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed });
  for (let i = 0; i < 2; i++) {
    const agentId = `agent-${i}`;
    await orch.addAgent(table.tableId, { agentId, name: `Agent-${i}`, adapterType: 'mock' },
      new AlwaysCallAgent(agentId, `Agent-${i}`), 1000);
  }
  const summary = await orch.startHand(table.tableId);
  const events = await handStore.getReplayEvents(summary.handId);
  return { summary, events };
}

describe('Replay and Reproducibility', () => {
  it('rep-001: same seed → identical HandSummary structure', async () => {
    const r1 = await runOneHand('repro-42');
    const r2 = await runOneHand('repro-42');
    expect(r1.summary.communityCards).toEqual(r2.summary.communityCards);
    expect(r1.summary.allActions.map(a => a.actionType)).toEqual(r2.summary.allActions.map(a => a.actionType));
  });

  it('rep-002: same seed → identical allActions array', async () => {
    const r1 = await runOneHand('repro-43');
    const r2 = await runOneHand('repro-43');
    expect(r1.summary.allActions.map(a => ({ type: a.actionType, amount: a.amount }))).toEqual(
      r2.summary.allActions.map(a => ({ type: a.actionType, amount: a.amount }))
    );
  });

  it('rep-003: same seed → identical communityCards', async () => {
    const r1 = await runOneHand('repro-44');
    const r2 = await runOneHand('repro-44');
    expect(r1.summary.communityCards).toEqual(r2.summary.communityCards);
  });

  it('rep-004: same seed → identical results', async () => {
    const r1 = await runOneHand('repro-45');
    const r2 = await runOneHand('repro-45');
    const normalize = (r: typeof r1.summary.results) =>
      r.map(x => ({ potIndex: x.potIndex, netChange: x.netChange }));
    expect(normalize(r1.summary.results)).toEqual(normalize(r2.summary.results));
  });

  it('rep-005: different seeds → different deck order', async () => {
    const r1 = await runOneHand('seed-AAA');
    const r2 = await runOneHand('seed-BBB');
    // Community cards are very likely to differ
    const same = JSON.stringify(r1.summary.communityCards) === JSON.stringify(r2.summary.communityCards);
    expect(same).toBe(false);
  });

  it('rep-006: hand seed = tableSeed-handNumber', async () => {
    const tableSeed = 'my-table-seed';
    const { summary } = await runOneHand(tableSeed);
    expect(summary.seed).toBe(`${tableSeed}-1`);
  });

  it('rep-007: replay events cover all phases', async () => {
    const { events } = await runOneHand('phases-test');
    const types = events.map(e => e.eventType);
    expect(types).toContain('hand.started');
    expect(types).toContain('hand.completed');
    expect(types).toContain('blinds.posted');
    expect(types).toContain('hole_cards.dealt');
  });

  it('rep-008: replay events sequence is strictly 0,1,2,...', async () => {
    const { events } = await runOneHand('sequence-test');
    const seqs = events.map(e => e.sequence);
    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i);
    }
  });

  it('rep-009: finalStacks in hand.completed matches HandSummary.players stackAfter', async () => {
    const { summary, events } = await runOneHand('stacks-test');
    const completedEvent = events.find(e => e.eventType === 'hand.completed');
    expect(completedEvent).toBeDefined();
    const finalStacks = completedEvent!.data['finalStacks'] as Record<string, number>;
    for (const player of summary.players) {
      expect(finalStacks[player.playerId]).toBe(player.stackAfter);
    }
  });

  it('rep-010: HandSummary.allActions matches action.applied events', async () => {
    const { summary, events } = await runOneHand('actions-test');
    const appliedEvents = events.filter(e => e.eventType === 'action.applied');
    expect(summary.allActions.length).toBe(appliedEvents.length);
  });
});
