import { randomUUID } from 'crypto';
import type { EventEmitter } from 'events';
import type {
  WerewolfAction,
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
  WerewolfPlayer,
  WerewolfPhase,
  WerewolfPlayerId,
} from '@agent-poker/shared';
import {
  applyAction,
  getPrivateState,
  getPublicState,
  getValidActions,
  startFirstNight,
} from '@agent-poker/werewolf-engine';
import {
  TimeoutHandler,
  buildWerewolfDecisionRequest,
} from '@agent-poker/agent-runtime';
import type { IAgent } from '@agent-poker/agent-runtime';
import { validateWerewolfAction } from './action-validator.js';
import { werewolfFallback } from './werewolf-fallback.js';
import { sanitizeActionForBroadcast } from './sanitize-action.js';
import type { WerewolfReplayEvent, WerewolfReplayEventType } from './replay-event.js';
import {
  buildWerewolfMatchSummary,
  type WerewolfMatchSummary,
} from './match-summary.js';

export type WerewolfAgent = IAgent<WerewolfDecisionRequest, WerewolfDecisionResponse>;

export interface WerewolfMatchRunnerOptions {
  readonly maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 10_000;

export class WerewolfMatchRunner {
  private state: WerewolfGameState;
  private readonly initialState: WerewolfGameState;
  private readonly maxSteps: number;
  private replayEventCount = 0;
  private sequence = 0;
  private stepCount = 0;
  private hasRun = false;

  constructor(
    initialState: WerewolfGameState,
    private readonly agents: Map<WerewolfPlayerId, WerewolfAgent>,
    private readonly timeoutMs: number,
    private readonly emitter: EventEmitter,
    options: WerewolfMatchRunnerOptions = {},
  ) {
    this.initialState = initialState;
    this.state = initialState;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  async run(): Promise<WerewolfMatchSummary> {
    if (this.hasRun) {
      throw new Error(
        `WerewolfMatchRunner: run() already invoked on this instance for game ${this.state.gameId}`,
      );
    }
    this.hasRun = true;
    for (const p of this.state.players) {
      if (!this.agents.has(p.id)) {
        throw new Error(
          `WerewolfMatchRunner: missing agent for player ${p.id} (${p.name})`,
        );
      }
    }

    const startedAt = Date.now();

    if (this.state.phase === 'setup') {
      this.state = startFirstNight(this.state);
    }

    this.emit('match.started', {
      gameId: this.state.gameId,
      seed: this.state.seed,
      players: this.state.players.map((p) => ({
        id: p.id,
        seatIndex: p.seatIndex,
        name: p.name,
      })),
    });

    while (this.state.phase !== 'game-over') {
      if (this.stepCount >= this.maxSteps) {
        throw new Error(
          `WerewolfMatchRunner: exceeded ${this.maxSteps} steps without termination (phase=${this.state.phase})`,
        );
      }
      const actor = this.pickNextActor();
      if (!actor) {
        throw new Error(
          `WerewolfMatchRunner: deadlock — phase ${this.state.phase} has no actor with valid actions`,
        );
      }
      await this.runOneAction(actor.player, actor.validActions);
      this.stepCount++;
    }

    const completedAt = Date.now();
    const summary = buildWerewolfMatchSummary({
      initialState: this.initialState,
      finalState: this.state,
      startedAt,
      completedAt,
      replayEventCount: this.replayEventCount + 1, // +1 for match.completed about to fire
      stepCount: this.stepCount,
    });

    this.emit('match.completed', {
      gameId: this.state.gameId,
      winner: summary.winner,
      durationMs: completedAt - startedAt,
      stepCount: this.stepCount,
    });

    return summary;
  }

  private pickNextActor(): { player: WerewolfPlayer; validActions: WerewolfAction[] } | null {
    const sorted = [...this.state.players].sort((a, b) => a.seatIndex - b.seatIndex);
    for (const p of sorted) {
      const valid = getValidActions(this.state, p.id);
      if (valid.length > 0) return { player: p, validActions: valid };
    }
    return null;
  }

  private async runOneAction(
    player: WerewolfPlayer,
    validActions: WerewolfAction[],
  ): Promise<void> {
    const phaseBefore: WerewolfPhase = this.state.phase;
    const agent = this.agents.get(player.id)!;
    const req = buildWerewolfDecisionRequest({
      requestId: randomUUID(),
      gameId: this.state.gameId,
      agentId: agent.agentId,
      playerId: player.id,
      publicState: getPublicState(this.state),
      privateState: getPrivateState(this.state, player.id),
      validActions,
      deadlineMs: this.timeoutMs,
    });

    this.emit('agent.action_requested', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      phase: req.phase,
      validActionCount: validActions.length,
    });

    const handler = new TimeoutHandler<WerewolfDecisionRequest, WerewolfDecisionResponse>(
      agent,
      this.timeoutMs,
      werewolfFallback,
    );
    const startedAt = Date.now();
    const { response, timedOut } = await handler.requestDecision(req);
    const elapsedMs = Date.now() - startedAt;

    let action: WerewolfAction;
    let usedFallback = false;
    let invalidReason: string | null = null;

    if (timedOut) {
      action = response.action;
      usedFallback = true;
      this.emit('agent.timeout', {
        requestId: req.requestId,
        agentId: agent.agentId,
        playerId: player.id,
        elapsedMs,
        fallbackAction: sanitizeActionForBroadcast(action),
      });
    } else {
      const validation = validateWerewolfAction(response.action, validActions);
      if (validation.valid) {
        action = validation.action;
      } else {
        invalidReason = validation.reason;
        action = werewolfFallback(req).action;
        usedFallback = true;
        this.emit('agent.invalid_action', {
          requestId: req.requestId,
          agentId: agent.agentId,
          playerId: player.id,
          received: sanitizeActionForBroadcast(response.action),
          reason: invalidReason,
          fallbackAction: sanitizeActionForBroadcast(action),
        });
      }
    }

    this.emit('agent.action_received', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      action: sanitizeActionForBroadcast(action),
      usedFallback,
      timedOut,
      elapsedMs,
      ...(invalidReason !== null ? { invalidReason } : {}),
    });

    this.state = applyAction(this.state, action);

    this.emit('engine.action_applied', {
      phase: phaseBefore,
      action: sanitizeActionForBroadcast(action),
      newPhase: this.state.phase,
    });

    if (this.state.phase !== phaseBefore) {
      this.emit('phase.changed', { from: phaseBefore, to: this.state.phase });
    }
  }

  private emit(eventType: WerewolfReplayEventType, data: Record<string, unknown>): void {
    const event: WerewolfReplayEvent = {
      eventId: randomUUID(),
      gameId: this.state.gameId,
      sequence: this.sequence++,
      eventType,
      timestamp: Date.now(),
      data,
    };
    this.replayEventCount++;
    this.emitter.emit(eventType, event);
    this.emitter.emit('replay-event', event);
  }
}
