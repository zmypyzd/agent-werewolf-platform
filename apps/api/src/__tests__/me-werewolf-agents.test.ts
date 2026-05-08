import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  hashAgentToken,
  type AgentRecord,
  type CreateAgentResult,
  type IAgentStore,
  type IWerewolfDecisionMailbox,
  type MailboxActionRow,
  type MailboxEnqueueInput,
  type MailboxRequestRow,
  type MailboxSubmitInput,
  type NewAgent,
  type PatchAgent,
} from '@agent-poker/persistence';
import { MailboxOwnershipError } from '@agent-poker/persistence';
import { buildServer } from '../server.js';

const CSRF = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

// ─── In-memory fakes ───────────────────────────────────────────────────

class FakeAgentStore implements IAgentStore {
  private readonly byHash = new Map<string, AgentRecord>();
  private readonly byId = new Map<string, AgentRecord>();
  private nextSeq = 1;

  async findByTokenHash(tokenHash: string): Promise<AgentRecord | null> {
    return this.byHash.get(tokenHash) ?? null;
  }

  async list(ownerId: string): Promise<AgentRecord[]> {
    return [...this.byId.values()].filter((a) => a.ownerId === ownerId);
  }

  async get(ownerId: string, agentId: string): Promise<AgentRecord | null> {
    const r = this.byId.get(agentId);
    return r && r.ownerId === ownerId ? r : null;
  }

  async getById(agentId: string): Promise<AgentRecord | null> {
    return this.byId.get(agentId) ?? null;
  }

  async create(input: NewAgent): Promise<CreateAgentResult> {
    const id = randomUUID();
    const now = Date.now() + this.nextSeq++;
    const agent: AgentRecord = {
      id,
      ownerId: input.ownerId,
      name: input.name,
      description: input.description ?? null,
      protocol: input.protocol,
      callbackUrl: input.callbackUrl ?? null,
      authHeaderName: input.authHeaderName ?? null,
      authHeaderValue: input.authHeaderValue ?? null,
      timeoutMs: input.timeoutMs ?? 30_000,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, agent);
    let rawToken: string | null = null;
    if (input.protocol === 'longpoll') {
      rawToken = `ag_${randomUUID().replace(/-/g, '')}`;
      this.byHash.set(hashAgentToken(rawToken), agent);
    }
    return { agent, rawToken };
  }

  async update(_o: string, id: string, _p: PatchAgent): Promise<AgentRecord> {
    return this.byId.get(id)!;
  }

  async rotateToken(
    ownerId: string,
    agentId: string,
  ): Promise<{ agent: AgentRecord; rawToken: string }> {
    const agent = this.byId.get(agentId);
    if (!agent || agent.ownerId !== ownerId) {
      const err = new Error('Agent not found') as Error & { code?: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
    const rawToken = `ag_${randomUUID().replace(/-/g, '')}`;
    // Drop the old hash mapping; install the new one. The agents table
    // would do this in one UPDATE; the fake mirrors the effect.
    for (const [h, a] of this.byHash.entries()) {
      if (a.id === agentId) this.byHash.delete(h);
    }
    this.byHash.set(hashAgentToken(rawToken), agent);
    return { agent, rawToken };
  }

  async delete(ownerId: string, agentId: string): Promise<void> {
    const agent = this.byId.get(agentId);
    if (!agent || agent.ownerId !== ownerId) return;
    this.byId.delete(agentId);
    for (const [h, a] of this.byHash.entries()) {
      if (a.id === agentId) this.byHash.delete(h);
    }
  }
}

// Minimal mailbox stub — only needs to support claimNextRequest +
// submitAction for the round-trip test. Other methods are no-ops.
class FakeMailbox implements IWerewolfDecisionMailbox {
  private readonly requests = new Map<string, MailboxRequestRow>();
  private readonly pendingByAgent = new Map<string, string[]>();

  enqueueSync(input: MailboxEnqueueInput): MailboxRequestRow {
    const requestId = randomUUID();
    const now = Date.now();
    const row: MailboxRequestRow = {
      requestId,
      matchPk: input.matchPk,
      sequence: input.sequence,
      playerId: input.playerId,
      agentId: input.agentId,
      phase: input.phase,
      statePayload: input.statePayload,
      enqueuedAt: now,
      expiresAt: now + input.ttlSeconds * 1000,
      status: 'pending',
      fulfilledAt: null,
    };
    this.requests.set(requestId, row);
    if (input.agentId !== null) {
      const queue = this.pendingByAgent.get(input.agentId) ?? [];
      queue.push(requestId);
      this.pendingByAgent.set(input.agentId, queue);
    }
    return row;
  }

  async enqueueRequest(input: MailboxEnqueueInput): Promise<MailboxRequestRow> {
    return this.enqueueSync(input);
  }
  async waitForAction(): Promise<MailboxActionRow | null> { return null; }
  async cancelRequest(): Promise<void> {}
  async expireOverdue(): Promise<number> { return 0; }
  async claimNextRequest(agentId: string): Promise<MailboxRequestRow | null> {
    const queue = this.pendingByAgent.get(agentId);
    if (!queue || queue.length === 0) return null;
    const requestId = queue.shift()!;
    this.pendingByAgent.set(agentId, queue);
    return this.requests.get(requestId) ?? null;
  }
  async submitAction(_input: MailboxSubmitInput): Promise<void> {
    if (!this.requests.has(_input.requestId)) {
      throw new MailboxOwnershipError(`no request ${_input.requestId}`);
    }
  }
}

// ─── Test setup ────────────────────────────────────────────────────────

describe('/me/werewolf-agents', () => {
  let app: FastifyInstance;
  let agentStore: FakeAgentStore;
  let cookie: string;

  beforeEach(async () => {
    agentStore = new FakeAgentStore();
    app = buildServer({
      werewolfAgentStore: agentStore,
      werewolfMailbox: new FakeMailbox(),
    });
    await app.ready();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: CSRF,
      payload: JSON.stringify({ email: 'wolf@x.test', password: 'hunter22pw', displayName: 'W' }),
    });
    const setCookie = Array.isArray(reg.headers['set-cookie'])
      ? reg.headers['set-cookie'].join(';')
      : reg.headers['set-cookie'] ?? '';
    cookie = setCookie.match(/apk_sid=([^;]+)/)![1]!;
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── POST ────────────────────────────────────────────────────────────

  it('POST returns 201 with the agent DTO + raw token (token shown once)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'WerewolfBot', description: 'a bot' }),
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.data.agent.name).toBe('WerewolfBot');
    expect(body.data.agent.protocol).toBe('longpoll');
    expect(typeof body.data.rawToken).toBe('string');
    expect(body.data.rawToken).toMatch(/^ag_/);
    // token_hash must never leak.
    expect(JSON.stringify(body)).not.toContain('token_hash');
    expect(body.data.agent).not.toHaveProperty('tokenHash');
  });

  it('POST with timeoutMs out of range returns 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Bot', timeoutMs: 999 }), // < 1000ms floor
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST without auth returns 401', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      payload: JSON.stringify({ name: 'Bot' }),
    });
    expect(r.statusCode).toBe(401);
  });

  it('POST without X-Requested-With returns 403 (CSRF)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: { 'content-type': 'application/json' },
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Bot' }),
    });
    expect(r.statusCode).toBe(403);
  });

  // ─── GET ─────────────────────────────────────────────────────────────

  it('GET lists only the requesting owner\'s agents and never includes raw tokens', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Alpha' }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Beta' }),
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/me/werewolf-agents',
      cookies: { apk_sid: cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((a: { name: string }) => a.name).sort()).toEqual(['Alpha', 'Beta']);
    // No raw token re-issued on read.
    expect(JSON.stringify(body)).not.toMatch(/ag_[A-Za-z0-9]/);
  });

  // ─── DELETE ──────────────────────────────────────────────────────────

  it('DELETE returns 204 and revokes the token (subsequent /wait with the same token → 401)', async () => {
    // Use a shared mailbox so we can pre-queue work — keeps /wait from
    // burning its full 25s long-poll budget.
    await app.close();
    const mailbox = new FakeMailbox();
    app = buildServer({
      werewolfAgentStore: agentStore,
      werewolfMailbox: mailbox,
    });
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: CSRF,
      payload: JSON.stringify({ email: 'wolf-del@x.test', password: 'hunter22pw', displayName: 'W' }),
    });
    const setCookie = Array.isArray(reg.headers['set-cookie'])
      ? reg.headers['set-cookie'].join(';')
      : reg.headers['set-cookie'] ?? '';
    cookie = setCookie.match(/apk_sid=([^;]+)/)![1]!;

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Doomed' }),
    });
    const created = JSON.parse(create.body).data;
    const rawToken = created.rawToken as string;
    const agentId = created.agent.agentId as string;

    // Pre-queue a request so /wait returns immediately (no long-poll wait).
    mailbox.enqueueSync({
      matchPk: randomUUID(),
      sequence: 1,
      playerId: 'p1',
      agentId,
      phase: 'day-vote',
      statePayload: { hello: 'world' },
      ttlSeconds: 60,
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf/wait',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/werewolf-agents/${agentId}`,
      headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(del.statusCode).toBe(204);

    // Token rejected after delete (auth fails before the long-poll
    // path even runs, so this returns immediately).
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf/wait',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('DELETE for an unknown id returns 404', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/v1/me/werewolf-agents/${randomUUID()}`,
      headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  // ─── rotate-token ────────────────────────────────────────────────────

  it('rotate-token returns a new raw token and invalidates the old one', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'Rotated' }),
    });
    const created = JSON.parse(create.body).data;
    const oldToken = created.rawToken as string;
    const agentId = created.agent.agentId as string;

    const rotate = await app.inject({
      method: 'POST',
      url: `/api/v1/me/werewolf-agents/${agentId}/rotate-token`,
      headers: CSRF,
      cookies: { apk_sid: cookie },
    });
    expect(rotate.statusCode).toBe(200);
    const newToken = JSON.parse(rotate.body).data.rawToken as string;
    expect(newToken).not.toBe(oldToken);

    const oldResp = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf/wait',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(oldResp.statusCode).toBe(401);
  });

  // ─── End-to-end: create → mailbox enqueue → /wait ────────────────────
  // Proves the full credential plumb-through: an operator-created token
  // authenticates against the mailbox routes and pulls a request that
  // was enqueued for that agent's id.

  it('round-trip: created agent\'s raw token successfully claims a queued mailbox request', async () => {
    // Re-build with a shared mailbox we control.
    await app.close();
    const mailbox = new FakeMailbox();
    app = buildServer({
      werewolfAgentStore: agentStore,
      werewolfMailbox: mailbox,
    });
    await app.ready();
    // Re-register since we rebuilt the server (auth state lives in
    // SQLite scoped to the buildServer instance).
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: CSRF,
      payload: JSON.stringify({ email: 'wolf2@x.test', password: 'hunter22pw', displayName: 'W' }),
    });
    const setCookie = Array.isArray(reg.headers['set-cookie'])
      ? reg.headers['set-cookie'].join(';')
      : reg.headers['set-cookie'] ?? '';
    cookie = setCookie.match(/apk_sid=([^;]+)/)![1]!;

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/werewolf-agents',
      headers: CSRF,
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({ name: 'RoundTrip' }),
    });
    const { agent, rawToken } = JSON.parse(create.body).data;

    // Enqueue something for that agent and confirm /wait returns it.
    mailbox.enqueueSync({
      matchPk: randomUUID(),
      sequence: 1,
      playerId: 'p1',
      agentId: agent.agentId,
      phase: 'day-vote',
      statePayload: { hello: 'world' },
      ttlSeconds: 60,
    });
    const wait = await app.inject({
      method: 'GET',
      url: '/api/v1/werewolf/wait',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(wait.statusCode).toBe(200);
    expect(JSON.parse(wait.body).request).toEqual({ hello: 'world' });
  });
});
