import { randomUUID } from 'crypto';
import type { EventEmitter } from 'events';
import type {
  WerewolfAction,
  WerewolfBriefing,
  WerewolfDecisionRequest,
  WerewolfDecisionResponse,
  WerewolfGameState,
  WerewolfPlayer,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfReasoningSummary,
} from '@agent-poker/shared';
import type { IWerewolfDecisionTraceStore } from '@agent-poker/persistence';
import { recordWerewolfDecisionTrace } from './decision-trace-recorder.js';
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
  readonly decisionTraceStore?: IWerewolfDecisionTraceStore;
  // Optional protocol briefing forwarded into every WerewolfDecisionRequest.
  // The API server fills this in from env when WEREWOLF_BRIEFING_ENABLED is
  // set; left undefined for local sims and tests so existing fixtures don't
  // churn.
  readonly briefing?: WerewolfBriefing;
}

const DEFAULT_MAX_STEPS = 10_000;

export class WerewolfMatchRunner {
  private state: WerewolfGameState;
  private readonly initialState: WerewolfGameState;
  private readonly maxSteps: number;
  private readonly decisionTraceStore: IWerewolfDecisionTraceStore | null;
  private readonly briefing: WerewolfBriefing | null;
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
    this.decisionTraceStore = options.decisionTraceStore ?? null;
    this.briefing = options.briefing ?? null;
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

    // Spectator broadcast view (ISSUE-005): match.started carries role+side
    // for every player so the web spectator surface can reveal the full
    // roster from t=0. Safe to put on the public realtime topic — agents
    // never read private info from this stream (they get it via the
    // decision-request envelope, which redacts), so the live-game info
    // isolation invariant is unaffected.
    this.emit('match.started', {
      gameId: this.state.gameId,
      seed: this.state.seed,
      players: this.state.players.map((p) => ({
        id: p.id,
        seatIndex: p.seatIndex,
        name: p.name,
        role: p.role,
        side: p.side,
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
    const publicState = getPublicState(this.state);
    const privateState = getPrivateState(this.state, player.id);
    const req = buildWerewolfDecisionRequest({
      requestId: randomUUID(),
      gameId: this.state.gameId,
      agentId: agent.agentId,
      playerId: player.id,
      publicState,
      privateState,
      validActions,
      deadlineMs: this.timeoutMs,
      ...(this.briefing ? { briefing: this.briefing } : {}),
    });

    // Non-replay private-state channel. Carries the requesting player's full
    // private state so per-player WS topic forwarders can push it. Deliberately
    // uses emitter.emit (not this.emit) so the event neither becomes a
    // WerewolfReplayEvent nor flows into bufferedEvents / persistence.
    this.emitter.emit('private-state', { playerId: player.id, privateState });

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
    let parsedActionForTrace: WerewolfAction | null = null;
    let parsedReasoningForTrace: WerewolfReasoningSummary | undefined;

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
        parsedActionForTrace = parsed.data.action as WerewolfAction;
        if (parsed.data.reasoningSummary) {
          parsedReasoningForTrace = parsed.data.reasoningSummary;
        }
        const parsedAction = parsedActionForTrace;
        const validation = validateWerewolfAction(parsedAction, validActions);
        // Reject day-speeches `speak` actions whose public `speech` field is
        // empty/whitespace. validActions[0] ships as an empty skeleton (the
        // engine's template), so an agent that just echoes it back appears
        // mute on the broadcast pane and we could not previously tell that
        // case apart from a real fallback. Forcing those into the fallback
        // path makes the failure observable via agent.invalid_action and
        // keeps the broadcast-visible behaviour identical (validActions[0]
        // is still the chosen surrogate).
        let rejectReason: string | null = null;
        if (!validation.valid) {
          rejectReason = validation.reason;
        } else if (
          parsedAction.type === 'speak' &&
          parsedAction.speech.trim().length === 0
        ) {
          rejectReason = 'empty-speech';
        }

        if (rejectReason === null) {
          action = parsedAction;
        } else {
          invalidReason = rejectReason;
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
      ...(!phaseBefore.startsWith('night-') && parsedReasoningForTrace
        ? { reasoningSummary: parsedReasoningForTrace }
        : {}),
    });

    // Snapshot the bits we need to diff after applyAction:
    //   - history length: lets us read back the entries appended by THIS
    //     action (death rows in particular) without scanning the whole
    //     match.
    //   - pkRound: the engine loops back into day-vote on tied votes WITHOUT
    //     changing phase (apply-action.ts:248). The reducer can't infer the
    //     PK round from the event stream alone, so we surface it here.
    const historyLenBefore = this.state.history.length;
    const pkRoundBefore = this.state.pendingDayVote?.pkRound ?? 0;

    this.state = applyAction(this.state, action);

    this.emit('engine.action_applied', {
      phase: phaseBefore,
      action: sanitizeActionForBroadcast(action),
      newPhase: this.state.phase,
    });

    // Deaths that landed during this action — read straight off the history
    // tail. Multiple can land in one tick (wolf-kill + witch-poison resolved
    // together at night-resolve). The engine already redacts night-actor
    // identity; deaths surface only at day-announce / day-resolve / hunter-
    // shoot transitions, which are public moments.
    const newHistory = this.state.history.slice(historyLenBefore);
    const eliminated = newHistory
      .filter((entry): entry is Extract<typeof entry, { type: 'death' }> => entry.type === 'death')
      .map((d) => ({ playerId: d.playerId, cause: d.cause }));

    // No-banishment outcome: the engine exhausts every PK round without a
    // strict majority and finalizes a vote with banished===null && tied===true.
    // The transition out of day-vote then carries no death — without this
    // signal the spectator UI silently skips from "PK 投票" into the next
    // night with nothing said about the flopped vote.
    const noBanishmentVote = newHistory.some(
      (entry) =>
        entry.type === 'vote' &&
        entry.record.banished === null &&
        entry.record.tied === true,
    );
    const dayVoteFlopped =
      noBanishmentVote && this.state.phase !== 'day-vote';

    const pkRoundAfter = this.state.pendingDayVote?.pkRound ?? 0;
    const pkCandidatesAfter = this.state.pendingDayVote?.pkCandidates ?? [];
    const phaseChanged = this.state.phase !== phaseBefore;
    // PK revote loop: phase stays day-vote but pkRound increments. Surface
    // this as a phase.changed event with pkRound so spectators see the new
    // round explicitly instead of mistaking 9 more vote events for "the same
    // round, slower".
    const pkRoundIncreased =
      this.state.phase === 'day-vote' && pkRoundAfter > pkRoundBefore;

    if (phaseChanged || pkRoundIncreased) {
      // Spectator UI consumes `phase`, `nightNumber`, `dayNumber` (see
      // apps/web/src/werewolf-room/werewolfRoomReducer.ts). `from` is omitted
      // because the previous phase is already implied by the prior event stream.
      // `eliminated`, `pkRound`, `pkCandidates` and `dayVoteOutcome` are
      // present only when meaningful, so old consumers that ignore them
      // keep working.
      this.emit('phase.changed', {
        phase: this.state.phase,
        nightNumber: this.state.nightNumber,
        dayNumber: this.state.dayNumber,
        ...(eliminated.length > 0 ? { eliminated } : {}),
        ...(pkRoundAfter > 0 ? { pkRound: pkRoundAfter } : {}),
        ...(pkRoundAfter > 0 && pkCandidatesAfter.length > 0
          ? { pkCandidates: [...pkCandidatesAfter] }
          : {}),
        ...(dayVoteFlopped ? { dayVoteOutcome: 'no-banishment' as const } : {}),
      });
    }

    if (this.decisionTraceStore) {
      // The decision trace store can reject a write for legitimate reasons
      // (ArtifactLimitExceededError when the per-trace 8KB cap fires on
      // an unusually long reasoning summary, or the per-match 1000-trace
      // cap fires after a marathon match). It can also reject for op
      // reasons (Postgres permission denied, network blip on the object
      // store). Decision traces are observability — they record what the
      // agent did but they aren't authoritative for game state. Letting
      // a trace failure abort the match would be a harsh tradeoff: a
      // 9-AI multi-hour run could collapse on the 1001st action because
      // the trace cap fired. Wrap and continue; the next decision still
      // tries to persist.
      try {
        await recordWerewolfDecisionTrace({
          store: this.decisionTraceStore,
          matchId: this.state.gameId,
          sequence: this.stepCount,
          requestId: req.requestId,
          agentId: agent.agentId,
          playerId: player.id,
          phase: phaseBefore,
          nightNumber: this.state.nightNumber,
          dayNumber: this.state.dayNumber,
          publicState,
          privateState,
          validActions,
          responseAction:
            timedOut || invalidReason !== null ? null : (parsedActionForTrace ?? null),
          appliedAction: action,
          latencyMs: elapsedMs,
          timedOut,
          invalidReason,
          fallbackReason: timedOut
            ? 'timeout'
            : invalidReason !== null
              ? 'invalid_action'
              : null,
          ...(parsedReasoningForTrace ? { reasoningSummary: parsedReasoningForTrace } : {}),
          now: Date.now(),
        });
      } catch (err) {
        // Surface to console.error rather than throwing — the orchestrator
        // has no structured logger. The error message includes the matchId
        // and sequence so ops can correlate to a specific decision.
        // eslint-disable-next-line no-console
        console.error(
          `[werewolf-match-runner] decision trace persist failed (matchId=${this.state.gameId} seq=${this.stepCount}): ${(err as Error).message}`,
        );
      }
    }
  }

  getFinalState(): WerewolfGameState {
    return this.state;
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
