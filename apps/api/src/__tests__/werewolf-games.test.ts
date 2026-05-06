import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
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

  it('POST without X-Requested-With header is rejected by CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/werewolf-games',
      headers: { 'Content-Type': 'application/json' },
      payload: { name: 'demo' },
    });
    expect(res.statusCode).toBe(403);
  });
});
