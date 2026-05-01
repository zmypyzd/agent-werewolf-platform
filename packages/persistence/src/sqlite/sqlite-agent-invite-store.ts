import type { AgentInvite, IAgentInviteStore, NewAgentInvite } from '../store-interface.js';
import type { SqliteDb } from './connection.js';

interface AgentInviteRow {
  token: string;
  owner_user_id: string;
  display_name: string | null;
  notes: string | null;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  registered_agent_config_id: string | null;
  created_at: number;
}

function rowToAgentInvite(row: AgentInviteRow): AgentInvite {
  return {
    token: row.token,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    notes: row.notes,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    registeredAgentConfigId: row.registered_agent_config_id,
    createdAt: row.created_at,
  };
}

export class SqliteAgentInviteStore implements IAgentInviteStore {
  private readonly insertStmt;
  private readonly listStmt;
  private readonly findStmt;
  private readonly markUsedStmt;
  private readonly revokeUnusedStmt;

  constructor(private readonly db: SqliteDb) {
    this.insertStmt = db.prepare(
      'INSERT INTO agent_invites ' +
        '(token, owner_user_id, display_name, notes, expires_at, used_at, revoked_at, registered_agent_config_id, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)',
    );
    this.listStmt = db.prepare(
      'SELECT * FROM agent_invites WHERE owner_user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    );
    this.findStmt = db.prepare('SELECT * FROM agent_invites WHERE token = ?');
    this.markUsedStmt = db.prepare(
      'UPDATE agent_invites SET used_at = ?, registered_agent_config_id = ? ' +
        'WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL',
    );
    this.revokeUnusedStmt = db.prepare(
      'UPDATE agent_invites SET revoked_at = ? ' +
        'WHERE owner_user_id = ? AND token = ? AND used_at IS NULL AND revoked_at IS NULL',
    );
  }

  async create(invite: NewAgentInvite): Promise<AgentInvite> {
    const now = Date.now();
    this.insertStmt.run(
      invite.token,
      invite.ownerUserId,
      invite.displayName,
      invite.notes,
      invite.expiresAt,
      now,
    );
    return {
      ...invite,
      usedAt: null,
      revokedAt: null,
      registeredAgentConfigId: null,
      createdAt: now,
    };
  }

  async list(ownerUserId: string): Promise<AgentInvite[]> {
    const rows = this.listStmt.all(ownerUserId) as AgentInviteRow[];
    return rows.map(rowToAgentInvite);
  }

  async findByToken(token: string): Promise<AgentInvite | null> {
    const row = this.findStmt.get(token) as AgentInviteRow | undefined;
    return row ? rowToAgentInvite(row) : null;
  }

  async markUsed(token: string, registeredAgentConfigId: string): Promise<void> {
    this.markUsedStmt.run(Date.now(), registeredAgentConfigId, token);
  }

  async revokeUnused(ownerUserId: string, token: string): Promise<boolean> {
    const result = this.revokeUnusedStmt.run(Date.now(), ownerUserId, token);
    return result.changes > 0;
  }
}
