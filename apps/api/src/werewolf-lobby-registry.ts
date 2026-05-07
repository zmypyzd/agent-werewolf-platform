import { randomUUID } from 'node:crypto';
import { WerewolfNpcAgent, WerewolfRandomMockAgent } from '@agent-poker/agent-runtime';
import {
  WerewolfGameNotFoundError,
  WerewolfSeatOccupiedError,
  WerewolfGameNotReadyError,
  WerewolfGameAlreadyStartedError,
} from '@agent-poker/shared';
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
    | { kind: 'npc'; agentId: string; displayName: string };
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
}

interface InternalEntry extends WerewolfLobbyEntry {
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

function emptySeats(): WerewolfSeatInfo[] {
  return Array.from({ length: TOTAL_SEATS }, (_, i) => ({
    seatIndex: i,
    playerId: `p${i + 1}`,
    occupant: { kind: 'empty' as const },
  }));
}

function publicEntry(entry: InternalEntry): WerewolfLobbyEntry {
  // Defense-in-depth: explicit destructure-and-omit prevents future fields like
  // `seed`, `rosterByPlayerId`, and `deathsByPlayerId` from leaking via spread.
  const { seed: _seed, rosterByPlayerId, deathsByPlayerId, ...rest } = entry;
  // Reveal role/side/alive only once the match has started. Pre-start statuses
  // (waiting / ready) keep the existing isolation invariant — a viewer of
  // the lobby endpoint cannot derive the roster before the game begins.
  const reveal = rest.status === 'running' || rest.status === 'completed';
  if (!reveal) return rest;
  const seats = rest.seats.map((s) => {
    const r = rosterByPlayerId.get(s.playerId);
    const d = deathsByPlayerId.get(s.playerId);
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

  get(gameId: string): WerewolfLobbyEntry | undefined {
    const entry = this.entries.get(gameId);
    return entry ? publicEntry(entry) : undefined;
  }

  list(): WerewolfLobbySummary[] {
    return [...this.entries.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((e) => ({
        gameId: e.gameId,
        name: e.name,
        status: e.status,
        seatedCount: e.seats.filter((s) => s.occupant.kind === 'npc').length,
        createdAt: e.createdAt,
      }));
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
    if (entry.seats.every((s) => s.occupant.kind === 'npc')) {
      entry.status = 'ready';
    }
    return publicEntry(entry);
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
