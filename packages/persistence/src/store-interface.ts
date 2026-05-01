import type { TableState, HandSummary, ReplayEvent } from '@agent-poker/shared';

export interface ITableStore {
  saveTable(table: TableState): Promise<void>;
  getTable(tableId: string): Promise<TableState | null>;
  listTables(): Promise<TableState[]>;
  deleteTable(tableId: string): Promise<void>;
}

export interface IHandStore {
  saveHandSummary(hand: HandSummary): Promise<void>;
  getHandSummary(handId: string): Promise<HandSummary | null>;
  listHandSummaries(tableId: string): Promise<HandSummary[]>;
  appendReplayEvent(event: ReplayEvent): Promise<void>;
  getReplayEvents(handId: string): Promise<ReplayEvent[]>;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewUser {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface IUserStore {
  createUser(u: NewUser): Promise<User>;
  findById(userId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  sessionId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}

export interface ISessionStore {
  create(sessionId: string, userId: string, expiresAt: number): Promise<void>;
  find(sessionId: string): Promise<Session | null>;
  touch(sessionId: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

// ─── UserAgentConfig ─────────────────────────────────────────────────────────

export interface UserAgentConfig {
  agentConfigId: string;
  userId: string;
  agentName: string;
  endpointUrl: string;
  authHeaderName: string | null;
  authHeaderValue: string | null;
  timeoutMs: number;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewUserAgentConfig {
  agentConfigId: string;
  userId: string;
  agentName: string;
  endpointUrl: string;
  authHeaderName: string | null;
  authHeaderValue: string | null;
  timeoutMs: number;
  description: string | null;
}

export interface PatchUserAgentConfig {
  agentName?: string;
  endpointUrl?: string;
  authHeaderName?: string | null;
  authHeaderValue?: string | null;
  timeoutMs?: number;
  description?: string | null;
}

export interface IUserAgentConfigStore {
  list(userId: string): Promise<UserAgentConfig[]>;
  get(userId: string, agentConfigId: string): Promise<UserAgentConfig | null>;
  create(cfg: NewUserAgentConfig): Promise<UserAgentConfig>;
  update(userId: string, agentConfigId: string, patch: PatchUserAgentConfig): Promise<UserAgentConfig>;
  delete(userId: string, agentConfigId: string): Promise<void>;
}

// ─── AgentInvite ─────────────────────────────────────────────────────────────

export interface AgentInvite {
  token: string;
  ownerUserId: string;
  displayName: string | null;
  notes: string | null;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  registeredAgentConfigId: string | null;
  createdAt: number;
}

export interface NewAgentInvite {
  token: string;
  ownerUserId: string;
  displayName: string | null;
  notes: string | null;
  expiresAt: number;
}

export interface IAgentInviteStore {
  create(invite: NewAgentInvite): Promise<AgentInvite>;
  list(ownerUserId: string): Promise<AgentInvite[]>;
  findByToken(token: string): Promise<AgentInvite | null>;
  markUsed(token: string, registeredAgentConfigId: string): Promise<void>;
  revokeUnused(ownerUserId: string, token: string): Promise<boolean>;
}
