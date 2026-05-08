import type { WerewolfSide } from '@agent-poker/shared';
import type { MatchPkResolver } from './postgres-werewolf-decision-trace-store.js';
import type { SupabaseServiceClient } from './supabase-clients.js';

// Owner of werewolf_matches + werewolf_seats. The orchestrator calls
// createMatch() when starting a match (status='running'), then later
// PostgresWerewolfMatchArtifactStore.saveMatchArtifact() flips status to
// 'completed' and writes the summary.
//
// Doubles as the MatchPkResolver consumed by the trace store and artifact
// store — caches game_id → uuid mappings in-process so hot-path lookups
// don't round-trip to Postgres.

export interface CreateMatchInput {
  readonly gameId: string;
  readonly ownerId: string | null;
  readonly seed: string;
  readonly seats: ReadonlyArray<{
    readonly seatIndex: number;
    readonly playerId: string;
    readonly agentId: string | null;
    readonly displayName: string;
  }>;
}

export interface MatchRegistryEntry {
  readonly matchPk: string;
  readonly gameId: string;
  readonly status: 'lobby' | 'running' | 'completed' | 'aborted';
  readonly startedAt: number;
}

interface MatchRow {
  id: string;
  game_id: string;
  status: MatchRegistryEntry['status'];
  started_at: string;
}

// Public surface — tests and alternative backends can substitute the
// Postgres-backed implementation. Includes MatchPkResolver since most
// callers need both (createMatch + resolveMatchPk).
export interface IWerewolfMatchRegistry extends MatchPkResolver {
  createMatch(input: CreateMatchInput): Promise<MatchRegistryEntry>;
  abortMatch(gameId: string, reason: string): Promise<void>;
  getStatus(gameId: string): Promise<MatchRegistryEntry['status'] | null>;
}

export class PostgresWerewolfMatchRegistry implements IWerewolfMatchRegistry {
  // Map<gameId, matchPk>. Phase 1's orchestrator owns one registry per
  // process; entries persist for the orchestrator's lifetime.
  private readonly cache = new Map<string, string>();

  constructor(private readonly client: SupabaseServiceClient) {}

  async createMatch(input: CreateMatchInput): Promise<MatchRegistryEntry> {
    const matchInsert = await this.client
      .from('werewolf_matches')
      .insert({
        game_id: input.gameId,
        owner_id: input.ownerId,
        seed: input.seed,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id, game_id, status, started_at')
      .single();
    if (matchInsert.error) {
      throw new Error(`createMatch failed: ${matchInsert.error.message}`);
    }
    const row = matchInsert.data as unknown as MatchRow;

    if (input.seats.length > 0) {
      const seatRows = input.seats.map((s) => ({
        match_id: row.id,
        seat_index: s.seatIndex,
        player_id: s.playerId,
        agent_id: s.agentId,
        display_name: s.displayName,
      }));
      const { error: seatErr } = await this.client.from('werewolf_seats').insert(seatRows);
      if (seatErr) {
        throw new Error(`createMatch: seats insert failed: ${seatErr.message}`);
      }
    }

    this.cache.set(row.game_id, row.id);
    return {
      matchPk: row.id,
      gameId: row.game_id,
      status: row.status,
      startedAt: new Date(row.started_at).getTime(),
    };
  }

  async abortMatch(gameId: string, reason: string): Promise<void> {
    const matchPk = await this.resolveMatchPk(gameId);
    const { error } = await this.client
      .from('werewolf_matches')
      .update({
        status: 'aborted',
        completed_at: new Date().toISOString(),
      })
      .eq('id', matchPk);
    if (error) throw new Error(`abortMatch failed: ${error.message}`);
    // reason is intentionally not persisted at the DB level — emit it via
    // the replay event log (event_type='match.completed' with the reason
    // in `data`) so the existing consumers see it as part of the stream.
    void reason;
  }

  async resolveMatchPk(gameId: string): Promise<string> {
    const cached = this.cache.get(gameId);
    if (cached !== undefined) return cached;
    const { data, error } = await this.client
      .from('werewolf_matches')
      .select('id')
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) throw new Error(`resolveMatchPk failed: ${error.message}`);
    if (!data) throw new Error(`resolveMatchPk: no match for game_id ${gameId}`);
    const id = (data as { id: string }).id;
    this.cache.set(gameId, id);
    return id;
  }

  // Test/admin hook — drops the in-process cache. Production callers
  // should never need this; the cache is invalidation-free because
  // (game_id, id) is immutable once a match is created.
  clearCache(): void {
    this.cache.clear();
  }

  async getStatus(gameId: string): Promise<MatchRegistryEntry['status'] | null> {
    const { data, error } = await this.client
      .from('werewolf_matches')
      .select('status')
      .eq('game_id', gameId)
      .maybeSingle();
    if (error) throw new Error(`getStatus failed: ${error.message}`);
    return data ? ((data as { status: MatchRegistryEntry['status'] }).status) : null;
  }
}

// Helper used by the artifact store after a match flips to 'completed' —
// stamps the seat rows with the now-public role/side/alive triple.
export interface FinalSeatRevealInput {
  readonly matchPk: string;
  readonly seatIndex: number;
  readonly role: 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export async function revealFinalSeats(
  client: SupabaseServiceClient,
  reveals: ReadonlyArray<FinalSeatRevealInput>,
): Promise<void> {
  if (reveals.length === 0) return;
  const rows = reveals.map((r) => ({
    match_id: r.matchPk,
    seat_index: r.seatIndex,
    role: r.role,
    side: r.side,
    alive: r.alive,
  }));
  const { error } = await client
    .from('werewolf_seats')
    .upsert(rows, { onConflict: 'match_id,seat_index' });
  if (error) throw new Error(`revealFinalSeats failed: ${error.message}`);
}
