import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/docs/werewolf-agent-guide', () => {
  it('serves the markdown body unauthenticated with text/markdown content-type', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/docs/werewolf-agent-guide',
    });

    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/markdown/);
    // Sanity-check on the doc body — confirms the route picked up the real file
    // rather than a stub. These two anchors are stable section headings the
    // external agents in the issue report were looking for.
    expect(r.body).toContain('# Werewolf HTTP Agent Guide');
    expect(r.body).toContain('## Phase cheat sheet');
    expect(r.body).toContain('selfRole');
  });

  it('does not require auth or CSRF (public docs endpoint)', async () => {
    // No cookie, no x-requested-with — both should be irrelevant for GET.
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/docs/werewolf-agent-guide',
      headers: {},
    });
    expect(r.statusCode).toBe(200);
  });
});
