import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  openDatabase,
  SqliteSessionStore,
  SqliteUserStore,
} from '@agent-poker/persistence';
import type { SqliteDb } from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';
import { authPlugin } from '../fastify-plugin.js';
import { CsrfError, UnauthenticatedError } from '../errors.js';
import { createSession } from '../sessions.js';

async function buildTestApp(db: SqliteDb): Promise<{
  app: FastifyInstance;
  users: SqliteUserStore;
  sessions: SqliteSessionStore;
}> {
  const users = new SqliteUserStore(db);
  const sessions = new SqliteSessionStore(db);

  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthenticatedError) return reply.code(401).send({ code: err.code });
    if (err instanceof CsrfError) return reply.code(403).send({ code: err.code });
    if (err instanceof AppError) return reply.code(400).send({ code: err.code });
    return reply.code(500).send({ code: 'INTERNAL', message: err.message });
  });

  await app.register(authPlugin, {
    userStore: users,
    sessionStore: sessions,
    env: 'test',
    sessionConfig: { ttlMs: 60_000 },
  });

  app.get('/whoami', async req => ({ user: req.user, sessionId: req.sessionId }));

  app.get('/me', { preHandler: [app.requireAuth] }, async req => ({
    userId: req.user!.userId,
    email: req.user!.email,
  }));

  app.post(
    '/protected',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async () => ({ ok: true }),
  );

  await app.ready();
  return { app, users, sessions };
}

describe('authPlugin', () => {
  let db: SqliteDb;
  let app: FastifyInstance;
  let users: SqliteUserStore;
  let sessions: SqliteSessionStore;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    ({ app, users, sessions } = await buildTestApp(db));
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET on a protected route without a cookie returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('UNAUTHENTICATED');
  });

  it('GET on a public route exposes request.user = null when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toBeNull();
    expect(body.sessionId).toBeNull();
  });

  it('GET on a protected route with a valid session returns the user', async () => {
    const created = await users.createUser({
      userId: 'u-1',
      email: 'a@x.test',
      passwordHash: 'h',
      displayName: 'A',
    });
    const { sessionId } = await createSession(sessions, created.userId, { ttlMs: 60_000 });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { apk_sid: sessionId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('u-1');
    expect(body.email).toBe('a@x.test');
  });

  it('an expired session cookie is treated as unauthenticated and the cookie is cleared', async () => {
    const created = await users.createUser({
      userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A',
    });
    // Insert a session that is already expired by now.
    await sessions.create('expired-sid', created.userId, Date.now() - 1000);

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { apk_sid: 'expired-sid' },
    });

    expect(res.statusCode).toBe(401);
    const setCookie = res.headers['set-cookie'];
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
    expect(setCookieStr).toMatch(/apk_sid=/);
    expect(setCookieStr).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('an unknown sessionId falls through to 401 without crashing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { apk_sid: 'never-existed' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST on a protected route without X-Requested-With returns 403 (CSRF)', async () => {
    const created = await users.createUser({
      userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A',
    });
    const { sessionId } = await createSession(sessions, created.userId, { ttlMs: 60_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/protected',
      cookies: { apk_sid: sessionId },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('CSRF_FAILED');
  });

  it('POST on a protected route with X-Requested-With: fetch succeeds', async () => {
    const created = await users.createUser({
      userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A',
    });
    const { sessionId } = await createSession(sessions, created.userId, { ttlMs: 60_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/protected',
      cookies: { apk_sid: sessionId },
      headers: { 'x-requested-with': 'fetch' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('valid session sliding: expiry advances forward on each request', async () => {
    const created = await users.createUser({
      userId: 'u-1', email: 'a@x.test', passwordHash: 'h', displayName: 'A',
    });
    const { sessionId, expiresAt: firstExpiry } = await createSession(
      sessions,
      created.userId,
      { ttlMs: 60_000 },
    );

    await new Promise(r => setTimeout(r, 10));

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { apk_sid: sessionId },
    });
    expect(res.statusCode).toBe(200);

    const stored = await sessions.find(sessionId);
    expect(stored).not.toBeNull();
    expect(stored!.expiresAt).toBeGreaterThanOrEqual(firstExpiry);
  });
});
