import { EmailTakenError } from '@agent-poker/shared';
import type { IUserStore, NewUser, User } from '../store-interface.js';
import type { SqliteDb } from './connection.js';

interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: number;
  updated_at: number;
}

function rowToUser(r: UserRow): User {
  return {
    userId: r.user_id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteUserStore implements IUserStore {
  private readonly insertStmt;
  private readonly findByIdStmt;
  private readonly findByEmailStmt;
  private readonly updateDisplayNameStmt;

  constructor(private readonly db: SqliteDb) {
    this.insertStmt = db.prepare(
      'INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.findByIdStmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    this.findByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
    this.updateDisplayNameStmt = db.prepare(
      'UPDATE users SET display_name = ?, updated_at = ? WHERE user_id = ?',
    );
  }

  async createUser(u: NewUser): Promise<User> {
    const now = Date.now();
    const email = u.email.trim().toLowerCase();
    try {
      this.insertStmt.run(u.userId, email, u.passwordHash, u.displayName, now, now);
    } catch (err) {
      if (isUniqueViolation(err) && /users\.email/i.test(messageOf(err))) {
        throw new EmailTakenError(email);
      }
      throw err;
    }
    return {
      userId: u.userId,
      email,
      passwordHash: u.passwordHash,
      displayName: u.displayName,
      createdAt: now,
      updatedAt: now,
    };
  }

  async findById(userId: string): Promise<User | null> {
    const row = this.findByIdStmt.get(userId) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = this.findByEmailStmt.get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    this.updateDisplayNameStmt.run(displayName, Date.now(), userId);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
