import { randomUUID } from 'crypto';
import { describe, it, expect } from 'vitest';
import type {
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfReplayEvent,
} from '@agent-poker/shared';
import { WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import {
  MemoryWerewolfDecisionTraceStore,
  MemoryWerewolfMatchArtifactStore,
  type AgentRecord,
  type IWerewolfDecisionMailbox,
  type IWerewolfMatchRegistry,
  type IWerewolfReplayEventStore,
  type MailboxActionRow,
  type MailboxEnqueueInput,
  type MailboxRequestRow,
  type MailboxSubmitInput,
  type MatchRegistryEntry,
} from '@agent-poker/persistence';
import {
  PostgresWerewolfOrchestrator,
  CounterSequenceAllocator,
  type WerewolfPostgresDeps,
  type WerewolfSeatSetup,
} from '../postgres-werewolf-orchestrator.js';
import { WerewolfMailboxAgentAdapter } from '../mailbox-agent-adapter.js';

// ─── In-memory fakes ───────────────────────────────────────────────────

class FakeWerewolfDecisionMailbox implements IWerewolfDecisionMailbox {
  private readonly requests = new Map<string, MailboxRequestRow>();
  private readonly actions = new Map<string, MailboxActionRow>();
  private readonly pendingByAgent = new Map<string, string[]>(); // agent_id → request_ids in order

  // Simulates a never-respond agent. Requests for these agent IDs go in
  // but never get drained by any runner — exercises the orchestrator's
  // timeout / fallback path.
  private readonly silentAgents = new Set<string>();
  silenceAgent(agentId: string): void {
    this.silentAgents.add(agentId);
  }

  async enqueueRequest(input: MailboxEnqueueInput): Promise<MailboxRequestRow> {
    const requestId = randomUUID();
    const now = Date.now();
    const row: MailboxRequestRow = {
      requestId,
      matchPk: input.matchPk,
      sequence: input.sequence,
      playerId: input.playerId,
      agentId: input.agentId,
      phase: input.phase,
      statePayload: input.statePayload,
      enqueuedAt: now,
      expiresAt: now + input.ttlSeconds * 1000,
      status: 'pending',
      fulfilledAt: null,
    };
    this.requests.set(requestId, row);
    if (input.agentId !== null && !this.silentAgents.has(input.agentId)) {
      const queue = this.pendingByAgent.get(input.agentId) ?? [];
      queue.push(requestId);
      this.pendingByAgent.set(input.agentId, queue);
    }
    return row;
  }

  async waitForAction(
    requestId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<MailboxActionRow | null> {
    const pollMs = options.pollIntervalMs ?? 25;
    const deadline = Date.now() + (options.timeoutMs ?? 10_000);
    while (Date.now() < deadline) {
      const action = this.actions.get(requestId);
      if (action) return action;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return null;
  }

  async cancelRequest(requestId: string): Promise<void> {
    const row = this.requests.get(requestId);
    if (row && row.status === 'pending') {
      this.requests.set(requestId, { ...row, status: 'aborted' });
    }
    // Remove from any agent queue.
    for (const [agentId, queue] of this.pendingByAgent.entries()) {
      const idx = queue.indexOf(requestId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        this.pendingByAgent.set(agentId, queue);
      }
    }
  }

  async expireOverdue(): Promise<number> {
    let n = 0;
    for (const [id, row] of this.requests.entries()) {
      if (row.status === 'pending' && row.expiresAt < Date.now()) {
        this.requests.set(id, { ...row, status: 'expired' });
        n += 1;
      }
    }
    return n;
  }

  async claimNextRequest(agentId: string): Promise<MailboxRequestRow | null> {
    const queue = this.pendingByAgent.get(agentId);
    if (!queue || queue.length === 0) return null;
    const requestId = queue.shift()!;
    this.pendingByAgent.set(agentId, queue);
    return this.requests.get(requestId) ?? null;
  }

  async submitAction(input: MailboxSubmitInput): Promise<void> {
    if (this.actions.has(input.requestId)) return; // idempotent dup
    // When matchPk is omitted (the API tier path), look it up from the
    // pending request — mirrors the real Postgres impl.
    const requestRow = this.requests.get(input.requestId);
    const matchPk = input.matchPk ?? requestRow?.matchPk;
    if (matchPk === undefined) {
      throw new Error(`fake mailbox: cannot resolve matchPk for ${input.requestId}`);
    }
    this.actions.set(input.requestId, {
      requestId: input.requestId,
      matchPk,
      agentId: input.agentId,
      action: input.action,
      reasoningSummary: input.reasoningSummary ?? null,
      submittedAt: Date.now(),
    });
  }

  // Test-only inspection helpers.
  size(): { requests: number; actions: number } {
    return { requests: this.requests.size, actions: this.actions.size };
  }
}

class FakeWerewolfMatchRegistry implements IWerewolfMatchRegistry {
  private readonly byGameId = new Map<string, string>(); // gameId → matchPk

  async createMatch(input: {
    gameId: string;
    ownerId: string | null;
    seed: string;
  }): Promise<MatchRegistryEntry> {
    const matchPk = randomUUID();
    this.byGameId.set(input.gameId, matchPk);
    return {
      matchPk,
      gameId: input.gameId,
      status: 'running',
      startedAt: Date.now(),
    };
  }

  async resolveMatchPk(gameId: string): Promise<string> {
    const pk = this.byGameId.get(gameId);
    if (!pk) throw new Error(`fake registry: no match for ${gameId}`);
    return pk;
  }

  async abortMatch(_gameId: string, _reason: string): Promise<void> {
    // no-op for fake
  }

  async getStatus(gameId: string): Promise<MatchRegistryEntry['status'] | null> {
    return this.byGameId.has(gameId) ? 'running' : null;
  }
}

class InMemoryReplayEventStore implements IWerewolfReplayEventStore {
  readonly events = new Map<string, WerewolfReplayEvent[]>();

  async appendEvent(matchPk: string, event: WerewolfReplayEvent): Promise<void> {
    const list = this.events.get(matchPk) ?? [];
    list.push(event);
    this.events.set(matchPk, list);
  }

  async appendEvents(matchPk: string, events: ReadonlyArray<WerewolfReplayEvent>): Promise<void> {
    for (const e of events) {
      await this.appendEvent(matchPk, e);
    }
  }

  async listEvents(matchPk: string): Promise<WerewolfReplayEvent[]> {
    return [...(this.events.get(matchPk) ?? [])];
  }
}

// ─── Loopback runner ───────────────────────────────────────────────────
// Stand-in for the real WerewolfMailboxRunner — bypasses HTTP and pulls
// directly from the fake mailbox. Each loopback runner owns one agentId
// and uses a deterministic mock agent to produce decisions.

class LoopbackRunner {
  private stopped = false;

  constructor(
    private readonly mailbox: FakeWerewolfDecisionMailbox,
    private readonly agentId: string,
    private readonly mock: WerewolfRandomMockAgent,
  ) {}

  async run(): Promise<void> {
    while (!this.stopped) {
      const claim = await this.mailbox.claimNextRequest(this.agentId);
      if (!claim) {
        await sleep(15);
        continue;
      }
      const request = claim.statePayload as unknown as WerewolfDecisionRequest;
      let response: WerewolfDecisionResponse;
      try {
        response = await this.mock.requestDecision(request);
      } catch {
        // Strategy bug → don't submit; orchestrator will fall back.
        continue;
      }
      await this.mailbox.submitAction({
        requestId: claim.requestId,
        matchPk: claim.matchPk,
        agentId: claim.agentId,
        action: response.action as unknown as Record<string, unknown>,
        reasoningSummary: response.reasoningSummary
          ? (response.reasoningSummary as unknown as Record<string, unknown>)
          : null,
      });
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDeps(): WerewolfPostgresDeps & {
  mailbox: FakeWerewolfDecisionMailbox;
  registry: FakeWerewolfMatchRegistry;
  replayStore: InMemoryReplayEventStore;
} {
  const mailbox = new FakeWerewolfDecisionMailbox();
  const registry = new FakeWerewolfMatchRegistry();
  const replayStore = new InMemoryReplayEventStore();
  const artifactStore = new MemoryWerewolfMatchArtifactStore();
  const traceStore = new MemoryWerewolfDecisionTraceStore();
  return { mailbox, registry, replayStore, artifactStore, traceStore };
}

function buildAgentRecord(playerId: string): AgentRecord {
  return {
    id: randomUUID(),
    ownerId: randomUUID(),
    name: `agent-${playerId}`,
    description: null,
    protocol: 'longpoll',
    callbackUrl: null,
    authHeaderName: null,
    authHeaderValue: null,
    timeoutMs: 5_000,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('PostgresWerewolfOrchestrator (mailbox-backed)', () => {
  it('drives a 9-AI match end-to-end via the mailbox round-trip', async () => {
    const deps = buildDeps();
    const factory = new PostgresWerewolfOrchestrator(deps);
    const allocator = new CounterSequenceAllocator();

    // Build seats with longpoll agents. Each gets a deterministic mock so
    // the test is reproducible.
    const baseSeed = 'integration-mailbox-1';
    const initial = factory.orchestrator['matches']; // peek via prototype later
    void initial;

    // Build 9 records + agent adapters + loopback runners.
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const agentRecords = playerIds.map(buildAgentRecord);
    const matchPkPlaceholder = 'pre-allocated';  // matchPk is real after createMatch
    void matchPkPlaceholder;

    // We need matchPk before adapters can be built (it is in their config).
    // PostgresWerewolfOrchestrator does this internally — startMatch first
    // calls registry.createMatch (yielding matchPk) and then registers the
    // agents. To match that flow, we pre-create the match here, then build
    // adapters, then call startMatch with the seats.
    //
    // BUT startMatch itself calls registry.createMatch. To avoid creating
    // the match twice, we duck-type: feed the seats with adapters whose
    // matchPk is filled in by a closure that reads from a local Promise.
    //
    // Simpler: call registry.createMatch directly here once, then pass
    // the same gameId to startMatch — but FakeRegistry.createMatch
    // doesn't dedupe by gameId. So we make the FakeRegistry idempotent
    // by having it return the same matchPk for a re-used gameId.

    // Cleaner: extend FakeRegistry to dedupe by gameId.
    // Done inline below with a tiny wrapper.

    const registry = deps.registry;
    const originalCreate = registry.createMatch.bind(registry);
    registry.createMatch = async (input) => {
      const existing = registry['byGameId'].get(input.gameId);
      if (existing) {
        return { matchPk: existing, gameId: input.gameId, status: 'running', startedAt: Date.now() };
      }
      return originalCreate(input);
    };

    const gameId = `g-mailbox-${baseSeed}`;
    const created = await registry.createMatch({
      gameId,
      ownerId: null,
      seed: baseSeed,
      seats: [],
    });
    const matchPk = created.matchPk;

    const seats: WerewolfSeatSetup[] = playerIds.map((pid, i) => {
      const record = agentRecords[i]!;
      // Construct adapter directly so the test can use a fast poll
      // interval — the helper buildAgentForRecord uses production defaults.
      const agent = new WerewolfMailboxAgentAdapter({
        agentId: record.id,
        name: record.name,
        matchPk,
        mailbox: deps.mailbox,
        sequenceAllocator: allocator,
        waitTimeoutMs: 3_000,
        pollIntervalMs: 25,
      });
      return {
        playerId: pid,
        seatIndex: i,
        displayName: record.name,
        agent,
        agentId: record.id,
      };
    });

    // Stand up loopback runners that drain the mailbox per agent.
    const runners = playerIds.map((pid, i) => {
      const record = agentRecords[i]!;
      const mock = new WerewolfRandomMockAgent(record.id, record.name, {
        seed: `${baseSeed}-${pid}`,
      });
      return new LoopbackRunner(deps.mailbox, record.id, mock);
    });
    const runnerPromises = runners.map((r) => r.run());

    const started = await factory.startMatch({
      gameId,
      seed: baseSeed,
      ownerId: null,
      seats,
      defaultTimeoutMs: 5_000,
    });
    expect(started.matchPk).toBe(matchPk);

    let summary;
    try {
      summary = await started.run();
    } finally {
      runners.forEach((r) => r.stop());
      // Don't await runnerPromises — they exit on their own next tick.
      void runnerPromises;
    }

    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.finalPlayers).toHaveLength(9);
    expect(summary.replayEventCount).toBeGreaterThan(0);

    // Live replay-event ingestion populated the in-memory store.
    const liveEvents = await deps.replayStore.listEvents(matchPk);
    expect(liveEvents.length).toBeGreaterThan(0);
    expect(liveEvents.some((e) => e.eventType === 'match.completed')).toBe(true);

    // The mailbox handled at least one full request/action round per
    // step.  9 agents × multiple decisions per match = lots of rows.
    const counts = deps.mailbox.size();
    expect(counts.requests).toBeGreaterThan(0);
    expect(counts.actions).toBeGreaterThan(0);
  }, 30_000);

  it('falls back to werewolfFallback when an agent never submits', async () => {
    const deps = buildDeps();
    const factory = new PostgresWerewolfOrchestrator(deps);
    const allocator = new CounterSequenceAllocator();

    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const agentRecords = playerIds.map(buildAgentRecord);

    const registry = deps.registry;
    const originalCreate = registry.createMatch.bind(registry);
    registry.createMatch = async (input) => {
      const existing = registry['byGameId'].get(input.gameId);
      if (existing) {
        return { matchPk: existing, gameId: input.gameId, status: 'running', startedAt: Date.now() };
      }
      return originalCreate(input);
    };

    const gameId = 'g-mailbox-silent';
    const created = await registry.createMatch({
      gameId,
      ownerId: null,
      seed: 'silent',
      seats: [],
    });
    const matchPk = created.matchPk;

    // Silence p1 — every request to it will time out and trigger fallback.
    deps.mailbox.silenceAgent(agentRecords[0]!.id);

    const seats: WerewolfSeatSetup[] = playerIds.map((pid, i) => {
      const record = agentRecords[i]!;
      const agent = new WerewolfMailboxAgentAdapter({
        agentId: record.id,
        name: record.name,
        matchPk,
        mailbox: deps.mailbox,
        sequenceAllocator: allocator,
        // Tight wait so silent decisions resolve quickly. Active agents
        // submit within ~25ms, so 200ms is plenty for the happy path.
        waitTimeoutMs: 200,
        pollIntervalMs: 20,
      });
      return {
        playerId: pid,
        seatIndex: i,
        displayName: record.name,
        agent,
        agentId: record.id,
      };
    });

    // Loopback runners for the non-silent agents only.
    const runners = playerIds.slice(1).map((pid, idx) => {
      const i = idx + 1;
      const record = agentRecords[i]!;
      const mock = new WerewolfRandomMockAgent(record.id, record.name, {
        seed: `silent-${pid}`,
      });
      return new LoopbackRunner(deps.mailbox, record.id, mock);
    });
    runners.forEach((r) => void r.run());

    const started = await factory.startMatch({
      gameId,
      seed: 'silent',
      ownerId: null,
      seats,
      defaultTimeoutMs: 250,
    });

    let summary;
    try {
      summary = await started.run();
    } finally {
      runners.forEach((r) => r.stop());
    }

    // Match must still complete — the silent agent's timeouts feed
    // werewolfFallback, which always returns a valid action.
    expect(['good', 'werewolf']).toContain(summary.winner);
    expect(summary.finalPlayers).toHaveLength(9);
  }, 60_000);
});
