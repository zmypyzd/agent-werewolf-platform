import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const CSRF_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  if (!setCookie) return null;
  const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const line of lines) {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(line);
    if (m) return m[1] ?? null;
  }
  return null;
}

async function register(body: { email: string; password: string; displayName: string }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF_HEADERS,
    payload: JSON.stringify(body),
  });
}

async function login(body: { email: string; password: string }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF_HEADERS,
    payload: JSON.stringify(body),
  });
}

describe('POST /auth/register', () => {
  it('creates a user, returns the public user, and sets the session cookie', async () => {
    const res = await register({ email: 'Alice@Example.test', password: 'hunter22pw', displayName: 'Alice' });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.user.userId).toMatch(/^usr-/);
    expect(body.data.user.email).toBe('alice@example.test');
    expect(body.data.user.displayName).toBe('Alice');

    const sid = cookieValue(res.headers['set-cookie'], 'apk_sid');
    expect(sid).toBeTruthy();

    const cookieLine = (Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie'].join(';')
      : (res.headers['set-cookie'] ?? ''));
    expect(cookieLine).toMatch(/HttpOnly/i);
    expect(cookieLine).toMatch(/SameSite=Lax/i);
    expect(cookieLine).toMatch(/Path=\//);
  });

  it('never echoes the password in the response body', async () => {
    const res = await register({ email: 'a@x.test', password: 'super-secret-pw', displayName: 'A' });
    expect(res.body).not.toContain('super-secret-pw');
    expect(res.body).not.toContain('passwordHash');
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    await register({ email: 'a@x.test', password: 'hunter22pw', displayName: 'A' });
    const dup = await register({ email: 'A@X.test', password: 'hunter22pw', displayName: 'A2' });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects too-short password with 400 SCHEMA_VALIDATION_FAILED', async () => {
    const res = await register({ email: 'a@x.test', password: '12345', displayName: 'A' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('SCHEMA_VALIDATION_FAILED');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await register({ email: 'a@x.test', password: 'hunter22pw', displayName: 'A' });
  });

  it('returns 200 + public user + session cookie on valid credentials', async () => {
    const res = await login({ email: 'a@x.test', password: 'hunter22pw' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.user.email).toBe('a@x.test');
    expect(cookieValue(res.headers['set-cookie'], 'apk_sid')).toBeTruthy();
  });

  it('returns 401 UNAUTHENTICATED on wrong password without revealing whether the email exists', async () => {
    const wrongPw = await login({ email: 'a@x.test', password: 'WRONG-pw' });
    const wrongEmail = await login({ email: 'nope@x.test', password: 'whatever' });

    expect(wrongPw.statusCode).toBe(401);
    expect(wrongEmail.statusCode).toBe(401);
    expect(JSON.parse(wrongPw.body).error.message).toBe(JSON.parse(wrongEmail.body).error.message);
    expect(JSON.parse(wrongPw.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('login is case-insensitive on email', async () => {
    const res = await login({ email: 'A@X.test', password: 'hunter22pw' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /auth/me', () => {
  it('returns 401 when no cookie is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user when the session cookie is valid', async () => {
    const reg = await register({ email: 'a@x.test', password: 'hunter22pw', displayName: 'A' });
    const sid = cookieValue(reg.headers['set-cookie'], 'apk_sid')!;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { apk_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.user.email).toBe('a@x.test');
  });
});

describe('POST /auth/logout', () => {
  it('clears the cookie and returns 204; second call still returns 204 (idempotent)', async () => {
    const reg = await register({ email: 'a@x.test', password: 'hunter22pw', displayName: 'A' });
    const sid = cookieValue(reg.headers['set-cookie'], 'apk_sid')!;

    const out1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: CSRF_HEADERS,
      cookies: { apk_sid: sid },
    });
    expect(out1.statusCode).toBe(204);
    const cookieLine = (Array.isArray(out1.headers['set-cookie'])
      ? out1.headers['set-cookie'].join(';')
      : (out1.headers['set-cookie'] ?? ''));
    expect(cookieLine).toMatch(/apk_sid=/);

    const out2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: CSRF_HEADERS,
    });
    expect(out2.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { apk_sid: sid },
    });
    expect(me.statusCode).toBe(401);
  });
});
