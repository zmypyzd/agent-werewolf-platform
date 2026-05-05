import { EventEmitter } from 'events';
import type {
  WerewolfGameState,
  WerewolfPlayerId,
} from '@agent-poker/shared';
import { createGame } from '@agent-poker/werewolf-engine';
import {
  WerewolfMatchRunner,
  type WerewolfAgent,
  type WerewolfMatchRunnerOptions,
} from './match-runner.js';
import type { WerewolfMatchSummary } from './match-summary.js';
import type { WerewolfReplayEvent } from './replay-event.js';

export interface WerewolfMatchConfig {
  readonly gameId: string;
  readonly seed: string;
  readonly defaultTimeoutMs?: number;
}

interface MatchEntry {
  readonly initialState: WerewolfGameState;
  readonly agents: Map<WerewolfPlayerId, WerewolfAgent>;
  readonly emitter: EventEmitter;
  readonly defaultTimeoutMs: number;
  status: 'preparing' | 'running' | 'completed';
  summary: WerewolfMatchSummary | null;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class WerewolfOrchestrator {
  private readonly matches = new Map<string, MatchEntry>();

  createMatch(
    config: WerewolfMatchConfig,
  ): { matchId: string; initialState: WerewolfGameState } {
    if (this.matches.has(config.gameId)) {
      throw new Error(`WerewolfOrchestrator: match ${config.gameId} already exists`);
    }
    const initialState = createGame({ gameId: config.gameId, seed: config.seed });
    const entry: MatchEntry = {
      initialState,
      agents: new Map(),
      emitter: new EventEmitter(),
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      status: 'preparing',
      summary: null,
    };
    this.matches.set(config.gameId, entry);
    return { matchId: config.gameId, initialState };
  }

  registerAgent(
    matchId: string,
    playerId: WerewolfPlayerId,
    agent: WerewolfAgent,
  ): void {
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
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
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
    entry.emitter.on('replay-event', listener);
    return () => entry.emitter.off('replay-event', listener);
  }

  async runMatch(
    matchId: string,
    options: WerewolfMatchRunnerOptions = {},
  ): Promise<WerewolfMatchSummary> {
    const entry = this.matches.get(matchId);
    if (!entry) {
      throw new Error(`WerewolfOrchestrator: unknown match ${matchId}`);
    }
    if (entry.status === 'running') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} is already running`);
    }
    if (entry.status === 'completed') {
      throw new Error(`WerewolfOrchestrator: match ${matchId} already completed`);
    }
    entry.status = 'running';
    try {
      const runner = new WerewolfMatchRunner(
        entry.initialState,
        entry.agents,
        entry.defaultTimeoutMs,
        entry.emitter,
        options,
      );
      const summary = await runner.run();
      entry.summary = summary;
      entry.status = 'completed';
      return summary;
    } catch (err) {
      entry.status = 'preparing';
      throw err;
    }
  }

  getMatchSummary(matchId: string): WerewolfMatchSummary | null {
    return this.matches.get(matchId)?.summary ?? null;
  }
}
