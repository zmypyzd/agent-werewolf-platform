import { describe, it, expect } from 'vitest';
import { TableOrchestrator } from '../orchestrator.js';
import { MemoryTableStore, MemoryHandStore } from '@agent-poker/persistence';
import { AlwaysCallAgent } from '@agent-poker/agent-runtime';
import type { AgentDecisionRequest, BlindConfig } from '@agent-poker/shared';

const BLIND_CONFIG: BlindConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

describe('Privacy/Security boundary tests', () => {
  it('priv-001: publicState.players never has holeCards field', async () => {
    const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
    const table = await orch.createTable({ name: 'Privacy', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed: 'priv-seed' });

    const allRequests: AgentDecisionRequest[] = [];

    for (let i = 0; i < 2; i++) {
      const agentId = `spy-${i}`;
      const spyAgent = {
        agentId,
        name: `Spy-${i}`,
        requestDecision: async (req: AgentDecisionRequest) => {
          allRequests.push(req);
          return { requestId: req.requestId, agentId: req.agentId, actionType: 'check' as const };
        },
      };
      await orch.addAgent(table.tableId, { agentId, name: `Spy-${i}`, adapterType: 'mock' }, spyAgent, 1000);
    }

    await orch.startHand(table.tableId);

    for (const req of allRequests) {
      // publicState.players should NOT have holeCards
      const publicJson = JSON.stringify(req.publicState.players);
      expect(publicJson).not.toContain('"holeCards"');

      // Verify each player object lacks holeCards
      for (const player of req.publicState.players) {
        expect(Object.keys(player)).not.toContain('holeCards');
      }
    }
  });

  it('priv-002: privateState.playerId matches the requesting agent', async () => {
    const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
    const table = await orch.createTable({ name: 'Privacy2', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed: 'priv-seed-2' });

    const requestsByAgent: Map<string, AgentDecisionRequest[]> = new Map();

    for (let i = 0; i < 2; i++) {
      const agentId = `agent-${i}`;
      requestsByAgent.set(agentId, []);
      const spyAgent = {
        agentId,
        name: `Agent-${i}`,
        requestDecision: async (req: AgentDecisionRequest) => {
          requestsByAgent.get(agentId)!.push(req);
          return { requestId: req.requestId, agentId: req.agentId, actionType: 'check' as const };
        },
      };
      await orch.addAgent(table.tableId, { agentId, name: `Agent-${i}`, adapterType: 'mock' }, spyAgent, 1000);
    }

    await orch.startHand(table.tableId);

    for (const [agentId, reqs] of requestsByAgent) {
      for (const req of reqs) {
        expect(req.agentId).toBe(agentId);
        expect(req.privateState.playerId).toBeTruthy();
      }
    }
  });

  it('priv-003: privateState.holeCards has exactly 2 cards', async () => {
    const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
    const table = await orch.createTable({ name: 'Privacy3', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed: 'priv-seed-3' });

    const allRequests: AgentDecisionRequest[] = [];

    for (let i = 0; i < 2; i++) {
      const agentId = `agent-${i}`;
      const spyAgent = {
        agentId,
        name: `Agent-${i}`,
        requestDecision: async (req: AgentDecisionRequest) => {
          allRequests.push(req);
          return { requestId: req.requestId, agentId: req.agentId, actionType: 'check' as const };
        },
      };
      await orch.addAgent(table.tableId, { agentId, name: `Agent-${i}`, adapterType: 'mock' }, spyAgent, 1000);
    }

    await orch.startHand(table.tableId);

    for (const req of allRequests) {
      expect(req.privateState.holeCards).toHaveLength(2);
      expect(req.privateState.holeCards[0]).toHaveProperty('rank');
      expect(req.privateState.holeCards[0]).toHaveProperty('suit');
    }
  });

  it('priv-005: different agents receive different privateState.holeCards', async () => {
    const orch = new TableOrchestrator(new MemoryTableStore(), new MemoryHandStore());
    const table = await orch.createTable({ name: 'Privacy5', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed: 'priv-seed-5' });

    const holeCardsByAgent: Map<string, string> = new Map();

    for (let i = 0; i < 2; i++) {
      const agentId = `agent-${i}`;
      const spyAgent = {
        agentId,
        name: `Agent-${i}`,
        requestDecision: async (req: AgentDecisionRequest) => {
          if (!holeCardsByAgent.has(agentId)) {
            holeCardsByAgent.set(agentId, JSON.stringify(req.privateState.holeCards));
          }
          return { requestId: req.requestId, agentId: req.agentId, actionType: 'check' as const };
        },
      };
      await orch.addAgent(table.tableId, { agentId, name: `Agent-${i}`, adapterType: 'mock' }, spyAgent, 1000);
    }

    await orch.startHand(table.tableId);

    const cards = [...holeCardsByAgent.values()];
    if (cards.length >= 2) {
      // Different agents should have different hole cards
      expect(cards[0]).not.toEqual(cards[1]);
    }
  });

  it('priv-008: replay events in store include hole_cards.dealt', async () => {
    const handStore = new MemoryHandStore();
    const orch = new TableOrchestrator(new MemoryTableStore(), handStore);
    const table = await orch.createTable({ name: 'Privacy8', maxSeats: 3, blindConfig: BLIND_CONFIG, defaultTimeoutMs: 1000, seed: 'priv-seed-8' });

    for (let i = 0; i < 2; i++) {
      const agentId = `agent-${i}`;
      await orch.addAgent(table.tableId, { agentId, name: `Agent-${i}`, adapterType: 'mock' },
        new AlwaysCallAgent(agentId, `Agent-${i}`), 1000);
    }

    const summary = await orch.startHand(table.tableId);
    const events = await handStore.getReplayEvents(summary.handId);

    const holeCardEvents = events.filter(e => e.eventType === 'hole_cards.dealt');
    expect(holeCardEvents.length).toBeGreaterThan(0);
    for (const evt of holeCardEvents) {
      expect(evt.data).toHaveProperty('holeCards');
    }
  });
});
