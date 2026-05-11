import { describe, it, expect } from 'vitest';
import type {
  AgentWsClientMessage,
  AgentWsServerMessage,
} from '@agent-poker/agent-protocol';
import type { WerewolfDecisionRequest } from '@agent-poker/shared';
import {
  AgentConnection,
  AgentConnectionRegistry,
  AgentOfflineError,
  type AgentSocket,
} from '../agent-connection-registry.js';
import { WerewolfWsAgentAdapter } from '../werewolf-ws-agent-adapter.js';

class FakeSocket implements AgentSocket {
  sent: AgentWsServerMessage[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as AgentWsServerMessage);
  }
  close(): void {
    this.closed = true;
  }
  pushClientFrame(conn: AgentConnection, frame: AgentWsClientMessage): void {
    conn.handleFrame(JSON.stringify(frame));
  }
}

const stubRequest: WerewolfDecisionRequest = {
  requestId: 'r-1',
  gameId: 'g-1',
  agentId: 'agent-A',
  playerId: 'p1',
  phase: 'night-werewolf-vote',
  nightNumber: 1,
  dayNumber: 0,
  publicState: {
    gameId: 'g-1',
    phase: 'night-werewolf-vote',
    nightNumber: 1,
    dayNumber: 0,
    players: [],
    history: [],
    winner: null,
  },
  privateState: {
    selfId: 'p1',
    selfRole: 'werewolf',
    selfSide: 'werewolf',
    knownAllies: [],
    seerKnowledge: [],
    witchView: null,
    hunterCanShoot: false,
  },
  validActions: [{ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' }],
  deadlineMs: 1_000,
};

describe('WerewolfWsAgentAdapter', () => {
  it('exposes agentId + name without invoking the network', () => {
    const registry = new AgentConnectionRegistry();
    const adapter = new WerewolfWsAgentAdapter('agent-A', 'Wolf', registry);
    expect(adapter.agentId).toBe('agent-A');
    expect(adapter.name).toBe('Wolf');
  });

  it('requestDecision throws AgentOfflineError when no connection is registered', async () => {
    const registry = new AgentConnectionRegistry();
    const adapter = new WerewolfWsAgentAdapter('agent-A', 'Wolf', registry);
    await expect(adapter.requestDecision(stubRequest)).rejects.toBeInstanceOf(AgentOfflineError);
  });

  it('requestDecision routes through the registered connection and resolves on response', async () => {
    const registry = new AgentConnectionRegistry();
    const sock = new FakeSocket();
    const conn = new AgentConnection({
      agentId: 'agent-A',
      socket: sock,
      serverConnectionId: 'srv-1',
      correlationIdFactory: () => 'corr-X',
    });
    conn.start();
    registry.register(conn);

    const adapter = new WerewolfWsAgentAdapter('agent-A', 'Wolf', registry);

    const promise = adapter.requestDecision(stubRequest);
    expect(sock.sent.some((m) => m.type === 'decide')).toBe(true);

    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-X',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });

    const res = await promise;
    expect(res.requestId).toBe('r-1');
    expect(res.agentId).toBe('agent-A');
    expect(res.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });

    conn.handleSocketClosed('test-cleanup');
  });

  it('uses a separate registryKey for connection lookup when split from agentId', async () => {
    // werewolf-lobby seat flow: orchestrator-facing agentId is the per-
    // seat synthetic (agent-p1), but the registry indexes by postgres
    // UUID. Passing both keeps the two identities cleanly separated.
    const registry = new AgentConnectionRegistry();
    const sock = new FakeSocket();
    const postgresId = 'cfg-postgres-uuid-here';
    const conn = new AgentConnection({
      agentId: postgresId,
      socket: sock,
      serverConnectionId: 'srv-1',
      correlationIdFactory: () => 'corr-X',
    });
    conn.start();
    registry.register(conn);

    const adapter = new WerewolfWsAgentAdapter(
      'agent-p3',       // orchestrator-facing, synthetic per-seat
      'WolfBot',
      registry,
      postgresId,       // registry-lookup key, postgres UUID
    );
    expect(adapter.agentId).toBe('agent-p3');

    const promise = adapter.requestDecision(stubRequest);
    sock.pushClientFrame(conn, {
      type: 'decide.response',
      correlationId: 'corr-X',
      action: { type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' },
    });
    const res = await promise;
    expect(res.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p2' });

    conn.handleSocketClosed('test-cleanup');
  });

  it('falls back to AgentOfflineError if the connection was closed between dispatches', async () => {
    const registry = new AgentConnectionRegistry();
    const sock = new FakeSocket();
    const conn = new AgentConnection({
      agentId: 'agent-A',
      socket: sock,
      serverConnectionId: 'srv-1',
      correlationIdFactory: () => 'corr-X',
    });
    conn.start();
    registry.register(conn);

    const adapter = new WerewolfWsAgentAdapter('agent-A', 'Wolf', registry);

    // Connection drops before the next decision.
    conn.handleSocketClosed('peer_left');
    registry.unregister(conn);

    await expect(adapter.requestDecision(stubRequest)).rejects.toBeInstanceOf(AgentOfflineError);
  });
});
