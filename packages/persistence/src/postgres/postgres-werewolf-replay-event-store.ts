import type { WerewolfReplayEvent, WerewolfReplayEventType } from '@agent-poker/shared';
import type { SupabaseServiceClient } from './supabase-clients.js';

// New interface: live append-only ingestion of replay events. Decouples
// "we just produced an event, ship it" from "we're finalizing the match
// artifact" — the former is hot-path streaming, the latter is one final
// summary INSERT. Phase 1 wires the orchestrator's RealtimeHub publish to
// this store so each event flows to Postgres → SSE → spectators in one
// linear path.
export interface IWerewolfReplayEventStore {
  appendEvent(matchPk: string, event: WerewolfReplayEvent): Promise<void>;
  appendEvents(matchPk: string, events: ReadonlyArray<WerewolfReplayEvent>): Promise<void>;
  listEvents(matchPk: string): Promise<WerewolfReplayEvent[]>;
}

interface ReplayEventRow {
  event_id: string;
  match_id: string;
  game_id: string;
  sequence: number;
  event_type: WerewolfReplayEventType;
  data: Record<string, unknown>;
  timestamp: number;
  created_at: string;
}

export class PostgresWerewolfReplayEventStore implements IWerewolfReplayEventStore {
  constructor(private readonly client: SupabaseServiceClient) {}

  async appendEvent(matchPk: string, event: WerewolfReplayEvent): Promise<void> {
    await this.appendEvents(matchPk, [event]);
  }

  async appendEvents(
    matchPk: string,
    events: ReadonlyArray<WerewolfReplayEvent>,
  ): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => ({
      event_id: e.eventId,
      match_id: matchPk,
      game_id: e.gameId,
      sequence: e.sequence,
      event_type: e.eventType,
      data: e.data,
      timestamp: e.timestamp,
    }));
    // ON CONFLICT (match_id, sequence) DO NOTHING — the orchestrator can
    // safely re-emit on retry; PG will keep the first write and ignore
    // duplicates.
    const { error } = await this.client
      .from('werewolf_replay_events')
      .upsert(rows, { onConflict: 'match_id,sequence', ignoreDuplicates: true });
    if (error) {
      throw new Error(`appendEvents failed: ${error.message}`);
    }
  }

  async listEvents(matchPk: string): Promise<WerewolfReplayEvent[]> {
    const { data, error } = await this.client
      .from('werewolf_replay_events')
      .select('event_id, match_id, game_id, sequence, event_type, data, timestamp, created_at')
      .eq('match_id', matchPk)
      .order('sequence', { ascending: true });
    if (error) throw new Error(`listEvents failed: ${error.message}`);
    return ((data ?? []) as ReplayEventRow[]).map(rowToEvent);
  }
}

function rowToEvent(r: ReplayEventRow): WerewolfReplayEvent {
  return {
    eventId: r.event_id,
    gameId: r.game_id,
    sequence: r.sequence,
    eventType: r.event_type,
    timestamp: r.timestamp,
    data: r.data,
  };
}
