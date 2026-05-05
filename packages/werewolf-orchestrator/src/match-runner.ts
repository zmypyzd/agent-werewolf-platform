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
import { WerewolfDecisionResponseSchema } from '@agent-poker/agent-protocol';
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
    const winner = this.state.winner;
    if (winner === null) {
      // Defense-in-depth: the loop only exits on phase==='game-over', and the
      // engine's reducer is responsible for setting winner before that. If this
      // ever fires, it is an engine invariant violation and we should not pretend
      // to produce a valid summary.
      throw new Error(
        `WerewolfMatchRunner: phase==='game-over' but winner is null for game ${this.state.gameId}`,
      );
    }
    // Emit match.completed FIRST so the post-emit replayEventCount is the true
    // total broadcast count — no off-by-one workaround needed for the summary.
    this.emit('match.completed', {
      gameId: this.state.gameId,
      winner,
      durationMs: completedAt - startedAt,
      stepCount: this.stepCount,
    });

    return buildWerewolfMatchSummary({
      initialState: this.initialState,
      finalState: this.state,
      startedAt,
      completedAt,
      replayEventCount: this.replayEventCount,
      stepCount: this.stepCount,
    });
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
        phase: phaseBefore,
        elapsedMs,
        fallbackAction: sanitizeActionForBroadcast(action),
      });
    } else {
      // Defense-in-depth: re-parse the response against the wire schema before
      // trusting it. Mock agents satisfy WerewolfDecisionResponse at compile
      // time, but Plan 4's HTTP/WS adapters will return deserialised JSON, and
      // even an in-process agent could violate the schema (oversized speak
      // content, missing fields, unknown action.type). A schema failure flows
      // into the same fallback path as an invalid-shape action.
      const parsed = WerewolfDecisionResponseSchema.safeParse(response);
      if (!parsed.success) {
        invalidReason = `agent response failed schema validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`;
        action = werewolfFallback(req).action;
        usedFallback = true;
        this.emit('agent.invalid_action', {
          requestId: req.requestId,
          agentId: agent.agentId,
          playerId: player.id,
          phase: phaseBefore,
          schemaFailure: true,
          reason: invalidReason,
          fallbackAction: sanitizeActionForBroadcast(action),
        });
      } else {
        const parsedAction = parsed.data.action as WerewolfAction;
        const validation = validateWerewolfAction(parsedAction, validActions);
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
            phase: phaseBefore,
            received: sanitizeActionForBroadcast(parsedAction),
            reason: invalidReason,
            fallbackAction: sanitizeActionForBroadcast(action),
          });
        }
      }
    }

    this.emit('agent.action_received', {
      requestId: req.requestId,
      agentId: agent.agentId,
      playerId: player.id,
      phase: phaseBefore,
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
