import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('werewolf-games info isolation', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      payload: JSON.stringify({
        email: `iso-${Math.random().toString(36).slice(2)}@x.test`,
        password: 'hunter22pw',
        displayName: 'Iso',
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

  async function post(url: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      cookies: { apk_sid: cookie },
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

  it('phase metadata never appears on the public entry before the match starts', async () => {
    // Phase backfill (currentPhase / dayNumber / nightNumber) is meant for
    // late-joining spectators of a *running* match. Before start() flips
    // status to 'running' the engine has not yet emitted any phase.changed
    // event, so the fields must not surface on the lobby endpoint — same
    // pre-start invariant role/side/alive observe.
    const created = await post('/api/v1/werewolf-games', { name: 'iso' });
    const { gameId } = created.json().data as { gameId: string };

    // status: waiting (no seats yet)
    let res = await get(`/api/v1/werewolf-games/${gameId}`);
    let data = res.json().data;
    expect(data.status).toBe('waiting');
    expect(data).not.toHaveProperty('currentPhase');
    expect(data).not.toHaveProperty('dayNumber');
    expect(data).not.toHaveProperty('nightNumber');

    // status: ready (all 9 seats filled, but start() has not been called)
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`, {});
    res = await get(`/api/v1/werewolf-games/${gameId}`);
    data = res.json().data;
    expect(data.status).toBe('ready');
    expect(data).not.toHaveProperty('currentPhase');
    expect(data).not.toHaveProperty('dayNumber');
    expect(data).not.toHaveProperty('nightNumber');
  });
});
