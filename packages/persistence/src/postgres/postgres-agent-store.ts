import { createHash, randomBytes } from 'crypto';
import { NotFoundError } from '@agent-poker/shared';
import type { SupabaseServiceClient, SupabaseUserClient } from './supabase-clients.js';

// Replacement for IUserAgentConfigStore. This interface is protocol-aware
// (longpoll mailbox vs http webhook vs inproc house bot), which the
// orchestrator needs to route decisions through the right adapter at
// dispatch time.
//
// The agents table has RLS policies that restrict reads/writes to the
// owner. Pass a user-scoped client (createUserScopedClient) to get auth.uid()
// enforcement, or a service-role client for cross-user reads (orchestrator
// hot-path lookup of agent metadata at dispatch time).

export type AgentProtocol = 'http' | 'longpoll' | 'inproc';
export type AgentStatus = 'active' | 'suspended' | 'retired';

export interface AgentRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly description: string | null;
  readonly protocol: AgentProtocol;
  readonly callbackUrl: string | null;
  readonly authHeaderName: string | null;
  readonly authHeaderValue: string | null;
  readonly timeoutMs: number;
  readonly status: AgentStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NewAgent {
  readonly ownerId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly protocol: AgentProtocol;
  readonly callbackUrl?: string | null;
  readonly authHeaderName?: string | null;
  readonly authHeaderValue?: string | null;
  readonly timeoutMs?: number;
}

export interface PatchAgent {
  readonly name?: string;
  readonly description?: string | null;
  readonly protocol?: AgentProtocol;
  readonly callbackUrl?: string | null;
  readonly authHeaderName?: string | null;
  readonly authHeaderValue?: string | null;
  readonly timeoutMs?: number;
  readonly status?: AgentStatus;
}

export interface CreateAgentResult {
  readonly agent: AgentRecord;
  // Raw bearer token. Returned once at create time only; never persisted
  // and never re-derivable from the row (only the sha256 hash is stored).
  // Null for non-longpoll protocols, where no inbound auth is needed.
  readonly rawToken: string | null;
}

export interface IAgentStore {
  list(ownerId: string): Promise<AgentRecord[]>;
  get(ownerId: string, agentId: string): Promise<AgentRecord | null>;
  getById(agentId: string): Promise<AgentRecord | null>;
  // Returns a bare AgentRecord (no token surface) so the bearer-auth hook
  // can attach it to the request without re-leaking the hash.
  findByTokenHash(tokenHash: string): Promise<AgentRecord | null>;
  create(input: NewAgent): Promise<CreateAgentResult>;
  update(ownerId: string, agentId: string, patch: PatchAgent): Promise<AgentRecord>;
  // Generate and install a fresh bearer token. Returns the raw value
  // exactly once; the hash replaces any prior hash in DB.
  rotateToken(ownerId: string, agentId: string): Promise<{ agent: AgentRecord; rawToken: string }>;
  delete(ownerId: string, agentId: string): Promise<void>;
}

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  protocol: AgentProtocol;
  callback_url: string | null;
  auth_header_name: string | null;
  auth_header_value: string | null;
  timeout_ms: number;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS =
  'id, owner_id, name, description, protocol, callback_url, auth_header_name, auth_header_value, timeout_ms, status, created_at, updated_at';

export class PostgresAgentStore implements IAgentStore {
  // Pass a user-scoped client for owner-bound CRUD (RLS enforces auth.uid()).
  // For getById on the orchestrator hot path, pass a service-role client.
  constructor(private readonly client: SupabaseServiceClient | SupabaseUserClient) {}

  async list(ownerId: string): Promise<AgentRecord[]> {
    const { data, error } = await this.client
      .from('agents')
      .select(SELECT_COLUMNS)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`list agents failed: ${error.message}`);
    return ((data ?? []) as AgentRow[]).map(rowToAgent);
  }

  async get(ownerId: string, agentId: string): Promise<AgentRecord | null> {
    const { data, error } = await this.client
      .from('agents')
      .select(SELECT_COLUMNS)
      .eq('owner_id', ownerId)
      .eq('id', agentId)
      .maybeSingle();
    if (error) throw new Error(`get agent failed: ${error.message}`);
    return data ? rowToAgent(data as unknown as AgentRow) : null;
  }

  async getById(agentId: string): Promise<AgentRecord | null> {
    const { data, error } = await this.client
      .from('agents')
      .select(SELECT_COLUMNS)
      .eq('id', agentId)
      .maybeSingle();
    if (error) throw new Error(`getById agent failed: ${error.message}`);
    return data ? rowToAgent(data as unknown as AgentRow) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    const { data, error } = await this.client
      .from('agents')
      .select(SELECT_COLUMNS)
      .eq('token_hash', tokenHash)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new Error(`findByTokenHash failed: ${error.message}`);
    return data ? rowToAgent(data as unknown as AgentRow) : null;
  }

  async create(input: NewAgent): Promise<CreateAgentResult> {
    let rawToken: string | null = null;
    let tokenHash: string | null = null;
    if (input.protocol === 'longpoll') {
      rawToken = generateRawToken();
      tokenHash = hashToken(rawToken);
    }
    const row: Partial<AgentRow> & { token_hash?: string | null } = {
      owner_id: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      protocol: input.protocol,
      callback_url: input.callbackUrl ?? null,
      auth_header_name: input.authHeaderName ?? null,
      auth_header_value: input.authHeaderValue ?? null,
      timeout_ms: input.timeoutMs ?? 30_000,
      token_hash: tokenHash,
    };
    const { data, error } = await this.client
      .from('agents')
      .insert(row)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw new Error(`create agent failed: ${error.message}`);
    return {
      agent: rowToAgent(data as unknown as AgentRow),
      rawToken,
    };
  }

  async rotateToken(
    ownerId: string,
    agentId: string,
  ): Promise<{ agent: AgentRecord; rawToken: string }> {
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const { data, error } = await this.client
      .from('agents')
      .update({ token_hash: tokenHash })
      .eq('owner_id', ownerId)
      .eq('id', agentId)
      .eq('protocol', 'longpoll')
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`rotateToken failed: ${error.message}`);
    if (!data) throw new NotFoundError('Agent', agentId);
    return { agent: rowToAgent(data as unknown as AgentRow), rawToken };
  }

  async update(
    ownerId: string,
    agentId: string,
    patch: PatchAgent,
  ): Promise<AgentRecord> {
    const update: Partial<AgentRow> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.protocol !== undefined) update.protocol = patch.protocol;
    if (patch.callbackUrl !== undefined) update.callback_url = patch.callbackUrl;
    if (patch.authHeaderName !== undefined) update.auth_header_name = patch.authHeaderName;
    if (patch.authHeaderValue !== undefined) update.auth_header_value = patch.authHeaderValue;
    if (patch.timeoutMs !== undefined) update.timeout_ms = patch.timeoutMs;
    if (patch.status !== undefined) update.status = patch.status;

    if (Object.keys(update).length === 0) {
      const existing = await this.get(ownerId, agentId);
      if (!existing) throw new NotFoundError('Agent', agentId);
      return existing;
    }

    const { data, error } = await this.client
      .from('agents')
      .update(update)
      .eq('owner_id', ownerId)
      .eq('id', agentId)
      .select(SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`update agent failed: ${error.message}`);
    if (!data) throw new NotFoundError('Agent', agentId);
    return rowToAgent(data as unknown as AgentRow);
  }

  async delete(ownerId: string, agentId: string): Promise<void> {
    const { error } = await this.client
      .from('agents')
      .delete()
      .eq('owner_id', ownerId)
      .eq('id', agentId);
    if (error) throw new Error(`delete agent failed: ${error.message}`);
  }
}

// 32-byte cryptographic token, base64url-encoded. Prefixed `ag_` so leaked
// tokens are recognizable in logs and alerting.
export function generateRawToken(): string {
  return `ag_${randomBytes(32).toString('base64url')}`;
}

// Internal: shares the sha256-hex algorithm with PostgresAgentInviteStore's
// hashToken. Not exported to avoid colliding on the barrel.
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// Exported for the auth hook so /wait and /action can hash the
// presented bearer token without re-implementing the algorithm.
export function hashAgentToken(rawToken: string): string {
  return hashToken(rawToken);
}

function rowToAgent(r: AgentRow): AgentRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    description: r.description,
    protocol: r.protocol,
    callbackUrl: r.callback_url,
    authHeaderName: r.auth_header_name,
    authHeaderValue: r.auth_header_value,
    timeoutMs: r.timeout_ms,
    status: r.status,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}
