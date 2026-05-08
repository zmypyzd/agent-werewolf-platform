import type {
  WerewolfPlayerId,
  WerewolfReplayEvent,
} from '@agent-poker/shared';
import {
  PostgresWerewolfDecisionTraceStore,
  PostgresWerewolfMatchArtifactStore,
  PostgresWerewolfMatchRegistry,
  PostgresWerewolfReplayEventStore,
  WerewolfDecisionMailbox,
  createServiceRoleClient,
  type AgentRecord,
  type IWerewolfDecisionMailbox,
  type IWerewolfDecisionTraceStore,
  type IWerewolfMatchArtifactStore,
  type IWerewolfMatchRegistry,
  type IWerewolfReplayEventStore,
  type SupabaseClientConfig,
  type SupabaseServiceClient,
} from '@agent-poker/persistence';
import {
  WerewolfHttpAgentAdapter,
  type IAgent,
} from '@agent-poker/agent-runtime';
import type { WerewolfDecisionRequest, WerewolfDecisionResponse } from '@agent-poker/shared';
import {
  CounterSequenceAllocator,
  WerewolfMailboxAgentAdapter,
  type SequenceAllocator,
} from './mailbox-agent-adapter.js';
import type { WerewolfMatchSummary } from './match-summary.js';
import { WerewolfOrchestrator } from './orchestrator.js';

type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

// One seat assignment for a match. The caller composes WerewolfAgent
// instances via buildAgentForRecord() (for registered external bots) or
// constructs them directly (for house bots / mocks). The factory does
// not pick agents — only the persistence + orchestration wire-up.
export interface WerewolfSeatSetup {
  readonly playerId: WerewolfPlayerId;
  readonly seatIndex: number;
  readonly displayName: string;
  readonly agent: WerewolfAgent;
  // The agents.id UUID, or null for house bots not registered in DB.
  // Stored on werewolf_seats so post-match queries can attribute decisions.
  readonly agentId: string | null;
}

export interface WerewolfPostgresMatchSetup {
  readonly gameId: string;
  readonly seed: string;
  readonly ownerId: string | null;
  readonly seats: ReadonlyArray<WerewolfSeatSetup>;
  readonly defaultTimeoutMs?: number;
}

export interface WerewolfPostgresStartedMatch {
  readonly matchId: string;
  readonly matchPk: string;
  readonly run: () => Promise<WerewolfMatchSummary>;
}

// Dependency-injection struct. Production callers use withSupabase() for
// the convenience path; tests pass fakes directly.
export interface WerewolfPostgresDeps {
  readonly registry: IWerewolfMatchRegistry;
  readonly mailbox: IWerewolfDecisionMailbox;
  readonly replayStore: IWerewolfReplayEventStore;
  readonly artifactStore: IWerewolfMatchArtifactStore;
  readonly traceStore: IWerewolfDecisionTraceStore;
}

// ───────────────────────────────────────────────────────────────────────
//  Factory
// ───────────────────────────────────────────────────────────────────────

export class PostgresWerewolfOrchestrator {
  // Underlying agent-agnostic orchestrator. Public so callers can attach
  // additional subscribers (private-state forwarders for SSE, etc.) before
  // calling run().
  public readonly orchestrator: WerewolfOrchestrator;

  constructor(private readonly deps: WerewolfPostgresDeps) {
    this.orchestrator = new WerewolfOrchestrator({
      artifactStore: deps.artifactStore,
      decisionTraceStore: deps.traceStore,
    });
  }

  static withSupabase(config: SupabaseClientConfig): PostgresWerewolfOrchestrator {
    const client = createServiceRoleClient(config);
    return new PostgresWerewolfOrchestrator(buildSupabaseDeps(client));
  }

  // Sets up the match in DB + in-memory orchestrator and returns a `run`
  // closure. Caller decides when to start (e.g. after attaching extra
  // subscribers, after agent runners come online). The returned run
  // promise resolves with the match summary; storage cleanup of the
  // replay-event subscription happens in finally.
  async startMatch(setup: WerewolfPostgresMatchSetup): Promise<WerewolfPostgresStartedMatch> {
    const created = await this.deps.registry.createMatch({
      gameId: setup.gameId,
      ownerId: setup.ownerId,
      seed: setup.seed,
      seats: setup.seats.map((s) => ({
        seatIndex: s.seatIndex,
        playerId: s.playerId,
        agentId: s.agentId,
        displayName: s.displayName,
      })),
    });

    const { matchId } = this.orchestrator.createMatch({
      gameId: setup.gameId,
      seed: setup.seed,
      ...(setup.defaultTimeoutMs !== undefined
        ? { defaultTimeoutMs: setup.defaultTimeoutMs }
        : {}),
    });

    for (const seat of setup.seats) {
      this.orchestrator.registerAgent(matchId, seat.playerId, seat.agent);
    }

    // Live replay-event ingestion. Errors here are logged but never block
    // the match — the final saveMatchArtifact call back-fills any rows
    // that didn't make it through (the upsert is idempotent on (match_id,
    // sequence)). This mirrors the resilience pattern in the reference
    // project's instrumentation.ts: persistent process must not crash on
    // ingestion errors mid-match.
    const replayStore = this.deps.replayStore;
    const matchPk = created.matchPk;
    const unsubscribe = this.orchestrator.subscribe(
      matchId,
      (event: WerewolfReplayEvent) => {
        // Fire-and-forget. Returning a promise from this listener is
        // intentional — Node's EventEmitter ignores async listeners but
        // this still queues the work.
        void replayStore.appendEvent(matchPk, event).catch((err) => {
          console.error(
            `werewolf-postgres: live replay-event ingestion failed (${event.eventType} seq=${event.sequence}): ${(err as Error).message}`,
          );
        });
      },
    );

    return {
      matchId,
      matchPk,
      run: async () => {
        try {
          return await this.orchestrator.runMatch(matchId);
        } finally {
          unsubscribe();
        }
      },
    };
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────

export function buildSupabaseDeps(client: SupabaseServiceClient): WerewolfPostgresDeps {
  const registry = new PostgresWerewolfMatchRegistry(client);
  const mailbox = new WerewolfDecisionMailbox(client);
  const replayStore = new PostgresWerewolfReplayEventStore(client);
  const artifactStore = new PostgresWerewolfMatchArtifactStore(client, { resolver: registry });
  const traceStore = new PostgresWerewolfDecisionTraceStore(client, { resolver: registry });
  return { registry, mailbox, replayStore, artifactStore, traceStore };
}

export interface BuildAgentForRecordOptions {
  readonly agentRecord: AgentRecord;
  readonly matchPk: string;
  readonly mailbox: IWerewolfDecisionMailbox;
  readonly sequenceAllocator: SequenceAllocator;
}

// Builds the right WerewolfAgent for a registered AgentRecord based on its
// protocol. House-bot ('inproc') agents are not built here — the caller
// must supply a WerewolfAgent for those (they cover everything from
// WerewolfNpcAgent to fully custom in-process strategies).
export function buildAgentForRecord(opts: BuildAgentForRecordOptions): WerewolfAgent {
  const a = opts.agentRecord;
  switch (a.protocol) {
    case 'http':
      if (!a.callbackUrl) {
        throw new Error(
          `buildAgentForRecord: agent ${a.id} (${a.name}) protocol=http requires callback_url`,
        );
      }
      return new WerewolfHttpAgentAdapter({
        agentId: a.id,
        name: a.name,
        endpointUrl: a.callbackUrl,
        ...(a.authHeaderName !== null ? { authHeaderName: a.authHeaderName } : {}),
        ...(a.authHeaderValue !== null ? { authHeaderValue: a.authHeaderValue } : {}),
        timeoutMs: a.timeoutMs,
      });
    case 'longpoll':
      return new WerewolfMailboxAgentAdapter({
        agentId: a.id,
        name: a.name,
        matchPk: opts.matchPk,
        mailbox: opts.mailbox,
        sequenceAllocator: opts.sequenceAllocator,
        // Mailbox wait timeout uses the agent's configured timeoutMs as
        // the upper bound. Sequence allocator is shared per-match.
        waitTimeoutMs: a.timeoutMs,
      });
    case 'inproc':
      throw new Error(
        `buildAgentForRecord: agent ${a.id} (${a.name}) is protocol=inproc; caller must supply a WerewolfAgent instance directly`,
      );
  }
}

export { CounterSequenceAllocator };
