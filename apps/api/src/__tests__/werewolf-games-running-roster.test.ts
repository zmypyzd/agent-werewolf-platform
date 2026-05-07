import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

// Regression: ISSUE-005 follow-up. The unit-tested orchestrator emit of
// role/side on `match.started` doesn't reach the spectator surface end-to-
// end because the web client subscribes to the match WS topic AFTER the
// status flips to 'running' — which is after match.started has already
// been published, and the topic doesn't replay. Fix the entry path
// instead: once the match is running (or completed), let
// /api/v1/werewolf-games/:id carry role + side per seat. The web reducer
// already polls this endpoint every 2-5s for lobby-sync; it just needs
// the data to be there. This covers fresh-start, refresh-mid-match,
// late-join, and reconnect — every entry path, not just the WS-timing
// one.
//
// Pre-start (`status='waiting' | 'ready'`) the existing isolation
// invariant holds: no role/side leak.
// `apps/api/src/__tests__/werewolf-games-info-isolation.test.ts:47`
// pins that. This test pins the post-start exposure.

describe('werewolf-games — role/side roster after start', () => {
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
        email: `roster-${Math.random().toString(36).slice(2)}@x.test`,
        password: 'hunter22pw',
        displayName: 'Roster',
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

  async function post(url: string, body: Record<string, unknown> = {}) {
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

  const KNOWN_ROLES = new Set(['werewolf', 'villager', 'seer', 'witch', 'hunter']);
  const KNOWN_SIDES = new Set(['good', 'werewolf']);

  it('GET /werewolf-games/:id includes role + side per seat once status="running"', async () => {
    const created = await post('/api/v1/werewolf-games', {
      name: 'roster',
      seed: 'roster-seed',
    });
    const { gameId } = created.json().data as { gameId: string };
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    await post(`/api/v1/werewolf-games/${gameId}/start`);

    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    const { data } = res.json();
    // status is 'running' or 'completed' depending on how fast the random-
    // mock match wraps up. Either way roles must be exposed.
    expect(['running', 'completed']).toContain(data.status);

    expect(data.seats.length).toBe(9);
    let wolfCount = 0;
    for (const seat of data.seats) {
      expect(typeof seat.role).toBe('string');
      expect(typeof seat.side).toBe('string');
      expect(KNOWN_ROLES.has(seat.role)).toBe(true);
      expect(KNOWN_SIDES.has(seat.side)).toBe(true);
      // Side derived from role: only werewolves are on the werewolf side.
      if (seat.role === 'werewolf') {
        expect(seat.side).toBe('werewolf');
        wolfCount++;
      } else {
        expect(seat.side).toBe('good');
      }
    }
    // Engine deals exactly 3 wolves in a 9-seat game.
    expect(wolfCount).toBe(3);
  });

  it('GET /werewolf-games/:id does NOT include role/side before start (pre-existing invariant)', async () => {
    const created = await post('/api/v1/werewolf-games', { name: 'no-leak' });
    const { gameId } = created.json().data as { gameId: string };
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    // Status is now 'ready' — fully filled, but match hasn't started.
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    const { data } = res.json();
    expect(data.status).toBe('ready');
    for (const seat of data.seats) {
      expect(seat).not.toHaveProperty('role');
      expect(seat).not.toHaveProperty('side');
    }
  });

  it('seed never appears in the running-status payload (existing invariant still holds)', async () => {
    const created = await post('/api/v1/werewolf-games', {
      name: 'no-seed-leak',
      seed: 'should-stay-hidden',
    });
    const { gameId } = created.json().data as { gameId: string };
    await post(`/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    await post(`/api/v1/werewolf-games/${gameId}/start`);
    const res = await get(`/api/v1/werewolf-games/${gameId}`);
    expect(res.body).not.toContain('should-stay-hidden');
    expect(res.body).not.toContain('"seed"');
  });
});
