import type { TableState } from '@agent-poker/shared';
import type { ITableStore } from '../store-interface.js';
import type { SqliteDb } from './connection.js';

export class SqliteTableStore implements ITableStore {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly listStmt;
  private readonly deleteStmt;

  constructor(private readonly db: SqliteDb) {
    this.upsertStmt = db.prepare(
      'INSERT INTO tables (table_id, json, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(table_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
    );
    this.getStmt = db.prepare('SELECT json FROM tables WHERE table_id = ?');
    this.listStmt = db.prepare('SELECT json FROM tables ORDER BY updated_at ASC');
    this.deleteStmt = db.prepare('DELETE FROM tables WHERE table_id = ?');
  }

  async saveTable(table: TableState): Promise<void> {
    this.upsertStmt.run(table.tableId, JSON.stringify(table), Date.now());
  }

  async getTable(tableId: string): Promise<TableState | null> {
    const row = this.getStmt.get(tableId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as TableState) : null;
  }

  async listTables(): Promise<TableState[]> {
    const rows = this.listStmt.all() as Array<{ json: string }>;
    return rows.map(r => JSON.parse(r.json) as TableState);
  }

  async deleteTable(tableId: string): Promise<void> {
    this.deleteStmt.run(tableId);
  }
}
