import type { ISessionStore, Session } from '../store-interface.js';
import type { SqliteDb } from './connection.js';

interface SessionRow {
  session_id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

function rowToSession(r: SessionRow): Session {
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
  };
}

export class SqliteSessionStore implements ISessionStore {
  private readonly insertStmt;
  private readonly findStmt;
  private readonly touchStmt;
  private readonly deleteStmt;

  constructor(
    private readonly db: SqliteDb,
    private readonly now: () => number = Date.now,
  ) {
    this.insertStmt = db.prepare(
      'INSERT INTO sessions (session_id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.findStmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    this.touchStmt = db.prepare(
      'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE session_id = ?',
    );
    this.deleteStmt = db.prepare('DELETE FROM sessions WHERE session_id = ?');
  }

  async create(sessionId: string, userId: string, expiresAt: number): Promise<void> {
    const now = this.now();
    this.insertStmt.run(sessionId, userId, now, expiresAt, now);
  }

  async find(sessionId: string): Promise<Session | null> {
    const row = this.findStmt.get(sessionId) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) return null;
    return rowToSession(row);
  }

  async touch(sessionId: string, lastSeenAt: number, expiresAt: number): Promise<void> {
    this.touchStmt.run(lastSeenAt, expiresAt, sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    this.deleteStmt.run(sessionId);
  }
}
