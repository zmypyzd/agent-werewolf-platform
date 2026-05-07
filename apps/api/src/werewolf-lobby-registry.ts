import { randomUUID } from 'node:crypto';
import {
  WerewolfHttpAgentAdapter,
  WerewolfNpcAgent,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import {
  AgentInUseError,
  AppError,
  WerewolfGameNotFoundError,
  WerewolfSeatOccupiedError,
  WerewolfGameNotReadyError,
  WerewolfGameAlreadyStartedError,
} from '@agent-poker/shared';
import type { IUserAgentConfigStore } from '@agent-poker/persistence';
import type { WerewolfOrchestrator } from '@agent-poker/werewolf-orchestrator';

export type WerewolfLobbyStatus =
  | 'waiting'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

type CauseOfDeath = 'wolf-kill' | 'witch-poison' | 'banishment' | 'hunter-shoot';

const KNOWN_CAUSES: ReadonlySet<string> = new Set([
  'wolf-kill',
  'witch-poison',
  'banishment',
  'hunter-shoot',
]);

function isKnownCause(v: unknown): v is CauseOfDeath {
  return typeof v === 'string' && KNOWN_CAUSES.has(v);
}

export interface WerewolfSeatInfo {
  seatIndex: number;
  playerId: string;
  occupant:
    | { kind: 'empty' }
    | { kind: 'npc'; agentId: string; displayName: string }
    // kind:'agent' = a third-party HTTP agent backed by a registered
    // UserAgentConfig. ownerUserId / agentConfigId are stored INTERNALLY only
    // (see InternalSeatOccupantAgent below); the public projection in
    // publicEntry() omits them and may set isMine=true for the requester.
    | { kind: 'agent'; agentId: string; displayName: string; isMine?: true };
  // ISSUE-005 — populated only when the lobby entry's status is 'running'
  // or 'completed'. Lets the spectator surface reveal the full roster from
  // the moment the match starts, regardless of whether the WS subscription
  // catches `match.started` (the topic doesn't replay, so a slow / late
  // subscriber would otherwise see only generic placeholders forever).
  // Pre-start (`waiting` / `ready`) the fields are absent — pinned by
  // werewolf-games-info-isolation.test.ts.
  role?: string;
  side?: 'good' | 'werewolf';
  // ISSUE-005 follow-up — alive state tracked from phase.changed.eliminated
  // events as the match progresses. Absent pre-start; present for running and
  // completed games. Lets a late-joining or reloading spectator restore the
  // dead-player visual from the polling loop rather than requiring the WS
  // stream (which only delivers future events, not history).
  alive?: boolean;
  causeOfDeath?: CauseOfDeath;
}

export interface WerewolfFinalPlayerView {
  id: string;
  seatIndex: number;
  name: string;
  role: string;
  side: 'good' | 'werewolf';
  alive: boolean;
}

export interface WerewolfLobbyEntry {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seats: WerewolfSeatInfo[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  winner?: 'good' | 'werewolf';
  failureReason?: string;
  finalPlayers?: ReadonlyArray<WerewolfFinalPlayerView>;
}

export interface WerewolfLobbySummary {
  gameId: string;
  name: string;
  status: WerewolfLobbyStatus;
  seatedCount: number;
  createdAt: number;
}

export interface WerewolfLobbyRegistryOptions {
  orchestrator: WerewolfOrchestrator;
  attachMatch: (
    gameId: string,
    ownership: ReadonlyArray<{ playerId: string; userId: string }>,
  ) => void;
  detachMatch: (gameId: string) => void;
  npcThinkingDelayRange?: [number, number];
  agentConfigStore: IUserAgentConfigStore;
}

// Internal-only seat shape — same as WerewolfSeatInfo but the 'agent' variant
// carries ownerUserId/agentConfigId for ownership checks and the per-viewer
// isMine projection. publicEntry() must NEVER expose these fields directly;
// it derives isMine for the requester and drops the rest.
type InternalSeatOccupant =
  | { kind: 'empty' }
  | { kind: 'npc'; agentId: string; displayName: string }
  | {
      kind: 'agent';
      agentId: string;
      displayName: string;
      ownerUserId: string;
      agentConfigId: string;
    };

interface InternalSeatInfo extends Omit<WerewolfSeatInfo, 'occupant'> {
  occupant: InternalSeatOccupant;
}

interface InternalEntry extends Omit<WerewolfLobbyEntry, 'seats'> {
  seats: InternalSeatInfo[];
  seed: string;
  // Roster cached at createMatch time (engine assigns roles deterministically
  // from the seed at that point). Used to enrich the public seats when the
  // match has started — see publicEntry.
  rosterByPlayerId: ReadonlyMap<string, { role: string; side: 'good' | 'werewolf' }>;
  // ISSUE-005 — populated by phase.changed.eliminated events in start().
  // Empty until the match starts; used in publicEntry to expose per-seat
  // alive/causeOfDeath so late-joining spectators can restore the board.
  deathsByPlayerId: Map<string, { cause: CauseOfDeath }>;
}

const TOTAL_SEATS = 9;

function emptySeats(): InternalSeatInfo[] {
  return Array.from({ length: TOTAL_SEATS }, (_, i) => ({
    seatIndex: i,
    playerId: `p${i + 1}`,
    occupant: { kind: 'empty' as const },
  }));
}

// Project an internal seat to its public shape. For kind:'agent' seats the
// ownerUserId and agentConfigId are dropped unconditionally; the only owner
// signal that survives is isMine, set true iff the seat's owner matches the
// requesting viewer. This is the load-bearing information-isolation point for
// the agent-seating feature — every public response funnels through here.
function projectSeat(s: InternalSeatInfo, viewerUserId?: string): WerewolfSeatInfo {
  if (s.occupant.kind === 'agent') {
    const isMine = viewerUserId !== undefined && s.occupant.ownerUserId === viewerUserId;
    const occupant: WerewolfSeatInfo['occupant'] = isMine
      ? {
          kind: 'agent',
          agentId: s.occupant.agentId,
          displayName: s.occupant.displayName,
          isMine: true,
        }
      : {
          kind: 'agent',
          agentId: s.occupant.agentId,
          displayName: s.occupant.displayName,
        };
    const { occupant: _o, ...rest } = s;
    return { ...rest, occupant };
  }
  // empty / npc — internal and public shapes are identical.
  return s as WerewolfSeatInfo;
}

function publicEntry(entry: InternalEntry, viewerUserId?: string): WerewolfLobbyEntry {
  // Defense-in-depth: explicit destructure-and-omit prevents future fields like
  // `seed`, `rosterByPlayerId`, and `deathsByPlayerId` from leaking via spread.
  const { seed: _seed, rosterByPlayerId, deathsByPlayerId, ...rest } = entry;
  // Reveal role/side/alive only once the match has started. Pre-start statuses
  // (waiting / ready) keep the existing isolation invariant — a viewer of
  // the lobby endpoint cannot derive the roster before the game begins.
  const reveal = rest.status === 'running' || rest.status === 'completed';
  const projected = rest.seats.map((s) => projectSeat(s, viewerUserId));
  if (!reveal) return { ...rest, seats: projected };
  const seats: WerewolfSeatInfo[] = projected.map((s, i) => {
    const internal = rest.seats[i]!;
    const r = rosterByPlayerId.get(internal.playerId);
    const d = deathsByPlayerId.get(internal.playerId);
    return {
      ...s,
      ...(r ? { role: r.role, side: r.side } : {}),
      alive: d === undefined,
      ...(d ? { causeOfDeath: d.cause } : {}),
    };
  });
  return { ...rest, seats };
}

export class WerewolfLobbyRegistry {
  private readonly entries = new Map<string, InternalEntry>();
  private readonly runPromises = new Map<string, Promise<void>>();

  constructor(private readonly options: WerewolfLobbyRegistryOptions) {}

  create(input: { name?: string; seed?: string }): WerewolfLobbyEntry {
    const gameId = randomUUID();
    const seed = input.seed ?? randomUUID();
    const name =
      input.name && input.name.trim().length > 0
        ? input.name
        : `Game ${gameId.slice(0, 8)}`;
    const { initialState } = this.options.orchestrator.createMatch({ gameId, seed });
    // The engine assigns roles deterministically inside createGame at this
    // point. Cache them so the lobby endpoint can reveal them once the
    // match starts, without needing a second round-trip to the orchestrator.
    const rosterByPlayerId = new Map<string, { role: string; side: 'good' | 'werewolf' }>();
    for (const p of initialState.players) {
      rosterByPlayerId.set(p.id, { role: p.role, side: p.side });
    }
    const entry: InternalEntry = {
      gameId,
      name,
      status: 'waiting',
      seats: emptySeats(),
      createdAt: Date.now(),
      seed,
      rosterByPlayerId,
      deathsByPlayerId: new Map(),
    };
    this.entries.set(gameId, entry);
    return publicEntry(entry);
  }

  get(gameId: string, viewerUserId?: string): WerewolfLobbyEntry | undefined {
    const entry = this.entries.get(gameId);
    return entry ? publicEntry(entry, viewerUserId) : undefined;
  }

  list(): WerewolfLobbySummary[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((e) => ({
        gameId: e.gameId,
        name: e.name,
        status: e.status,
        // Count any non-empty seat (npc OR agent) as "seated" for the lobby
        // summary. Pre-agent code only had npc seats so the predicate was
        // narrower; widening it preserves the existing UX for npc-only games
        // and lets agent-seated games surface their progress correctly.
        seatedCount: e.seats.filter((s) => s.occupant.kind !== 'empty').length,
        createdAt: e.createdAt,
      }));
  }

  // True if the given agent config is currently seated in any waiting/ready/
  // running werewolf game. Used by the cross-game in-use joiner to decide
  // whether DELETE /me/agents/:id should be rejected (D3=C in the plan).
  isAgentConfigInUse(agentConfigId: string): boolean {
    for (const entry of this.entries.values()) {
      // Completed/failed games no longer hold the cfg — only live ones.
      if (entry.status === 'completed' || entry.status === 'failed') continue;
      for (const seat of entry.seats) {
        if (
          seat.occupant.kind === 'agent' &&
          seat.occupant.agentConfigId === agentConfigId
        ) {
          return true;
        }
      }
    }
    return false;
  }

  inviteNpc(
    gameId: string,
    seatIndex: number,
    displayName?: string,
  ): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    const seat = entry.seats[seatIndex];
    if (!seat) {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    if (seat.occupant.kind !== 'empty') {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    const playerId = seat.playerId;
    const agentId = `agent-${playerId}`;
    const finalDisplayName = displayName?.trim() || `Bot ${seatIndex + 1}`;
    const inner = new WerewolfRandomMockAgent(agentId, finalDisplayName, {
      seed: entry.seed,
    });
    const agent = new WerewolfNpcAgent(agentId, finalDisplayName, inner, {
      seed: entry.seed,
      personality: 'balanced',
      thinkingDelayRange: this.options.npcThinkingDelayRange ?? [1500, 3500],
    });
    this.options.orchestrator.registerAgent(gameId, playerId, agent);
    entry.seats[seatIndex] = {
      seatIndex,
      playerId,
      occupant: { kind: 'npc', agentId, displayName: finalDisplayName },
    };
    // "All seats filled" once both npc and agent occupants count toward ready.
    if (entry.seats.every((s) => s.occupant.kind !== 'empty')) {
      entry.status = 'ready';
    }
    return publicEntry(entry);
  }

  // Seat a third-party HTTP agent backed by a user-owned UserAgentConfig.
  // Mirrors inviteNpc structurally; differs in three load-bearing ways:
  //   - reads cfg from agentConfigStore and verifies cfg.userId === ownerUserId
  //     (cross-account access is reported as AGENT_NOT_FOUND, not 403, so the
  //     caller cannot probe for cfg existence belonging to other users)
  //   - rejects if the same cfg is already seated in this game (cross-game
  //     in-use is the joiner service's job, see AgentConfigUsageService)
  //   - records ownerUserId / agentConfigId on the internal seat so publicEntry
  //     can compute isMine for the requester without leaking owner identity
  async inviteAgent(
    gameId: string,
    seatIndex: number,
    agentConfigId: string,
    ownerUserId: string,
    displayName?: string,
  ): Promise<WerewolfLobbyEntry> {
    const entry = this.requireEntry(gameId);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    const seat = entry.seats[seatIndex];
    if (!seat) {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    if (seat.occupant.kind !== 'empty') {
      throw new WerewolfSeatOccupiedError(gameId, seatIndex);
    }
    const cfg = await this.options.agentConfigStore.get(ownerUserId, agentConfigId);
    if (!cfg) {
      throw new AppError('AGENT_NOT_FOUND', `Agent config ${agentConfigId} not found`);
    }
    // Within-game guard. Cross-game (poker + werewolf) is checked one layer
    // up by AgentConfigUsageService; here we only need to prevent two seats
    // in THIS lobby from holding the same cfg.
    for (const s of entry.seats) {
      if (
        s.occupant.kind === 'agent' &&
        s.occupant.agentConfigId === agentConfigId
      ) {
        throw new AgentInUseError(agentConfigId);
      }
    }
    const playerId = seat.playerId;
    const agentId = `agent-${playerId}`;
    const finalDisplayName = displayName?.trim() || cfg.agentName;
    const adapter = new WerewolfHttpAgentAdapter({
      agentId,
      name: finalDisplayName,
      endpointUrl: cfg.endpointUrl,
      authHeaderName: cfg.authHeaderName,
      authHeaderValue: cfg.authHeaderValue,
      timeoutMs: cfg.timeoutMs,
    });
    this.options.orchestrator.registerAgent(gameId, playerId, adapter);
    entry.seats[seatIndex] = {
      seatIndex,
      playerId,
      occupant: {
        kind: 'agent',
        agentId,
        displayName: finalDisplayName,
        ownerUserId,
        agentConfigId,
      },
    };
    if (entry.seats.every((s) => s.occupant.kind !== 'empty')) {
      entry.status = 'ready';
    }
    return publicEntry(entry, ownerUserId);
  }

  fillWithNpcs(gameId: string): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    if (entry.status === 'ready') return publicEntry(entry);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    for (let i = 0; i < TOTAL_SEATS; i++) {
      if (entry.seats[i]!.occupant.kind === 'empty') {
        this.inviteNpc(gameId, i);
      }
    }
    return publicEntry(entry);
  }

  start(gameId: string): Promise<void> {
    const entry = this.requireEntry(gameId);
    if (entry.status === 'running' || entry.status === 'completed') {
      throw new WerewolfGameAlreadyStartedError(gameId);
    }
    if (entry.status !== 'ready') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    entry.status = 'running';
    entry.startedAt = Date.now();
    this.options.attachMatch(gameId, []);
    // ISSUE-005 — track per-seat deaths as they happen so the lobby endpoint
    // can expose alive/causeOfDeath for late-joining or reloading spectators.
    const unsubscribe = this.options.orchestrator.subscribe(gameId, (event) => {
      if (event.eventType !== 'phase.changed') return;
      const eliminated = event.data['eliminated'];
      if (!Array.isArray(eliminated)) return;
      for (const e of eliminated as Array<Record<string, unknown>>) {
        const playerId = e['playerId'];
        const cause = e['cause'];
        if (typeof playerId === 'string' && isKnownCause(cause)) {
          entry.deathsByPlayerId.set(playerId, { cause });
        }
      }
    });
    const promise = this.options.orchestrator.runMatch(gameId).then(
      (summary) => {
        unsubscribe();
        entry.status = 'completed';
        entry.completedAt = summary.completedAt;
        entry.winner = summary.winner;
        entry.finalPlayers = summary.finalPlayers.map((p) => ({
          id: p.id,
          seatIndex: p.seatIndex,
          name: p.name,
          role: p.role,
          side: p.side,
          alive: p.alive,
        }));
        this.options.detachMatch(gameId);
      },
      (err: unknown) => {
        unsubscribe();
        entry.status = 'failed';
        entry.completedAt = Date.now();
        entry.failureReason = err instanceof Error ? err.message : String(err);
        this.options.detachMatch(gameId);
      },
    );
    this.runPromises.set(gameId, promise);
    return promise;
  }

  private requireEntry(gameId: string): InternalEntry {
    const entry = this.entries.get(gameId);
    if (!entry) throw new WerewolfGameNotFoundError(gameId);
    return entry;
  }
}
