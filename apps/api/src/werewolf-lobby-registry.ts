import { randomUUID } from 'node:crypto';
import {
  WerewolfHttpAgentAdapter,
  WerewolfNpcAgent,
  WerewolfRandomMockAgent,
} from '@agent-poker/agent-runtime';
import {
  AgentInUseError,
  AppError,
  ForbiddenError,
  WerewolfGameNotFoundError,
  WerewolfSeatOccupiedError,
  WerewolfGameNotReadyError,
  WerewolfGameAlreadyStartedError,
} from '@agent-poker/shared';
import type { WerewolfBriefing } from '@agent-poker/shared';
import type {
  IUserAgentConfigStore,
  IWerewolfMatchRegistry,
  IWerewolfReplayEventStore,
} from '@agent-poker/persistence';
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
  // Phase backfill for late-joining / reloading spectators. SSE has no
  // backlog (apps/api/src/routes/werewolf-stream.ts), so a viewer who
  // opens the page in the middle of a match would otherwise have to wait
  // for the next phase.changed event to know what's happening — which
  // can be 20–30s during long night phases. The lobby poll carries the
  // last-observed phase so the spectator UI can render the precise day/
  // night reading from t=0 of any reload. Present only for
  // status='running'/'completed'; absent in waiting/ready to preserve
  // pre-start info isolation (see werewolf-games-info-isolation.test.ts).
  currentPhase?: string;
  dayNumber?: number;
  nightNumber?: number;
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
  // Optional protocol briefing forwarded to every external HTTP agent on
  // every decision request. The API server fills this in from env when
  // WEREWOLF_BRIEFING_ENABLED is truthy. Local sims/tests leave it unset.
  briefing?: WerewolfBriefing;
  // When set, start() persists the match in werewolf_matches before runMatch
  // emits any events. Without this, PostgresWerewolfDecisionTraceStore.saveTrace
  // throws "resolveMatchPk: no match for game_id <id>" the moment the first
  // agent decides — because the trace store looks up matchPk by gameId, but
  // the row was never inserted. Optional so the in-memory dev/test path
  // (no SUPABASE_* env) keeps working without a Postgres registry.
  matchRegistry?: IWerewolfMatchRegistry;
  // When set together with matchRegistry, every replay event the orchestrator
  // emits is appended to werewolf_replay_events live. Mirrors the flow in
  // PostgresWerewolfOrchestrator.startMatch — fire-and-forget per event so an
  // ingestion error doesn't kill the match; saveMatchArtifact at end-of-match
  // still upserts any rows that didn't make it.
  replayEventStore?: IWerewolfReplayEventStore;
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
  // The session-authenticated user that called POST /werewolf-games to
  // create this lobby. Used to gate "host-only" operations (start the
  // match, seat NPCs, fill-with-npcs). NULL is reserved for unit-test
  // fixtures that exercise the registry without a real auth layer; live
  // routes always supply a value because the create endpoint is behind
  // requireAuth. Inviting your OWN registered HTTP agent into someone
  // else's lobby is intentionally NOT gated by this — that's the
  // multi-host design intent (multiple users can field agents in the
  // same game). Starting and seating bots is the host's call alone.
  creatorUserId: string | null;
  // Roster cached at createMatch time (engine assigns roles deterministically
  // from the seed at that point). Used to enrich the public seats when the
  // match has started — see publicEntry.
  rosterByPlayerId: ReadonlyMap<string, { role: string; side: 'good' | 'werewolf' }>;
  // ISSUE-005 — populated by phase.changed.eliminated events in start().
  // Empty until the match starts; used in publicEntry to expose per-seat
  // alive/causeOfDeath so late-joining spectators can restore the board.
  deathsByPlayerId: Map<string, { cause: CauseOfDeath }>;
  // Last-observed phase metadata, mirrored from the same phase.changed
  // subscription that tracks deathsByPlayerId. Populated once start() flips
  // status to 'running'; surfaced through publicEntry so the lobby poll
  // can backfill currentPhase/day/night for late-joining spectators (see
  // the WerewolfLobbyEntry comment). Stays undefined for waiting/ready.
  currentPhase?: string;
  dayNumber?: number;
  nightNumber?: number;
  // werewolf_matches.id (uuid) — populated by start() when a matchRegistry is
  // wired in. Lets downstream Postgres-backed stores (replay events, decision
  // traces, final artifact) resolve gameId → matchPk without a round-trip per
  // call. Stays undefined in pure in-memory mode.
  matchPk?: string;
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
  // `seed`, `rosterByPlayerId`, `deathsByPlayerId`, and `matchPk` from leaking
  // via spread. The matchPk in particular is a uuid for werewolf_matches.id —
  // not catastrophic if exposed (RLS still gates the row), but it's an
  // internal database identifier with no business crossing the API boundary.
  const {
    seed: _seed,
    rosterByPlayerId,
    deathsByPlayerId,
    matchPk: _matchPk,
    currentPhase,
    dayNumber,
    nightNumber,
    ...rest
  } = entry;
  // Reveal role/side/alive only once the match has started. Pre-start statuses
  // (waiting / ready) keep the existing isolation invariant — a viewer of
  // the lobby endpoint cannot derive the roster before the game begins.
  const reveal = rest.status === 'running' || rest.status === 'completed';
  const projected = rest.seats.map((s) => projectSeat(s, viewerUserId));
  // Pre-start: phase metadata stays internal-only. start() never sets these
  // until status flips to 'running', but the destructure above also drops
  // them defensively for any future writer that violates the invariant.
  if (!reveal) return { ...rest, seats: projected };
  const phaseFields: Pick<
    WerewolfLobbyEntry,
    'currentPhase' | 'dayNumber' | 'nightNumber'
  > = {
    ...(currentPhase !== undefined ? { currentPhase } : {}),
    ...(dayNumber !== undefined ? { dayNumber } : {}),
    ...(nightNumber !== undefined ? { nightNumber } : {}),
  };
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
  return { ...rest, seats, ...phaseFields };
}

export class WerewolfLobbyRegistry {
  private readonly entries = new Map<string, InternalEntry>();
  private readonly runPromises = new Map<string, Promise<void>>();

  constructor(private readonly options: WerewolfLobbyRegistryOptions) {}

  create(input: { name?: string; seed?: string; creatorUserId?: string }): WerewolfLobbyEntry {
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
      creatorUserId: input.creatorUserId ?? null,
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
    requesterUserId?: string,
  ): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    this.assertCreatorOnly(entry, requesterUserId, 'invite NPC');
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

  fillWithNpcs(gameId: string, requesterUserId?: string): WerewolfLobbyEntry {
    const entry = this.requireEntry(gameId);
    this.assertCreatorOnly(entry, requesterUserId, 'fill with NPCs');
    if (entry.status === 'ready') return publicEntry(entry);
    if (entry.status !== 'waiting') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    for (let i = 0; i < TOTAL_SEATS; i++) {
      if (entry.seats[i]!.occupant.kind === 'empty') {
        // Bypass the per-seat ownership check here — we already validated
        // requesterUserId once at the top. Avoid re-running the check N times
        // (and avoid the cost of a redundant assertion in the hot loop).
        this.inviteNpc(gameId, i, undefined, requesterUserId);
      }
    }
    return publicEntry(entry);
  }

  start(gameId: string, requesterUserId?: string): Promise<void> {
    const entry = this.requireEntry(gameId);
    this.assertCreatorOnly(entry, requesterUserId, 'start match');
    if (entry.status === 'running' || entry.status === 'completed') {
      throw new WerewolfGameAlreadyStartedError(gameId);
    }
    if (entry.status !== 'ready') {
      throw new WerewolfGameNotReadyError(gameId, entry.status);
    }
    entry.status = 'running';
    entry.startedAt = Date.now();
    // attachMatch + the death-tracker subscription stay synchronous so callers
    // observing `attachMatch.toHaveBeenCalled()` immediately after start()
    // continue to see the call (this is load-bearing for spectator broadcast
    // coverage — the hub must be wired before any agent decision can fire).
    this.options.attachMatch(gameId, []);
    const phaseUnsubscribe = this.options.orchestrator.subscribe(gameId, (event) => {
      if (event.eventType !== 'phase.changed') return;
      // Phase metadata: cache the latest phase/day/night so the lobby poll
      // can backfill late-joining spectators (orchestrator emits these on
      // every transition — see packages/werewolf-orchestrator/src/match-runner.ts).
      const phase = event.data['phase'];
      const day = event.data['dayNumber'];
      const night = event.data['nightNumber'];
      if (typeof phase === 'string') entry.currentPhase = phase;
      if (typeof day === 'number') entry.dayNumber = day;
      if (typeof night === 'number') entry.nightNumber = night;
      // Eliminations (existing logic): persist per-seat cause-of-death so the
      // dead-player visual restores from the polling loop, not just from WS/SSE
      // history.
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
    const promise = this.runWithPersistence(gameId, entry, phaseUnsubscribe);
    this.runPromises.set(gameId, promise);
    return promise;
  }

  // Run-loop body for a started match. Splits out from start() so the
  // synchronous prelude (status flip, attachMatch, death-tracker subscribe)
  // happens before this async work begins — preserving the contract that
  // start() returns a promise, but the lobby entry is observably 'running'
  // by the time the route handler reads it.
  private async runWithPersistence(
    gameId: string,
    entry: InternalEntry,
    phaseUnsubscribe: () => void,
  ): Promise<void> {
    let replayUnsubscribe: (() => void) | null = null;
    try {
      // Persist the match row in the durable registry, if Postgres mode is on.
      // Without this, PostgresWerewolfDecisionTraceStore.saveTrace fails at the
      // first decision with `resolveMatchPk: no match for game_id <id>` because
      // it looks up werewolf_matches by game_id and finds nothing.
      if (this.options.matchRegistry) {
        const created = await this.options.matchRegistry.createMatch({
          gameId,
          // ownerId stays null until the lobby tracks the creator's userId.
          // The DB column is nullable; this is a follow-up enhancement, not a
          // blocker for the resolveMatchPk fix.
          ownerId: null,
          seed: entry.seed,
          seats: entry.seats.map((s) => ({
            seatIndex: s.seatIndex,
            playerId: s.playerId,
            // werewolf_seats.agent_id FKs to public.agents — the lobby's
            // user-registered HTTP agents live in user_agent_configs, a
            // different table. Leaving null until agent attribution is
            // wired through agentStore (out of scope for this fix).
            agentId: null,
            displayName:
              s.occupant.kind === 'empty'
                ? // Cannot reach: status='ready' guarantees no empty seats,
                  // and start() rejects any other status. Guard for type
                  // narrowing only.
                  `Seat ${s.seatIndex + 1}`
                : s.occupant.displayName,
          })),
        });
        entry.matchPk = created.matchPk;

        // Live replay-event ingestion. Mirrors PostgresWerewolfOrchestrator.startMatch:
        // fire-and-forget per event so an ingestion error doesn't kill the match;
        // saveMatchArtifact at end-of-match upserts any rows that didn't make it.
        if (this.options.replayEventStore) {
          const replayStore = this.options.replayEventStore;
          const matchPk = created.matchPk;
          replayUnsubscribe = this.options.orchestrator.subscribe(gameId, (event) => {
            void replayStore.appendEvent(matchPk, event).catch((err) => {
              console.error(
                `werewolf-lobby: live replay-event ingestion failed (${event.eventType} seq=${event.sequence}): ${(err as Error).message}`,
              );
            });
          });
        }
      }

      const summary = await this.options.orchestrator.runMatch(
        gameId,
        this.options.briefing ? { briefing: this.options.briefing } : {},
      );
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
    } catch (err) {
      entry.status = 'failed';
      entry.completedAt = Date.now();
      entry.failureReason = err instanceof Error ? err.message : String(err);
    } finally {
      phaseUnsubscribe();
      if (replayUnsubscribe) replayUnsubscribe();
      this.options.detachMatch(gameId);
    }
  }

  private requireEntry(gameId: string): InternalEntry {
    const entry = this.entries.get(gameId);
    if (!entry) throw new WerewolfGameNotFoundError(gameId);
    return entry;
  }

  // Host-only gate. Throws ForbiddenError if requesterUserId does not match
  // the lobby creator. Two cases bypass the gate intentionally:
  //   - entry.creatorUserId === null: legacy / test fixtures that constructed
  //     a lobby without a creator. Backward compatible — pre-PR tests still
  //     work because they don't pass a requester either.
  //   - requesterUserId === undefined: the call originated inside the registry
  //     itself (fillWithNpcs delegating to inviteNpc) AFTER the outer call
  //     already validated. Internal call sites pass the original requester
  //     explicitly when they want the inner check; passing undefined skips it.
  private assertCreatorOnly(
    entry: InternalEntry,
    requesterUserId: string | undefined,
    actionLabel: string,
  ): void {
    if (entry.creatorUserId === null) return;
    if (requesterUserId === undefined) return;
    if (entry.creatorUserId !== requesterUserId) {
      throw new ForbiddenError(
        `only the lobby creator may ${actionLabel} for game ${entry.gameId}`,
      );
    }
  }
}
