import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type {
  TableConfig, TableState, SeatInfo, AgentInfo, HandSummary,
  PlayerInHand, GameState, PublicGameState, PublicPlayer, SeatAdapterType,
  ActionType,
} from '@agent-poker/shared';
import {
  TableFullError, HandInProgressError, NotFoundError,
  NotEnoughPlayersError, ForbiddenError, SeatTakenError,
  ActionConflictError, InvalidActionError,
  MIN_PLAYERS, DEFAULT_TIMEOUT_MS,
} from '@agent-poker/shared';
import { createShuffledDeck } from '@agent-poker/poker-engine';
import type { IAgent } from '@agent-poker/agent-runtime';
import { HumanAgent } from '@agent-poker/agent-runtime';
import { MemoryDecisionTraceStore, type IDecisionTraceStore, type IHandStore, type ITableStore } from '@agent-poker/persistence';
import type { RealtimeHub } from '@agent-poker/realtime';
import { replayEventToPublic } from '@agent-poker/realtime';
import { HandRunner } from './hand-runner.js';

interface TableEntry {
  tableState: TableState;
  agents: Map<string, IAgent>; // agentId → IAgent
  agentInfos: Map<string, AgentInfo>;
  currentGameState: GameState | null;
  handInProgress: boolean;
  ownerUserId: string | null;
  spectators: Set<string>; // userId
}

export interface SeatPlacement {
  ownerUserId: string;
  adapterType: SeatAdapterType;
  agentConfigId?: string | null;
}

export class TableOrchestrator {
  private tables = new Map<string, TableEntry>();

  constructor(
    private tableStore: ITableStore,
    private handStore: IHandStore,
    private hub: RealtimeHub | null = null,
    private decisionTraceStore: IDecisionTraceStore = new MemoryDecisionTraceStore(),
  ) {}

  async createTable(
    config: Omit<TableConfig, 'tableId'> & { seed?: string },
    ownerUserId: string | null = null,
  ): Promise<TableState> {
    const tableId = `tbl-${randomUUID().slice(0, 8)}`;
    const fullConfig: TableConfig = {
      ...config,
      tableId,
      seed: config.seed ?? randomUUID(),
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    const tableState: TableState = {
      tableId,
      config: fullConfig,
      status: 'preparing',
      seats: Array(fullConfig.maxSeats).fill(null) as null[],
      currentHandId: null,
      handNumber: 0,
      button: 0,
      createdAt: Date.now(),
    };

    this.tables.set(tableId, {
      tableState,
      agents: new Map(),
      agentInfos: new Map(),
      currentGameState: null,
      handInProgress: false,
      ownerUserId,
      spectators: new Set<string>(),
    });

    await this.tableStore.saveTable(tableState);
    this.publishLobbyUpdate('lobby.table_created', tableState);
    return tableState;
  }

  private publishLobbyUpdate(type: string, table: TableState): void {
    if (!this.hub) return;
    this.hub.publishLobby(type, this.summarize(table));
  }

  // The TableSummary shape used by GET /tables and lobby.* events.
  summarize(table: TableState): {
    tableId: string;
    tableName: string;
    status: TableState['status'];
    seatedCount: number;
    maxSeats: number;
    spectatorCount: number;
    blinds: TableConfig['blindConfig'];
    canSit: boolean;
    currentHandId: string | null;
  } {
    const entry = this.tables.get(table.tableId);
    const seatedCount = table.seats.filter(s => s !== null).length;
    const hasEmptySeat = table.seats.some(s => s === null);
    const canSit = hasEmptySeat && (table.status === 'preparing' || table.status === 'paused');
    return {
      tableId: table.tableId,
      tableName: table.config.name,
      status: table.status,
      seatedCount,
      maxSeats: table.config.maxSeats,
      spectatorCount: entry?.spectators.size ?? 0,
      blinds: table.config.blindConfig,
      canSit,
      currentHandId: table.currentHandId,
    };
  }

  getTableOwnerUserId(tableId: string): string | null {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    return entry.ownerUserId;
  }

  async getTable(tableId: string): Promise<TableState> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    return entry.tableState;
  }

  async listTables(): Promise<TableState[]> {
    return [...this.tables.values()].map(e => e.tableState);
  }

  async deleteTable(tableId: string, callerUserId?: string): Promise<void> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (
      callerUserId !== undefined &&
      entry.ownerUserId !== null &&
      entry.ownerUserId !== callerUserId
    ) {
      throw new ForbiddenError(`Table ${tableId} is not owned by ${callerUserId}`);
    }
    this.tables.delete(tableId);
    await this.tableStore.deleteTable(tableId);
  }

  async closeTable(tableId: string, callerUserId?: string): Promise<TableState> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (
      callerUserId !== undefined &&
      entry.ownerUserId !== null &&
      entry.ownerUserId !== callerUserId
    ) {
      throw new ForbiddenError(`Table ${tableId} is not owned by ${callerUserId}`);
    }
    if (entry.tableState.status === 'in_hand') throw new HandInProgressError(tableId);
    entry.tableState.status = 'completed';
    await this.tableStore.saveTable(entry.tableState);
    return entry.tableState;
  }

  async addAgent(
    tableId: string,
    agentInfo: Omit<AgentInfo, 'registeredAt'>,
    agent: IAgent,
    buyIn: number,
    placement?: SeatPlacement,
    seatIndex?: number,
  ): Promise<SeatInfo> {
    const seat = placement ?? {
      ownerUserId: `sys-${agentInfo.agentId}`,
      adapterType: 'mock' as const,
    };
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (entry.tableState.status === 'in_hand') throw new HandInProgressError(tableId);
    if (entry.tableState.status === 'completed') {
      throw new ForbiddenError(`Table ${tableId} is closed`);
    }

    const { tableState } = entry;
    let targetIdx: number;
    if (seatIndex !== undefined) {
      if (seatIndex < 0 || seatIndex >= tableState.seats.length) {
        throw new ForbiddenError(`Seat ${seatIndex} out of range`);
      }
      if (tableState.seats[seatIndex] !== null) throw new SeatTakenError(tableId, seatIndex);
      targetIdx = seatIndex;
    } else {
      const emptyIdx = tableState.seats.findIndex(s => s === null);
      if (emptyIdx === -1) throw new TableFullError(tableId);
      targetIdx = emptyIdx;
    }

    if (
      seat.adapterType === 'human' &&
      tableState.seats.some(s => s?.ownerUserId === seat.ownerUserId && s.adapterType === 'human')
    ) {
      throw new ForbiddenError(`User ${seat.ownerUserId} already holds a seat at ${tableId}`);
    }

    const playerId = `player-${agentInfo.agentId}`;
    const seatInfo: SeatInfo = {
      seatIndex: targetIdx,
      agentId: agentInfo.agentId,
      playerId,
      stack: buyIn,
      status: 'waiting',
      ownerUserId: seat.ownerUserId,
      adapterType: seat.adapterType,
      agentConfigId: seat.agentConfigId ?? null,
      sitOutNextHand: false,
      joinedAt: Date.now(),
    };

    tableState.seats[targetIdx] = seatInfo;

    const fullInfo: AgentInfo = { ...agentInfo, registeredAt: Date.now() };
    entry.agents.set(agentInfo.agentId, agent);
    entry.agentInfos.set(agentInfo.agentId, fullInfo);

    await this.tableStore.saveTable(tableState);
    this.hub?.publishTable(tableId, 'table.player_seated', {
      seatIndex: seatInfo.seatIndex,
      playerId: seatInfo.playerId,
      adapterType: seatInfo.adapterType,
      stack: seatInfo.stack,
    });
    this.publishLobbyUpdate('lobby.table_updated', tableState);
    return seatInfo;
  }

  async removeAgent(
    tableId: string,
    agentId: string,
    callerUserId?: string,
  ): Promise<void> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (entry.tableState.status === 'in_hand') throw new HandInProgressError(tableId);

    const { tableState } = entry;
    const seatIdx = tableState.seats.findIndex(s => s?.agentId === agentId);
    if (seatIdx === -1) throw new NotFoundError('Agent', agentId);

    const seat = tableState.seats[seatIdx]!;
    if (callerUserId !== undefined && seat.ownerUserId !== callerUserId) {
      throw new ForbiddenError(`Seat ${seatIdx} is not owned by ${callerUserId}`);
    }

    tableState.seats[seatIdx] = null;
    entry.agents.delete(agentId);
    entry.agentInfos.delete(agentId);

    await this.tableStore.saveTable(tableState);
    this.hub?.publishTable(tableId, 'table.player_left', {
      seatIndex: seatIdx,
      reason: callerUserId === seat.ownerUserId ? 'voluntary' : 'admin',
    });
    this.publishLobbyUpdate('lobby.table_updated', tableState);
  }

  // ─── Spectators ─────────────────────────────────────────────────────────

  async addSpectator(tableId: string, userId: string): Promise<void> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    const max = entry.tableState.config.maxSpectators ?? 100;
    if (!entry.spectators.has(userId) && entry.spectators.size >= max) {
      throw new TableFullError(tableId);
    }
    const wasNew = !entry.spectators.has(userId);
    entry.spectators.add(userId);
    if (wasNew) {
      this.hub?.publishTable(tableId, 'table.viewer_joined', { userId });
      this.publishLobbyUpdate('lobby.table_updated', entry.tableState);
    }
  }

  async removeSpectator(tableId: string, userId: string): Promise<void> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (!entry.spectators.delete(userId)) return;
    this.hub?.publishTable(tableId, 'table.viewer_left', { userId });
    this.publishLobbyUpdate('lobby.table_updated', entry.tableState);
  }

  getSpectatorCount(tableId: string): number {
    return this.tables.get(tableId)?.spectators.size ?? 0;
  }

  // ─── Leave-seat with sit-out semantics ──────────────────────────────────

  async leaveSeat(
    tableId: string,
    callerUserId: string,
  ): Promise<{ status: 'left' | 'sit_out_next_hand'; seatIndex: number }> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);

    const seatIdx = entry.tableState.seats.findIndex(s => s?.ownerUserId === callerUserId);
    if (seatIdx === -1) throw new NotFoundError('Seat', `owned by ${callerUserId}`);
    const seat = entry.tableState.seats[seatIdx]!;

    if (entry.tableState.status === 'in_hand') {
      seat.sitOutNextHand = true;
      await this.tableStore.saveTable(entry.tableState);
      this.hub?.publishTable(tableId, 'table.player_left', {
        seatIndex: seatIdx,
        reason: 'sit_out_next_hand',
      });
      return { status: 'sit_out_next_hand', seatIndex: seatIdx };
    }

    await this.removeAgent(tableId, seat.agentId, callerUserId);
    return { status: 'left', seatIndex: seatIdx };
  }

  // ─── Agent-config lookup helper ─────────────────────────────────────────

  isAgentConfigInUse(agentConfigId: string): boolean {
    for (const entry of this.tables.values()) {
      for (const seat of entry.tableState.seats) {
        if (seat && seat.agentConfigId === agentConfigId) return true;
      }
    }
    return false;
  }

  assertSeatOwnedBy(tableId: string, seatIndex: number, userId: string): SeatInfo {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    const seat = entry.tableState.seats[seatIndex];
    if (!seat) throw new NotFoundError('Seat', `${tableId}#${seatIndex}`);
    if (seat.ownerUserId !== userId) {
      throw new ForbiddenError(`Seat ${seatIndex} is not owned by ${userId}`);
    }
    return seat;
  }

  // Resolve the pending decision request for the user's human seat. Throws:
  //   ForbiddenError       — caller has no human seat at this table
  //   ActionConflictError  — no pending request, or handId mismatch
  //   InvalidActionError   — action not in legalActions / amount out of bounds
  async submitHumanAction(
    tableId: string,
    callerUserId: string,
    action: { handId: string; actionType: ActionType; amount?: number },
  ): Promise<void> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);

    const seat = entry.tableState.seats.find(s => s?.ownerUserId === callerUserId);
    if (!seat) {
      throw new ForbiddenError(`User ${callerUserId} has no seat at ${tableId}`);
    }
    if (seat.adapterType !== 'human') {
      throw new ForbiddenError(`Seat ${seat.seatIndex} is not a human seat`);
    }

    const agent = entry.agents.get(seat.agentId);
    if (!(agent instanceof HumanAgent)) {
      throw new ActionConflictError(
        `Seat ${seat.seatIndex} is human but its agent is not a HumanAgent (impossible state)`,
      );
    }

    const pending = agent.pendingRequest;
    if (!pending) {
      throw new ActionConflictError('no pending request');
    }
    if (pending.handId !== action.handId) {
      throw new ActionConflictError(
        `handId mismatch (expected ${pending.handId}, got ${action.handId})`,
      );
    }

    const legal = pending.legalActions.find(la => la.type === action.actionType);
    if (!legal) {
      throw new InvalidActionError(
        `Action ${action.actionType} is not in the current legal actions`,
      );
    }
    if (action.actionType === 'bet' || action.actionType === 'raise') {
      const amount = action.amount ?? 0;
      if (legal.minAmount !== undefined && amount < legal.minAmount) {
        throw new InvalidActionError(`amount ${amount} below minAmount ${legal.minAmount}`);
      }
      if (legal.maxAmount !== undefined && amount > legal.maxAmount) {
        throw new InvalidActionError(`amount ${amount} above maxAmount ${legal.maxAmount}`);
      }
    }

    agent.submit(action);
  }

  async startHand(tableId: string): Promise<HandSummary> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    if (entry.handInProgress) throw new HandInProgressError(tableId);

    const { tableState } = entry;
    const seatedPlayers = tableState.seats.filter((s): s is SeatInfo => s !== null && s.stack > 0);

    if (seatedPlayers.length < MIN_PLAYERS) {
      throw new NotEnoughPlayersError(seatedPlayers.length);
    }

    entry.handInProgress = true;
    tableState.status = 'in_hand';

    const handNumber = tableState.handNumber + 1;
    const handId = `hand-${String(handNumber).padStart(3, '0')}-${randomUUID().slice(0, 6)}`;
    const seed = `${tableState.config.seed ?? 'default'}-${handNumber}`;

    // Advance button
    const buttonSeat = this.advanceButton(tableState, seatedPlayers);

    // Determine blind positions
    const { sbIdx, bbIdx, firstActorIdx } = this.computeBlindPositions(seatedPlayers, buttonSeat);

    // Build players for this hand
    const players: PlayerInHand[] = seatedPlayers.map(seat => ({
      playerId: seat.playerId,
      seatIndex: seat.seatIndex,
      agentId: seat.agentId,
      stackBefore: seat.stack,
      stack: seat.stack,
      status: 'active' as const,
      totalBetInHand: 0,
      currentRoundBet: 0,
      holeCards: null,
    }));

    const deck = createShuffledDeck(seed);

    const bigBlind = tableState.config.blindConfig.bigBlind;

    const gameState: GameState & { bigBlind: number } = {
      handId,
      tableId,
      phase: 'preflop',
      deck,
      players,
      communityCards: [],
      pots: [],
      button: buttonSeat,
      smallBlindIndex: sbIdx,
      bigBlindIndex: bbIdx,
      currentBettingRound: null,
      allActions: [],
      handNumber,
      seed,
      bigBlind,
    };

    tableState.currentHandId = handId;
    tableState.handNumber = handNumber;

    const emitter = new EventEmitter();
    const timeoutMs = tableState.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (this.hub) {
      const hub = this.hub;
      emitter.on('replay-event', (event: import('@agent-poker/shared').ReplayEvent) => {
        // Public broadcast (filtered: hole_cards.dealt is suppressed,
        // showdown.started has its holeCards stripped, defense-in-depth.)
        const pub = replayEventToPublic(event);
        if (pub) hub.publishTable(tableId, pub.eventType, pub.data);

        // Private fan-out for events that reveal information to a single user.
        if (event.eventType === 'hole_cards.dealt') {
          const playerId = String(event.data['playerId'] ?? '');
          const seat = tableState.seats.find(s => s?.playerId === playerId);
          const holeCards = event.data['holeCards'];
          if (seat && Array.isArray(holeCards) && holeCards.length === 2) {
            hub.publishSeat(seat.ownerUserId, tableId, 'seat.hole_cards', {
              handId: event.handId,
              playerId: seat.playerId,
              seatIndex: seat.seatIndex,
              agentId: seat.agentId,
              holeCards,
            });
          }
        }
        if (event.eventType === 'action.requested') {
          const agentId = String(event.data['agentId'] ?? '');
          const seat = tableState.seats.find(s => s?.agentId === agentId);
          if (seat && seat.adapterType === 'human') {
            const requestId = event.data['requestId'];
            const legalActions = event.data['legalActions'];
            const timeoutMs = Number(event.data['timeoutMs'] ?? DEFAULT_TIMEOUT_MS);
            if (typeof requestId === 'string' && Array.isArray(legalActions)) {
              hub.publishSeat(seat.ownerUserId, tableId, 'seat.action_requested', {
                handId: event.handId,
                requestId,
                legalActions,
                privateState: { playerId: seat.playerId },
                deadlineAt: Date.now() + timeoutMs,
              });
            }
          }
        }
      });
    }

    const runner = new HandRunner(
      gameState,
      entry.agents,
      this.handStore,
      emitter,
      timeoutMs,
      this.decisionTraceStore,
      tableId,
    );

    const cancelStaleHumanRequests = () => {
      for (const a of entry.agents.values()) {
        if (a instanceof HumanAgent && a.pendingRequest) {
          a.cancel('hand ended without explicit submission');
        }
      }
    };

    try {
      const summary = await runner.run();
      cancelStaleHumanRequests();

      // Update seat stacks from hand result
      const finalPlayers = runner.getPlayers();
      for (const seat of tableState.seats) {
        if (seat) {
          const p = finalPlayers.find(pl => pl.playerId === seat.playerId);
          if (p) {
            seat.stack = p.stack;
            seat.status = p.stack > 0 ? 'waiting' : 'sitting-out';
          }
        }
      }

      // Remove busted players and players who asked to sit out next hand.
      for (let i = 0; i < tableState.seats.length; i++) {
        const seat = tableState.seats[i];
        if (!seat) continue;
        if (seat.stack <= 0 || seat.sitOutNextHand) {
          tableState.seats[i] = null;
          entry.agents.delete(seat.agentId);
        }
      }

      const remaining = tableState.seats.filter(s => s !== null).length;
      tableState.status = remaining >= MIN_PLAYERS ? 'paused' : 'preparing';
      tableState.currentHandId = null;
      entry.currentGameState = null;
      entry.handInProgress = false;

      await this.tableStore.saveTable(tableState);

      return summary;
    } catch (err) {
      cancelStaleHumanRequests();
      entry.handInProgress = false;
      const remaining = tableState.seats.filter(s => s !== null).length;
      tableState.status = remaining >= MIN_PLAYERS ? 'paused' : 'preparing';
      throw err;
    }
  }

  async getCurrentState(tableId: string): Promise<PublicGameState | null> {
    const entry = this.tables.get(tableId);
    if (!entry) throw new NotFoundError('Table', tableId);
    return null; // Phase 1: hand runs synchronously, no in-progress state to return
  }

  async runSimulation(tableId: string, numHands: number): Promise<HandSummary[]> {
    const summaries: HandSummary[] = [];
    for (let i = 0; i < numHands; i++) {
      const entry = this.tables.get(tableId);
      if (!entry) break;
      const seatedPlayers = entry.tableState.seats.filter((s): s is SeatInfo => s !== null && s.stack > 0);
      if (seatedPlayers.length < MIN_PLAYERS) break;
      const summary = await this.startHand(tableId);
      summaries.push(summary);
    }
    return summaries;
  }

  private advanceButton(tableState: TableState, seatedPlayers: SeatInfo[]): number {
    // Find next seat with a player after current button
    const currentButton = tableState.button;
    const seatIndices = seatedPlayers.map(s => s.seatIndex).sort((a, b) => a - b);
    const afterButton = seatIndices.filter(i => i > currentButton);
    return afterButton.length > 0 ? (afterButton[0] ?? seatIndices[0] ?? 0) : (seatIndices[0] ?? 0);
  }

  private computeBlindPositions(seatedPlayers: SeatInfo[], buttonSeat: number): {
    sbIdx: number;
    bbIdx: number;
    firstActorIdx: number;
  } {
    const sorted = [...seatedPlayers].sort((a, b) => a.seatIndex - b.seatIndex);
    const n = sorted.length;

    const buttonPos = sorted.findIndex(s => s.seatIndex === buttonSeat);
    const sbPos = (buttonPos + 1) % n;
    const bbPos = (buttonPos + 2) % n;
    const firstActorPos = (buttonPos + 3) % n;

    // These are indices into the players array (not seat indices)
    // Return indices into seatedPlayers array
    return {
      sbIdx: sbPos,
      bbIdx: bbPos % n,
      firstActorIdx: firstActorPos % n,
    };
  }

  getSeatedAgentsCount(tableId: string): number {
    const entry = this.tables.get(tableId);
    if (!entry) return 0;
    return entry.tableState.seats.filter(s => s !== null).length;
  }
}
