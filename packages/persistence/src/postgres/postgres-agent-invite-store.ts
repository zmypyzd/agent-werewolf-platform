import { createHash } from 'crypto';
import type { SupabaseServiceClient, SupabaseUserClient } from './supabase-clients.js';

// Postgres impl of agent-invite storage. Differs from the SQLite
// implementation in two ways:
//
//   1. We store sha256(token) as the PK, never the raw token. The raw is
//      shown to the user once at creation time and never persisted.
//   2. We don't expose the legacy IAgentInviteStore interface verbatim
//      because that interface presumed raw-token PK lookups. Phase 1's
//      route changes call findByToken(rawToken) which transparently
//      hashes before SELECT.

export interface AgentInviteRecord {
  readonly tokenHash: string;
  readonly ownerId: string;
  readonly displayName: string | null;
  readonly notes: string | null;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly revokedAt: number | null;
  readonly registeredAgentId: string | null;
  readonly createdAt: number;
  readonly live: boolean;
}

export interface NewAgentInvitePg {
  readonly rawToken: string;
  readonly ownerId: string;
  readonly displayName?: string | null;
  readonly notes?: string | null;
  readonly expiresAt: number;
}

export interface IAgentInviteStorePg {
  create(input: NewAgentInvitePg): Promise<AgentInviteRecord>;
  list(ownerId: string): Promise<AgentInviteRecord[]>;
  findByRawToken(rawToken: string): Promise<AgentInviteRecord | null>;
  markUsed(rawToken: string, registeredAgentId: string): Promise<void>;
  revokeUnused(ownerId: string, rawToken: string): Promise<boolean>;
}

interface InviteRow {
  token_hash: string;
  owner_id: string;
  display_name: string | null;
  notes: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  registered_agent_id: string | null;
  created_at: string;
}

const SELECT_COLUMNS =
  'token_hash, owner_id, display_name, notes, expires_at, used_at, revoked_at, registered_agent_id, created_at';

export class PostgresAgentInviteStore implements IAgentInviteStorePg {
  constructor(private readonly client: SupabaseServiceClient | SupabaseUserClient) {}

  async create(input: NewAgentInvitePg): Promise<AgentInviteRecord> {
    const tokenHash = hashToken(input.rawToken);
    const { data, error } = await this.client
      .from('agent_invites')
      .insert({
        token_hash: tokenHash,
        owner_id: input.ownerId,
        display_name: input.displayName ?? null,
        notes: input.notes ?? null,
        expires_at: new Date(input.expiresAt).toISOString(),
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw new Error(`create invite failed: ${error.message}`);
    return rowToInvite(data as unknown as InviteRow);
  }

  async list(ownerId: string): Promise<AgentInviteRecord[]> {
    const { data, error } = await this.client
      .from('agent_invites')
      .select(SELECT_COLUMNS)
      .eq('owner_id', ownerId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`list invites failed: ${error.message}`);
    return ((data ?? []) as InviteRow[]).map(rowToInvite);
  }

  async findByRawToken(rawToken: string): Promise<AgentInviteRecord | null> {
    const tokenHash = hashToken(rawToken);
    const { data, error } = await this.client
      .from('agent_invites')
      .select(SELECT_COLUMNS)
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (error) throw new Error(`findByRawToken failed: ${error.message}`);
    return data ? rowToInvite(data as unknown as InviteRow) : null;
  }

  async markUsed(rawToken: string, registeredAgentId: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const { error } = await this.client
      .from('agent_invites')
      .update({
        used_at: new Date().toISOString(),
        registered_agent_id: registeredAgentId,
      })
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .is('revoked_at', null);
    if (error) throw new Error(`markUsed failed: ${error.message}`);
  }

  async revokeUnused(ownerId: string, rawToken: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const { data, error } = await this.client
      .from('agent_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('owner_id', ownerId)
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .is('revoked_at', null)
      .select('token_hash');
    if (error) throw new Error(`revokeUnused failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function rowToInvite(r: InviteRow): AgentInviteRecord {
  return {
    tokenHash: r.token_hash,
    ownerId: r.owner_id,
    displayName: r.display_name,
    notes: r.notes,
    expiresAt: new Date(r.expires_at).getTime(),
    usedAt: r.used_at ? new Date(r.used_at).getTime() : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at).getTime() : null,
    registeredAgentId: r.registered_agent_id,
    createdAt: new Date(r.created_at).getTime(),
    live:
      r.used_at === null &&
      r.revoked_at === null &&
      Date.parse(r.expires_at) > Date.now(),
  };
}
