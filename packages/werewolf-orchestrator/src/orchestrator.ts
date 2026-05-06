import { EventEmitter } from 'events';
import type {
  WerewolfGameState,
  WerewolfPlayerId,
  WerewolfPrivateState,
  WerewolfReplayEvent,
} from '@agent-poker/shared';
import type {
  IWerewolfMatchArtifactStore,
  IWerewolfDecisionTraceStore,
  BuildWerewolfArtifactInput,
} from '@agent-poker/persistence';
import { createGame } from '@agent-poker/werewolf-engine';
import {
  WerewolfMatchRunner,
  type WerewolfAgent,
  type WerewolfMatchRunnerOptions,
} from './match-runner.js';
import type { WerewolfMatchSummary } from './match-summary.js';

export interface WerewolfMatchConfig {
  readonly gameId: string;
  readonly seed: string;
  readonly defaultTimeoutMs?: number;
}

export interface WerewolfOrchestratorOptions {
  readonly artifactStore?: IWerewolfMatchArtifactStore;
  readonly decisionTraceStore?: IWerewolfDecisionTraceStore;
}

export interface WerewolfPrivateStateEvent {
  readonly playerId: WerewolfPlayerId;
  readonly privateState: WerewolfPrivateState;
}

type MatchStatus = 'preparing' | 'running' | 'completed' | 'failed';

interface MatchEntry {
  readonly initialState: WerewolfGameState;
  readonly agents: Map<WerewolfPlayerId, WerewolfAgent>;
  readonly emitter: EventEmitter;
  readonly defaultTimeoutMs: number;
  readonly bufferedEvents: WerewolfReplayEvent[];
  status: MatchStatus;
  summary: WerewolfMatchSummary | null;
  finalState: WerewolfGameState | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class WerewolfOrchestrator {
  private readonly matches = new Map<string, MatchEntry>();
  private readonly artifactStore: IWerewolfMatchArtifactStore | null;
  private readonly decisionTraceStore: IWerewolfDecisionTraceStore | null;

  constructor(options: WerewolfOrchestratorOptions = {}) {
    this.artifactStore = options.artifactStore ?? null;
    this.decisionTraceStore = options.decisionTraceStore ?? null;
  }

  createMatch(
    config: WerewolfMatchConfig,
  ): { matchId: string; initialState: WerewolfGameState } {
    if (this.matches.has(config.gameId)) {
      throw new Error(`WerewolfOrchestrator: match ${config.gameId} already exists`);
    }
    const initialState = createGame({ gameId: config.gameId, seed: config.seed });
    const emitter = new EventEmitter();
    const bufferedEvents: WerewolfReplayEvent[] = [];
    emitter.on('replay-event', (e: WerewolfReplayEvent) => bufferedEvents.push(e));
    const entry: MatchEntry = {
      initialState,
      agents: new Map(),
      emitter,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      bufferedEvents,
      status: 'preparing',
      summary: null,
      finalState: null,
    };
    this.matches.set(config.gameId, entry);
    return { matchId: config.gameId, initialState };
  }

  registerAgent(
    matchId: string,
    playerId: WerewolfPlayerId,
    agent: WerewolfAgent,
  ): void {
    const entry = this.requireEntry(matchId);
    if (entry.status !== 'preparing') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is ${entry.status}; cannot register agents`);
    }
    if (!entry.initialState.players.some((p) => p.id === playerId)) {
      throw new Error(`WerewolfOrchestrator: unknown player ${playerId} in match ${matchId}`);
    }
    entry.agents.set(playerId, agent);
  }

  subscribe(
    matchId: string,
    listener: (event: WerewolfReplayEvent) => void,
  ): () => void {
    const entry = this.requireEntry(matchId);
    entry.emitter.on('replay-event', listener);
    return () => entry.emitter.off('replay-event', listener);
  }

  subscribePrivate(
    matchId: string,
    listener: (event: WerewolfPrivateStateEvent) => void,
  ): () => void {
    const entry = this.requireEntry(matchId);
    entry.emitter.on('private-state', listener);
    return () => entry.emitter.off('private-state', listener);
  }

  async runMatch(
    matchId: string,
    options: WerewolfMatchRunnerOptions = {},
  ): Promise<WerewolfMatchSummary> {
    const entry = this.requireEntry(matchId);
    if (entry.status === 'running') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is already running`);
    }
    if (entry.status === 'completed') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} already completed`);
    }
    if (entry.status === 'failed') {
      throw new Error(
        `WerewolfOrchestrator: match ${matchId} failed previously and cannot be re-run`,
      );
    }
    entry.status = 'running';
    try {
      // Merge the orchestrator-level decisionTraceStore into the runner options
      // so traces are recorded automatically when the orchestrator owns a store.
      // Callers can override by passing their own store in `options`.
      const runnerOptions: WerewolfMatchRunnerOptions = {
        ...(this.decisionTraceStore !== null
          ? { decisionTraceStore: this.decisionTraceStore }
          : {}),
        ...options,
      };
      const runner = new WerewolfMatchRunner(
        entry.initialState,
        entry.agents,
        entry.defaultTimeoutMs,
        entry.emitter,
        runnerOptions,
      );
      const summary = await runner.run();
      entry.summary = summary;
      entry.finalState = runner.getFinalState();
      entry.status = 'completed';
      if (this.artifactStore) {
        // Persistence errors propagate to the caller. The match itself
        // already succeeded — entry.summary stays accessible via
        // getMatchSummary so the in-memory result is not lost. We
        // deliberately do NOT roll the entry back to 'failed': a save
        // failure (size cap, transient I/O) is a different fault domain
        // from a game-loop failure, and conflating them would block a
        // legitimate completed match from being re-read.
        await this.persistArtifact(matchId, entry, summary);
      }
      return summary;
    } catch (err) {
      // Only flip to 'failed' if the game loop itself errored. If the
      // throw came from persistArtifact above, status is already
      // 'completed' and we leave it that way (see comment above).
      if (entry.status !== 'completed') {
        entry.status = 'failed';
      }
      throw err;
    }
  }

  getMatchSummary(matchId: string): WerewolfMatchSummary | null {
    return this.matches.get(matchId)?.summary ?? null;
  }

  // Lifecycle: explicitly remove a match from in-memory state. Does NOT
  // delete persisted artifacts (callers can do that by calling the store's
  // deleteMatchArtifact directly). Idempotent.
  deleteMatch(matchId: string): boolean {
    return this.matches.delete(matchId);
  }

  private requireEntry(matchId: string): MatchEntry {
    const entry = this.matches.get(matchId);
    if (!entry) throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    return entry;
  }

  private async persistArtifact(
    matchId: string,
    entry: MatchEntry,
    summary: WerewolfMatchSummary,
  ): Promise<void> {
    if (!this.artifactStore || !entry.finalState) return;
    const decisionTraces = this.decisionTraceStore
      ? await this.decisionTraceStore.listDecisionTraces(matchId)
      : [];
    const input: BuildWerewolfArtifactInput = {
      matchId,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      nightCount: summary.nightCount,
      dayCount: summary.dayCount,
      stepCount: summary.stepCount,
      replayEventCount: summary.replayEventCount,
      winner: summary.winner,
      finalPlayers: summary.finalPlayers,
      fullHistory: entry.finalState.history,
      replayEvents: entry.bufferedEvents,
      decisionTraces,
    };
    await this.artifactStore.saveMatchArtifact(input);
  }
}
