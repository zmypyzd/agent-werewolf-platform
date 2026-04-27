import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

let app: FastifyInstance;
beforeEach(async () => { app = buildServer(); await app.ready(); });
afterEach(async () => { await app.close(); });

describe('GET /health', () => {
  it('returns 200 with status, uptimeMs, version (no auth required)', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: { status: string; uptimeMs: number; version: string } };
    expect(body.data.status).toBe('ok');
    expect(typeof body.data.uptimeMs).toBe('number');
    expect(body.data.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.data.version).toBe('string');
  });
});
