import type { HandSummary, ReplayEvent } from '@agent-poker/shared';
import type { IHandStore } from '../store-interface.js';
import type { SqliteDb } from './connection.js';

export class SqliteHandStore implements IHandStore {
  private readonly saveHandStmt;
  private readonly getHandStmt;
  private readonly listHandsStmt;
  private readonly insertEventStmt;
  private readonly listEventsStmt;

  constructor(private readonly db: SqliteDb) {
    this.saveHandStmt = db.prepare(
      'INSERT INTO hands (hand_id, table_id, json, completed_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(hand_id) DO UPDATE SET json = excluded.json, completed_at = excluded.completed_at',
    );
    this.getHandStmt = db.prepare('SELECT json FROM hands WHERE hand_id = ?');
    this.listHandsStmt = db.prepare(
      'SELECT json FROM hands WHERE table_id = ? ORDER BY completed_at ASC',
    );
    this.insertEventStmt = db.prepare(
      'INSERT OR REPLACE INTO replay_events (event_id, hand_id, sequence, json, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.listEventsStmt = db.prepare(
      'SELECT json FROM replay_events WHERE hand_id = ? ORDER BY sequence ASC',
    );
  }

  async saveHandSummary(hand: HandSummary): Promise<void> {
    this.saveHandStmt.run(hand.handId, hand.tableId, JSON.stringify(hand), hand.completedAt);
  }

  async getHandSummary(handId: string): Promise<HandSummary | null> {
    const row = this.getHandStmt.get(handId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as HandSummary) : null;
  }

  async listHandSummaries(tableId: string): Promise<HandSummary[]> {
    const rows = this.listHandsStmt.all(tableId) as Array<{ json: string }>;
    return rows.map(r => JSON.parse(r.json) as HandSummary);
  }

  async appendReplayEvent(event: ReplayEvent): Promise<void> {
    this.insertEventStmt.run(
      event.eventId,
      event.handId,
      event.sequence,
      JSON.stringify(event),
      Date.now(),
    );
  }

  async getReplayEvents(handId: string): Promise<ReplayEvent[]> {
    const rows = this.listEventsStmt.all(handId) as Array<{ json: string }>;
    return rows.map(r => JSON.parse(r.json) as ReplayEvent);
  }
}
