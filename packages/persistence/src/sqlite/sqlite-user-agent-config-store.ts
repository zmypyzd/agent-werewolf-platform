import { NotFoundError } from '@agent-poker/shared';
import type {
  IUserAgentConfigStore,
  NewUserAgentConfig,
  PatchUserAgentConfig,
  UserAgentConfig,
} from '../store-interface.js';
import type { SqliteDb } from './connection.js';

interface ConfigRow {
  agent_config_id: string;
  user_id: string;
  agent_name: string;
  endpoint_url: string;
  auth_header_name: string | null;
  auth_header_value: string | null;
  timeout_ms: number;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function rowToConfig(r: ConfigRow): UserAgentConfig {
  return {
    agentConfigId: r.agent_config_id,
    userId: r.user_id,
    agentName: r.agent_name,
    endpointUrl: r.endpoint_url,
    authHeaderName: r.auth_header_name,
    authHeaderValue: r.auth_header_value,
    timeoutMs: r.timeout_ms,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class SqliteUserAgentConfigStore implements IUserAgentConfigStore {
  private readonly insertStmt;
  private readonly listStmt;
  private readonly getStmt;
  private readonly deleteStmt;

  constructor(private readonly db: SqliteDb) {
    this.insertStmt = db.prepare(
      'INSERT INTO user_agent_configs ' +
        '(agent_config_id, user_id, agent_name, endpoint_url, auth_header_name, auth_header_value, timeout_ms, description, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.listStmt = db.prepare(
      'SELECT * FROM user_agent_configs WHERE user_id = ? ORDER BY created_at ASC',
    );
    this.getStmt = db.prepare(
      'SELECT * FROM user_agent_configs WHERE user_id = ? AND agent_config_id = ?',
    );
    this.deleteStmt = db.prepare(
      'DELETE FROM user_agent_configs WHERE user_id = ? AND agent_config_id = ?',
    );
  }

  async list(userId: string): Promise<UserAgentConfig[]> {
    const rows = this.listStmt.all(userId) as ConfigRow[];
    return rows.map(rowToConfig);
  }

  async get(userId: string, agentConfigId: string): Promise<UserAgentConfig | null> {
    const row = this.getStmt.get(userId, agentConfigId) as ConfigRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  async create(cfg: NewUserAgentConfig): Promise<UserAgentConfig> {
    const now = Date.now();
    this.insertStmt.run(
      cfg.agentConfigId,
      cfg.userId,
      cfg.agentName,
      cfg.endpointUrl,
      cfg.authHeaderName,
      cfg.authHeaderValue,
      cfg.timeoutMs,
      cfg.description,
      now,
      now,
    );
    return { ...cfg, createdAt: now, updatedAt: now };
  }

  async update(
    userId: string,
    agentConfigId: string,
    patch: PatchUserAgentConfig,
  ): Promise<UserAgentConfig> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.agentName !== undefined) { fields.push('agent_name = ?'); values.push(patch.agentName); }
    if (patch.endpointUrl !== undefined) { fields.push('endpoint_url = ?'); values.push(patch.endpointUrl); }
    if (patch.authHeaderName !== undefined) { fields.push('auth_header_name = ?'); values.push(patch.authHeaderName); }
    if (patch.authHeaderValue !== undefined) { fields.push('auth_header_value = ?'); values.push(patch.authHeaderValue); }
    if (patch.timeoutMs !== undefined) { fields.push('timeout_ms = ?'); values.push(patch.timeoutMs); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }

    if (fields.length === 0) {
      const existing = await this.get(userId, agentConfigId);
      if (!existing) throw new NotFoundError('UserAgentConfig', agentConfigId);
      return existing;
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(userId, agentConfigId);

    const sql = `UPDATE user_agent_configs SET ${fields.join(', ')} WHERE user_id = ? AND agent_config_id = ?`;
    const info = this.db.prepare(sql).run(...values);
    if (info.changes === 0) throw new NotFoundError('UserAgentConfig', agentConfigId);

    const updated = await this.get(userId, agentConfigId);
    if (!updated) throw new NotFoundError('UserAgentConfig', agentConfigId);
    return updated;
  }

  async delete(userId: string, agentConfigId: string): Promise<void> {
    this.deleteStmt.run(userId, agentConfigId);
  }
}
