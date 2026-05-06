import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games info isolation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function post(url: string, body: unknown) {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      payload: body,
    });
  }

  async function get(url: string) {
    return app.inject({ method: 'GET', url });
  }

  it('POST /werewolf-games never echoes seed even when supplied', async () => {
    const res = await post('/api/v1/werewolf-games', { name: 'iso', seed: 'leak-me' });
    expect(res.body).not.toContain('leak-me');
    expect(res.body).not.toContain('"seed"');
  });

  it('GET /werewolf-games/:id never includes seed', async () => {
    const created = await post('/api/v1/werewolf-games', {
      name: 'iso',
      seed: 'leak-me',
    });
    const { gameId } = created.json().data as { gameId: string };
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    expect(res.body).not.toContain('leak-me');
    expect(res.body).not.toContain('"seed"');
  });

  it('seat info never carries role or side fields before completion', async () => {
    const created = await post('/api/v1/werewolf-games', { name: 'iso' });
    const { gameId } = created.json().data as { gameId: string };
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    const { data } = res.json();
    for (const seat of data.seats) {
      expect(seat).not.toHaveProperty('role');
      expect(seat).not.toHaveProperty('side');
      expect(seat.occupant).not.toHaveProperty('role');
      expect(seat.occupant).not.toHaveProperty('side');
    }
  });
});
