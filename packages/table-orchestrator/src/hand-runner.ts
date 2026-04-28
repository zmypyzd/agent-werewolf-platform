import { createHash, randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type {
  GameState, HandSummary, HandPlayerSummary, HandResult, ReplayEvent,
  PlayerInHand, HandPhase, Pot, GameAction, BettingRoundState,
  PublicGameState, PublicPlayer, LegalAction, AgentDecisionRequest,
  AgentDecisionResponse, ActionType, DecisionTrace, DecisionTraceFallbackReason,
  DecisionTracePhase,
} from '@agent-poker/shared';
import {
  createShuffledDeck, deal,
  computeLegalActions, computePots, applyAction, isBettingRoundComplete,
  determineWinners, bestHandFrom7,
} from '@agent-poker/poker-engine';
import type { PotAward } from '@agent-poker/poker-engine';
import type { IAgent } from '@agent-poker/agent-runtime';
import { TimeoutHandler } from '@agent-poker/agent-runtime';
import type { IDecisionTraceStore, IHandStore } from '@agent-poker/persistence';

export class HandRunner {
  private eventSequence = 0;
  private replayEvents: ReplayEvent[] = [];

  constructor(
    private gameState: GameState,
    private agents: Map<string, IAgent>,
    private handStore: IHandStore,
    private emitter: EventEmitter,
    private timeoutMs: number,
    private decisionTraceStore: IDecisionTraceStore | null = null,
    private matchId: string = gameState.tableId,
  ) {}

  async run(): Promise<HandSummary> {
    const startedAt = Date.now();

    this.emit('hand.started', {
      handNumber: this.gameState.handNumber,
      seed: this.gameState.seed,
      playerIds: this.gameState.players.map(p => p.playerId),
      button: this.gameState.button,
      blindConfig: {
        smallBlind: this.getBigBlind() / 2,
        bigBlind: this.getBigBlind(),
        ante: 0,
      },
    });

    this.postBlinds();
    this.dealHoleCards();

    // Preflop
    await this.runBettingRound('preflop');

    // Check if hand is over after preflop
    if (!this.isHandOver()) {
      // Flop
      const [flop, d1] = deal(this.gameState.deck, 3);
      this.gameState = { ...this.gameState, deck: d1, communityCards: [...flop] };
      this.emit('community_cards.dealt', { phase: 'flop', cards: flop });
      await this.runBettingRound('flop');
    }

    if (!this.isHandOver()) {
      // Turn
      const [turn, d2] = deal(this.gameState.deck, 1);
      this.gameState = { ...this.gameState, deck: d2, communityCards: [...this.gameState.communityCards, ...turn] };
      this.emit('community_cards.dealt', { phase: 'turn', cards: turn });
      await this.runBettingRound('turn');
    }

    if (!this.isHandOver()) {
      // River
      const [river, d3] = deal(this.gameState.deck, 1);
      this.gameState = { ...this.gameState, deck: d3, communityCards: [...this.gameState.communityCards, ...river] };
      this.emit('community_cards.dealt', { phase: 'river', cards: river });
      await this.runBettingRound('river');
    }

    // Distribute pots
    const finalPots = this.computeFinalPots();
    const potAwards = this.runShowdown(finalPots);

    // Apply winnings
    for (const award of potAwards) {
      const splitPer = award.splitAmount;
      for (const winnerId of award.winnerIds) {
        const p = this.gameState.players.find(pl => pl.playerId === winnerId);
        if (p) {
          p.stack += splitPer + (award.remainderChipTo === winnerId ? (award.amount - splitPer * award.winnerIds.length) : 0);
        }
      }
      this.emit('pot.awarded', {
        potIndex: award.potIndex,
        amount: award.amount,
        winnerIds: award.winnerIds,
        splitAmount: award.splitAmount,
        reason: award.reason,
        ...(award.remainderChipTo ? { remainderChipTo: award.remainderChipTo } : {}),
      });
    }

    // Build results
    const results: HandResult[] = this.buildResults(potAwards);

    const completedAt = Date.now();

    const summary: HandSummary = {
      handId: this.gameState.handId,
      tableId: this.gameState.tableId,
      handNumber: this.gameState.handNumber,
      seed: this.gameState.seed,
      startedAt,
      completedAt,
      players: this.buildPlayerSummaries(),
      blindConfig: {
        smallBlind: this.getBigBlind() / 2,
        bigBlind: this.getBigBlind(),
        ante: 0,
      },
      communityCards: this.gameState.communityCards,
      allActions: this.gameState.allActions,
      results,
      finalPots,
    };

    this.emit('hand.completed', {
      handId: this.gameState.handId,
      handNumber: this.gameState.handNumber,
      durationMs: completedAt - startedAt,
      results,
      finalStacks: Object.fromEntries(this.gameState.players.map(p => [p.playerId, p.stack])),
    });

    // Save to store
    await this.handStore.saveHandSummary(summary);
    for (const evt of this.replayEvents) {
      await this.handStore.appendReplayEvent(evt);
    }

    return summary;
  }

  private getBigBlind(): number {
    // Get from gameState; we store it via the seed naming convention
    // The table config needs to be passed in — use a workaround
    return (this.gameState as GameState & { bigBlind?: number }).bigBlind ?? 50;
  }

  private postBlinds(): void {
    const players = this.gameState.players;
    const sbIdx = this.gameState.smallBlindIndex;
    const bbIdx = this.gameState.bigBlindIndex;
    const bb = this.getBigBlind();
    const sb = bb / 2;

    const sbPlayer = players[sbIdx];
    const bbPlayer = players[bbIdx];
    if (!sbPlayer || !bbPlayer) return;

    const sbAmount = Math.min(sb, sbPlayer.stack);
    sbPlayer.stack -= sbAmount;
    sbPlayer.totalBetInHand += sbAmount;
    sbPlayer.currentRoundBet += sbAmount;
    if (sbPlayer.stack === 0) sbPlayer.status = 'all-in';

    const bbAmount = Math.min(bb, bbPlayer.stack);
    bbPlayer.stack -= bbAmount;
    bbPlayer.totalBetInHand += bbAmount;
    bbPlayer.currentRoundBet += bbAmount;
    if (bbPlayer.stack === 0) bbPlayer.status = 'all-in';

    this.emit('blinds.posted', {
      smallBlind: { playerId: sbPlayer.playerId, amount: sbAmount, seatIndex: sbPlayer.seatIndex },
      bigBlind: { playerId: bbPlayer.playerId, amount: bbAmount, seatIndex: bbPlayer.seatIndex },
    });
  }

  private dealHoleCards(): void {
    let deck = this.gameState.deck;
    for (const player of this.gameState.players) {
      if (player.status === 'active') {
        const [cards, newDeck] = deal(deck, 2);
        deck = newDeck;
        player.holeCards = [cards[0]!, cards[1]!];
        this.emit('hole_cards.dealt', {
          playerId: player.playerId,
          holeCards: player.holeCards,
        });
      }
    }
    this.gameState = { ...this.gameState, deck };
  }

  private async runBettingRound(phase: DecisionTracePhase): Promise<void> {
    const activePlayers = this.gameState.players.filter(p => p.status === 'active' || p.status === 'all-in');
    const nonFoldedActive = this.gameState.players.filter(p => p.status === 'active');

    if (nonFoldedActive.length <= 1) return;

    // Reset currentRoundBet for all players at start of new round (except preflop which has blinds)
    if (phase !== 'preflop') {
      for (const p of this.gameState.players) {
        p.currentRoundBet = 0;
      }
    }

    const bb = this.getBigBlind();

    // Find first actor
    let firstActorIdx: number;
    if (phase === 'preflop') {
      // UTG = after BB
      firstActorIdx = this.nextActiveAfter(this.gameState.bigBlindIndex);
    } else {
      // First active player after button
      firstActorIdx = this.nextActiveAfter(this.gameState.button);
    }

    let roundState: BettingRoundState = {
      handId: this.gameState.handId,
      phase,
      players: this.gameState.players,
      currentActorIndex: firstActorIdx,
      currentRoundMinBet: phase === 'preflop' ? bb : 0,
      minRaiseAmount: bb,
      lastAggressorIndex: phase === 'preflop' ? this.gameState.bigBlindIndex : null,
      roundActions: [],
    };

    this.emit('betting_round.started', {
      phase,
      communityCards: this.gameState.communityCards,
      firstActorIndex: firstActorIdx,
    });

    let maxIterations = this.gameState.players.length * 10;

    while (!isBettingRoundComplete(roundState) && maxIterations-- > 0) {
      const actorIdx = roundState.currentActorIndex;
      const actor = roundState.players[actorIdx];
      if (!actor) break;

      if (actor.status !== 'active') {
        // Skip non-active players
        const nextIdx = this.findNextActive(roundState, actorIdx);
        if (nextIdx === null) break;
        roundState = { ...roundState, currentActorIndex: nextIdx };
        continue;
      }

      const legalActions = computeLegalActions(actor, roundState, bb);
      if (legalActions.length === 0) {
        const nextIdx = this.findNextActive(roundState, actorIdx);
        if (nextIdx === null) break;
        roundState = { ...roundState, currentActorIndex: nextIdx };
        continue;
      }

      const req = this.buildDecisionRequest(actor, roundState, legalActions);
      this.emit('action.requested', {
        agentId: actor.agentId,
        playerId: actor.playerId,
        legalActions,
        requestId: req.requestId,
        timeoutMs: req.timeoutMs,
      });

      const agentInstance = this.agents.get(actor.agentId);
      const decisionStartedAt = Date.now();
      let response: AgentDecisionResponse | null = null;
      let timedOut = false;
      let invalidReason: string | null = null;
      let fallbackReason: DecisionTraceFallbackReason | undefined;
      let action: AgentDecisionResponse;

      if (!agentInstance) {
        action = this.getFallback(legalActions, req.requestId, req.agentId);
        fallbackReason = 'missing_agent';
      } else {
        const handler = new TimeoutHandler(agentInstance, this.timeoutMs);
        const result = await handler.requestDecision(req);
        response = result.response;
        timedOut = result.timedOut;

        if (timedOut) {
          fallbackReason = 'timeout';
          this.emit('agent.timeout', {
            agentId: actor.agentId,
            requestId: req.requestId,
            elapsedMs: this.timeoutMs,
            fallbackAction: { actionType: response.actionType },
          });
        }

        const validated = this.validateAndNormalize(response, legalActions, req);
        action = validated.action;
        if (!validated.valid) {
          invalidReason = validated.reason;
          fallbackReason = timedOut ? 'timeout' : 'invalid_action';
          this.emit('agent.invalid_action', {
            agentId: actor.agentId,
            requestId: req.requestId,
            received: { actionType: response.actionType, amount: response.amount },
            reason: validated.reason,
            fallbackAction: { actionType: validated.action.actionType },
          });
        }

        this.emit('action.received', {
          agentId: actor.agentId,
          requestId: req.requestId,
          actionType: action.actionType,
          amount: action.amount,
          wasTimeout: timedOut,
          wasInvalid: !validated.valid,
        });
      }

      roundState = applyAction(roundState, {
        playerId: actor.playerId,
        actionType: action.actionType,
        amount: action.amount ?? 0,
      });

      const lastAction = roundState.roundActions[roundState.roundActions.length - 1]!;
      this.emit('action.applied', {
        actionId: lastAction.actionId,
        playerId: actor.playerId,
        phase,
        actionType: action.actionType,
        amount: lastAction.amount,
        stackAfter: lastAction.stackAfter,
        sequence: this.gameState.allActions.length,
        potTotal: roundState.players.reduce((s, p) => s + p.totalBetInHand, 0),
      });

      await this.appendDecisionTrace({
        req,
        actor,
        phase,
        response,
        lastAction,
        latencyMs: Date.now() - decisionStartedAt,
        timedOut,
        invalidReason,
        ...(fallbackReason !== undefined ? { fallbackReason } : {}),
      });

      // Sync game state players
      this.gameState = {
        ...this.gameState,
        players: roundState.players,
        allActions: [...this.gameState.allActions, lastAction],
      };
    }

    this.emit('betting_round.complete', {
      phase,
      pots: this.computeFinalPots(),
    });
  }

  private nextActiveAfter(seatIdx: number): number {
    const n = this.gameState.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (seatIdx + i) % n;
      if (this.gameState.players[idx]?.status === 'active') return idx;
    }
    return 0;
  }

  private findNextActive(state: BettingRoundState, currentIdx: number): number | null {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (currentIdx + i) % n;
      if (state.players[idx]?.status === 'active') return idx;
    }
    return null;
  }

  private buildDecisionRequest(
    actor: PlayerInHand,
    roundState: BettingRoundState,
    legalActions: LegalAction[],
  ): AgentDecisionRequest {
    const publicPlayers: PublicPlayer[] = roundState.players.map(p => ({
      playerId: p.playerId,
      seatIndex: p.seatIndex,
      stack: p.stack,
      status: p.status,
      totalBetInHand: p.totalBetInHand,
      currentRoundBet: p.currentRoundBet,
    }));

    const publicState: PublicGameState = {
      handId: this.gameState.handId,
      tableId: this.gameState.tableId,
      phase: roundState.phase,
      players: publicPlayers,
      communityCards: this.gameState.communityCards,
      pots: this.computeFinalPots(),
      button: this.gameState.button,
      smallBlindIndex: this.gameState.smallBlindIndex,
      bigBlindIndex: this.gameState.bigBlindIndex,
      currentActorIndex: roundState.currentActorIndex,
      currentRoundMinBet: roundState.currentRoundMinBet,
      minRaiseAmount: roundState.minRaiseAmount,
      allActions: this.gameState.allActions,
    };

    return {
      requestId: randomUUID(),
      handId: this.gameState.handId,
      tableId: this.gameState.tableId,
      agentId: actor.agentId,
      publicState,
      privateState: {
        playerId: actor.playerId,
        holeCards: actor.holeCards!,
      },
      legalActions,
      timeoutMs: this.timeoutMs,
    };
  }

  private validateAndNormalize(
    response: AgentDecisionResponse,
    legalActions: LegalAction[],
    req: AgentDecisionRequest,
  ): { valid: boolean; action: AgentDecisionResponse; reason: string } {
    const legal = legalActions.find(a => a.type === response.actionType);

    if (!legal) {
      const fallback = this.getFallback(legalActions, req.requestId, req.agentId);
      return { valid: false, action: fallback, reason: `Action ${response.actionType} not in legal actions` };
    }

    // Validate amounts
    if (response.actionType === 'bet' || response.actionType === 'raise') {
      const amount = response.amount ?? 0;
      if (legal.minAmount !== undefined && amount < legal.minAmount) {
        const fallback = this.getFallback(legalActions, req.requestId, req.agentId);
        return { valid: false, action: fallback, reason: `Amount ${amount} < minAmount ${legal.minAmount}` };
      }
      if (legal.maxAmount !== undefined && amount > legal.maxAmount) {
        const fallback = this.getFallback(legalActions, req.requestId, req.agentId);
        return { valid: false, action: fallback, reason: `Amount ${amount} > maxAmount ${legal.maxAmount}` };
      }
    }

    // For call, use the callAmount from legalActions
    if (response.actionType === 'call') {
      return { valid: true, action: { ...response, amount: legal.callAmount ?? 0 }, reason: '' };
    }

    return { valid: true, action: response, reason: '' };
  }

  private async appendDecisionTrace(input: {
    req: AgentDecisionRequest;
    actor: PlayerInHand;
    phase: DecisionTracePhase;
    response: AgentDecisionResponse | null;
    lastAction: GameAction;
    latencyMs: number;
    timedOut: boolean;
    invalidReason: string | null;
    fallbackReason?: DecisionTraceFallbackReason;
  }): Promise<void> {
    if (!this.decisionTraceStore) return;
    const { req, actor, phase, response, lastAction } = input;
    const trace: DecisionTrace = {
      traceId: randomUUID(),
      matchId: this.matchId,
      handId: req.handId,
      actionId: lastAction.actionId,
      requestId: req.requestId,
      agentId: req.agentId,
      playerId: actor.playerId,
      phase,
      publicStateHash: sha256Json(req.publicState),
      privateStateHash: sha256Json(req.privateState),
      legalActions: req.legalActions,
      responseAction: response
        ? {
            actionType: response.actionType,
            ...(response.amount !== undefined ? { amount: response.amount } : {}),
          }
        : null,
      appliedAction: {
        actionType: lastAction.actionType,
        amount: lastAction.amount,
        ...(input.fallbackReason !== undefined ? { fallbackReason: input.fallbackReason } : {}),
      },
      latencyMs: input.latencyMs,
      timedOut: input.timedOut,
      invalidReason: input.invalidReason,
      reasoningSummary: response?.reasoningSummary ?? null,
      createdAt: Date.now(),
    };
    await this.decisionTraceStore.appendDecisionTrace(trace);
  }

  private getFallback(legalActions: LegalAction[], requestId: string, agentId: string): AgentDecisionResponse {
    const hasCheck = legalActions.some(a => a.type === 'check');
    return {
      requestId,
      agentId,
      actionType: hasCheck ? 'check' : 'fold',
    };
  }

  private isHandOver(): boolean {
    const active = this.gameState.players.filter(p => p.status === 'active' || p.status === 'all-in');
    const nonFolded = active.filter(p => p.status !== 'folded');
    return nonFolded.filter(p => p.status === 'active').length === 0 ||
      this.gameState.players.filter(p => p.status === 'active' || p.status === 'all-in').length <= 1;
  }

  private computeFinalPots(): Pot[] {
    const contributions = this.gameState.players.map(p => ({
      playerId: p.playerId,
      totalBetInHand: p.totalBetInHand,
      status: p.status,
    }));
    return computePots(contributions);
  }

  private runShowdown(finalPots: Pot[]): PotAward[] {
    const nonFolded = this.gameState.players.filter(p => p.status !== 'folded');

    if (nonFolded.length === 1) {
      // Uncontested — winner gets all; stack changes applied by caller
      const winner = nonFolded[0]!;
      return finalPots.map((pot, i): PotAward => ({
        potIndex: i,
        amount: pot.amount,
        winnerIds: [winner.playerId],
        splitAmount: pot.amount,
        reason: 'uncontested',
      }));
    }

    // Multiple players — evaluate hands
    this.emit('showdown.started', {
      players: nonFolded.map(p => ({
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        holeCards: p.holeCards,
      })),
    });

    const playerHands = new Map<string, ReturnType<typeof bestHandFrom7>>();
    for (const p of nonFolded) {
      if (p.holeCards) {
        const sevenCards = [...p.holeCards, ...this.gameState.communityCards];
        const eval7 = sevenCards.length >= 5 ? bestHandFrom7(sevenCards) : bestHandFrom7([...sevenCards, ...sevenCards].slice(0, 5));
        playerHands.set(p.playerId, eval7);

        this.emit('showdown.result', {
          playerId: p.playerId,
          holeCards: p.holeCards,
          bestCards: eval7.bestCards,
          category: eval7.category,
          description: eval7.description,
        });
      }
    }

    // Button seat order for tie-break
    const buttonSeatOrder = [...this.gameState.players]
      .sort((a, b) => {
        const da = (a.seatIndex - this.gameState.button + this.gameState.players.length) % this.gameState.players.length;
        const db = (b.seatIndex - this.gameState.button + this.gameState.players.length) % this.gameState.players.length;
        return da - db;
      })
      .map(p => p.playerId);

    const awards = determineWinners(finalPots, playerHands, buttonSeatOrder);
    return awards;
  }

  private buildResults(potAwards: Array<{ potIndex: number; amount: number; winnerIds: string[]; splitAmount: number; remainderChipTo?: string; reason: string }>): HandResult[] {
    const results: HandResult[] = [];

    for (const award of potAwards) {
      for (const winnerId of award.winnerIds) {
        const player = this.gameState.players.find(p => p.playerId === winnerId);
        if (!player) continue;
        const winAmount = award.splitAmount + (award.remainderChipTo === winnerId ? award.amount - award.splitAmount * award.winnerIds.length : 0);
        results.push({
          playerId: winnerId,
          seatIndex: player.seatIndex,
          potIndex: award.potIndex,
          winAmount,
          netChange: winAmount - player.totalBetInHand,
        });
      }
    }

    // Add 0-win entries for losers
    for (const player of this.gameState.players) {
      if (!results.some(r => r.playerId === player.playerId)) {
        results.push({
          playerId: player.playerId,
          seatIndex: player.seatIndex,
          potIndex: 0,
          winAmount: 0,
          netChange: -player.totalBetInHand,
        });
      }
    }

    return results;
  }

  private buildPlayerSummaries(): HandPlayerSummary[] {
    return this.gameState.players.map(p => {
      const sevenCards = p.holeCards ? [...p.holeCards, ...this.gameState.communityCards] : [];
      const handEval = sevenCards.length >= 5 ? bestHandFrom7(sevenCards) : undefined;
      return {
        playerId: p.playerId,
        agentId: p.agentId,
        seatIndex: p.seatIndex,
        stackBefore: p.stackBefore,
        stackAfter: p.stack,
        holeCards: p.holeCards ?? [{ rank: '2', suit: 'c' }, { rank: '3', suit: 'd' }],
        ...(handEval ? { handEvaluation: handEval } : {}),
      };
    });
  }

  private emit(eventType: string, data: Record<string, unknown>): void {
    const event: ReplayEvent = {
      eventId: randomUUID(),
      handId: this.gameState.handId,
      tableId: this.gameState.tableId,
      sequence: this.eventSequence++,
      eventType,
      timestamp: Date.now(),
      data,
    };
    this.replayEvents.push(event);
    this.emitter.emit(eventType, event);
    // Catch-all channel so the orchestrator (and tests) can fan out every
    // ReplayEvent to one listener — e.g. the RealtimeHub for WS broadcast.
    this.emitter.emit('replay-event', event);
  }

  getGameState(): GameState {
    return this.gameState;
  }

  getPlayers(): PlayerInHand[] {
    return this.gameState.players;
  }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
