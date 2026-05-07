import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games routes', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
    // D1=A — all mutating werewolf routes require auth. Register a user once
    // per test so the inject() helper can attach the resulting session cookie.
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      payload: JSON.stringify({
        email: `ww-${Math.random().toString(36).slice(2)}@x.test`,
        password: 'hunter22pw',
        displayName: 'WW',
      }),
    });
    const setCookie = Array.isArray(reg.headers['set-cookie'])
      ? reg.headers['set-cookie'].join(';')
      : reg.headers['set-cookie'] ?? '';
    cookie = setCookie.match(/apk_sid=([^;]+)/)![1]!;
  });

  afterEach(async () => {
    await app.close();
  });

  function inject(method: string, url: string, body?: Record<string, unknown>) {
    return app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: {
        'X-Requested-With': 'fetch',
        'Content-Type': 'application/json',
      },
      cookies: { apk_sid: cookie },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
  }

  it('POST /werewolf-games creates a waiting game with 9 empty seats', async () => {
    const res = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data.status).toBe('waiting');
    expect(data.seats).toHaveLength(9);
    expect(
      data.seats.every(
        (s: { occupant: { kind: string } }) => s.occupant.kind === 'empty',
      ),
    ).toBe(true);
  });

  it('GET /werewolf-games lists created games', async () => {
    await inject('POST', '/api/v1/werewolf-games', { name: 'a' });
    await new Promise((r) => setTimeout(r, 2));
    await inject('POST', '/api/v1/werewolf-games', { name: 'b' });
    const res = await inject('GET', '/api/v1/werewolf-games');
    const { data } = res.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('b');
    expect(data[0].seatedCount).toBe(0);
    expect(data[0].seats).toBeUndefined();
  });

  it('GET /werewolf-games/:id returns full lobby entry', async () => {
    const created = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = created.json().data as { gameId: string };
    const res = await inject('GET', `/api/v1/werewolf-games/${gameId}`);
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.gameId).toBe(gameId);
    expect(data.seats).toHaveLength(9);
  });

  it('GET /werewolf-games/:id 404s for unknown ids', async () => {
    const res = await inject('GET', '/api/v1/werewolf-games/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('WEREWOLF_GAME_NOT_FOUND');
  });

  it('POST /seats/:i/invite-npc occupies one seat', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`,
      {},
    );
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.seats[0].occupant.kind).toBe('npc');
    expect(
      data.seats
        .slice(1)
        .every((s: { occupant: { kind: string } }) => s.occupant.kind === 'empty'),
    ).toBe(true);
    expect(data.status).toBe('waiting');
  });

  it('POST invite-npc on occupied seat returns 409', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    await inject('POST', `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`, {});
    const res = await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/0/invite-npc`,
      {},
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WEREWOLF_SEAT_OCCUPIED');
  });

  it('POST /fill-with-npcs flips status to ready', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/fill-with-npcs`,
      {},
    );
    const { data } = res.json();
    expect(data.status).toBe('ready');
    expect(
      data.seats.every(
        (s: { occupant: { kind: string } }) => s.occupant.kind === 'npc',
      ),
    ).toBe(true);
  });

  it('POST /start before ready returns 409', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/start`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WEREWOLF_GAME_NOT_READY');
  });

  it('POST /start after fill returns 202 and flips to running', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', {
      name: 'demo',
      seed: 'werewolf-seed-001',
    });
    const { gameId } = c.json().data;
    await inject('POST', `/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    const res = await inject('POST', `/api/v1/werewolf-games/${gameId}/start`, {});
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe('running');
  });

  it('POST without X-Requested-With header is rejected by CSRF (with auth)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/werewolf-games',
      headers: { 'Content-Type': 'application/json' },
      cookies: { apk_sid: cookie },
      payload: { name: 'demo' },
    });
    expect(res.statusCode).toBe(403);
  });

  // D1=A — all mutating werewolf routes added requireAuth. Without a cookie
  // the auth gate fires first (401), before the existing CSRF gate.
  it('POST without auth cookie returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/werewolf-games',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      payload: { name: 'demo' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ---- POST /werewolf-games/:id/seats/:i/invite-agent --------------------

  async function createCfgForCurrentUser() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agents',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      cookies: { apk_sid: cookie },
      payload: JSON.stringify({
        agentName: 'MyWolfBot',
        endpointUrl: 'https://example.test/wolf',
        authHeaderName: null,
        authHeaderValue: null,
        timeoutMs: 5000,
        description: null,
      }),
    });
    return res.json().data.agentConfigId as string;
  }

  it('invite-agent happy path: seat fills as kind:agent with isMine for owner', async () => {
    const cfgId = await createCfgForCurrentUser();
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/0/invite-agent`,
      { agentConfigId: cfgId },
    );
    expect(res.statusCode).toBe(200);
    const seat = res.json().data.seats[0];
    expect(seat.occupant.kind).toBe('agent');
    expect(seat.occupant.displayName).toBe('MyWolfBot');
    expect(seat.occupant.isMine).toBe(true);
    expect(seat.occupant).not.toHaveProperty('ownerUserId');
    expect(seat.occupant).not.toHaveProperty('agentConfigId');
  });

  it('invite-agent without auth cookie returns 401', async () => {
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/werewolf-games/${gameId}/seats/0/invite-agent`,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      payload: { agentConfigId: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('invite-agent with another user\'s agentConfigId returns 404 AGENT_NOT_FOUND (no privacy leak)', async () => {
    // user-A registers cfg
    const cfgId = await createCfgForCurrentUser();
    // user-B logs in (separate account) and tries to seat A's cfg in their own game
    const otherReg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      payload: JSON.stringify({
        email: `attacker-${Math.random().toString(36).slice(2)}@x.test`,
        password: 'hunter22pw',
        displayName: 'X',
      }),
    });
    const otherCookie = (Array.isArray(otherReg.headers['set-cookie'])
      ? otherReg.headers['set-cookie'].join(';')
      : otherReg.headers['set-cookie'] ?? '').match(/apk_sid=([^;]+)/)![1]!;
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/werewolf-games',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      cookies: { apk_sid: otherCookie },
      payload: { name: 'attacker-game' },
    });
    const { gameId } = c.json().data;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/werewolf-games/${gameId}/seats/0/invite-agent`,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      cookies: { apk_sid: otherCookie },
      payload: { agentConfigId: cfgId },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AGENT_NOT_FOUND');
  });

  it('invite-agent rejects double-seat of the same cfg in one game with 409 AGENT_IN_USE', async () => {
    const cfgId = await createCfgForCurrentUser();
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/0/invite-agent`,
      { agentConfigId: cfgId },
    );
    const res = await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/1/invite-agent`,
      { agentConfigId: cfgId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AGENT_IN_USE');
  });

  it('GET /werewolf-games/:id without auth does NOT include isMine for agent seats', async () => {
    // owner seats agent
    const cfgId = await createCfgForCurrentUser();
    const c = await inject('POST', '/api/v1/werewolf-games', { name: 'demo' });
    const { gameId } = c.json().data;
    await inject(
      'POST',
      `/api/v1/werewolf-games/${gameId}/seats/0/invite-agent`,
      { agentConfigId: cfgId },
    );
    // anonymous GET (no cookie)
    const res = await app.inject({ method: 'GET', url: `/api/v1/werewolf-games/${gameId}` });
    expect(res.statusCode).toBe(200);
    const seat = res.json().data.seats[0];
    expect(seat.occupant.kind).toBe('agent');
    expect(seat.occupant.isMine).toBeUndefined();
    expect(seat.occupant).not.toHaveProperty('ownerUserId');
    expect(seat.occupant).not.toHaveProperty('agentConfigId');
  });
});
