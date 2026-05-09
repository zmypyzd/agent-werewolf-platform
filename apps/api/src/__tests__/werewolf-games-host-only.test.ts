import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

// Regression: before this PR, /werewolf-games/:gameId/start (and the two
// NPC seating endpoints) had no authorization beyond requireAuth — every
// authenticated user could start, fill with NPCs, or invite NPCs into
// any game they discovered in the public lobby list. Concretely:
//   1. Alice creates a game.
//   2. Bob (a different registered user) hits POST /start on Alice's gameId.
//   3. Game starts — Alice never authorized this.
// This is a denial-of-service vector against any host who's still seating
// agents (start while only NPCs are seated produces a "ready" state and
// Bob can flip it to running before Alice invites her own agent).
//
// Now: only the original creator may start, fill, or seat NPCs. Inviting
// one's OWN agent into someone else's lobby is intentionally still
// allowed — that's the multi-host design (multiple users can field
// agents in the same game).

describe('werewolf-games host-only authorization', () => {
  let app: FastifyInstance;
  let aliceCookie: string;
  let bobCookie: string;

  async function register(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      payload: JSON.stringify({ email, password: 'hunter22pw', displayName: email.split('@')[0] }),
    });
    expect(res.statusCode).toBeLessThan(400);
    const setCookie = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie'].join(';')
      : res.headers['set-cookie'] ?? '';
    const m = setCookie.match(/apk_sid=([^;]+)/);
    if (!m) throw new Error('no session cookie set');
    return m[1]!;
  }

  beforeEach(async () => {
    app = await buildServer();
    await app.ready();
    aliceCookie = await register(`alice-${Math.random().toString(36).slice(2)}@x.test`);
    bobCookie = await register(`bob-${Math.random().toString(36).slice(2)}@x.test`);
  });

  afterEach(async () => {
    await app.close();
  });

  async function postAs(cookie: string, url: string, body: Record<string, unknown> = {}) {
    return await app.inject({
      method: 'POST',
      url,
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      cookies: { apk_sid: cookie },
      payload: body,
    });
  }

  it('Bob cannot fill-with-npcs on a game Alice created (403 FORBIDDEN)', async () => {
    const created = await postAs(aliceCookie, '/api/v1/werewolf-games', { name: "alice's lobby" });
    const { gameId } = created.json().data as { gameId: string };

    const res = await postAs(bobCookie, `/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // The lobby must still be empty — Bob's attempt did not partially seat anything.
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/werewolf-games/${gameId}`,
    });
    const seats = (after.json().data as { seats: Array<{ occupant: { kind: string } }> }).seats;
    expect(seats.every((s) => s.occupant.kind === 'empty')).toBe(true);
  });

  it('Bob cannot invite an NPC into a seat in a game Alice created (403 FORBIDDEN)', async () => {
    const created = await postAs(aliceCookie, '/api/v1/werewolf-games', {});
    const { gameId } = created.json().data as { gameId: string };

    const res = await postAs(bobCookie, `/api/v1/werewolf-games/${gameId}/seats/3/invite-npc`, {});
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("Bob cannot start Alice's already-ready lobby (403 FORBIDDEN, status stays 'ready')", async () => {
    const created = await postAs(aliceCookie, '/api/v1/werewolf-games', {});
    const { gameId } = created.json().data as { gameId: string };
    // Alice fills the lobby herself, flipping status to 'ready'.
    const fill = await postAs(aliceCookie, `/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    expect(fill.statusCode).toBe(200);
    expect((fill.json().data as { status: string }).status).toBe('ready');

    // Bob now tries to flip 'ready' → 'running' on Alice's lobby.
    const res = await postAs(bobCookie, `/api/v1/werewolf-games/${gameId}/start`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/werewolf-games/${gameId}`,
    });
    expect((after.json().data as { status: string }).status).toBe('ready');
  });

  it('Alice can do everything on her own lobby (positive control)', async () => {
    const created = await postAs(aliceCookie, '/api/v1/werewolf-games', {});
    const { gameId } = created.json().data as { gameId: string };

    const fill = await postAs(aliceCookie, `/api/v1/werewolf-games/${gameId}/fill-with-npcs`);
    expect(fill.statusCode).toBe(200);

    // start returns 202 Accepted (the run-promise is fire-and-forget).
    const startRes = await postAs(aliceCookie, `/api/v1/werewolf-games/${gameId}/start`);
    expect(startRes.statusCode).toBeLessThan(300);
    expect((startRes.json().data as { status: string }).status).toBe('running');
  });
});
