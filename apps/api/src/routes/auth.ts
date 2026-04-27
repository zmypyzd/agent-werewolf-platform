import '@fastify/cookie';
import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ZodError } from 'zod';
import { RateLimitedError, SchemaValidationError } from '@agent-poker/shared';
import {
  LoginRequestSchema,
  PublicUserSchema,
  RegisterRequestSchema,
} from '@agent-poker/agent-protocol';
import type { IUserStore, ISessionStore, User } from '@agent-poker/persistence';
import {
  SESSION_COOKIE_NAME,
  UnauthenticatedError,
  clearCookieOptions,
  createSession,
  destroySession,
  hashPassword,
  sessionCookieOptions,
  verifyPassword,
} from '@agent-poker/auth';
import type { RateLimiter, RuntimeEnv, SessionConfig } from '@agent-poker/auth';

interface AuthRoutesOptions extends FastifyPluginOptions {
  userStore: IUserStore;
  sessionStore: ISessionStore;
  env: RuntimeEnv;
  sessionConfig?: SessionConfig;
  rateLimiter?: RateLimiter;
}

function toPublicUser(u: User) {
  return PublicUserSchema.parse({
    userId: u.userId,
    email: u.email,
    displayName: u.displayName,
  });
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const { userStore, sessionStore, env, rateLimiter } = opts;

  const checkRate = async (req: { ip: string }) => {
    if (!rateLimiter) return;
    const result = rateLimiter.check(req.ip);
    if (!result.ok) throw new RateLimitedError(result.retryAfterMs);
  };

  app.post('/auth/register', { preHandler: [app.requireCsrf, checkRate] }, async (req, reply) => {
    let body;
    try {
      body = RegisterRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    const passwordHash = await hashPassword(body.password);
    const user = await userStore.createUser({
      userId: `usr-${randomUUID().slice(0, 12)}`,
      email: body.email,
      passwordHash,
      displayName: body.displayName,
    });

    const { sessionId, expiresAt } = await createSession(sessionStore, user.userId);
    const ttlMs = expiresAt - Date.now();
    reply.setCookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(env, ttlMs));
    reply.status(201).send({ data: { user: toPublicUser(user) } });
  });

  app.post('/auth/login', { preHandler: [app.requireCsrf, checkRate] }, async (req, reply) => {
    let body;
    try {
      body = LoginRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    const user = await userStore.findByEmail(body.email);
    const ok = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthenticatedError('invalid credentials');
    }

    if (req.sessionId) {
      await destroySession(sessionStore, req.sessionId);
    }

    const { sessionId, expiresAt } = await createSession(sessionStore, user.userId);
    const ttlMs = expiresAt - Date.now();
    reply.setCookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(env, ttlMs));
    reply.status(200).send({ data: { user: toPublicUser(user) } });
  });

  app.post('/auth/logout', { preHandler: [app.requireCsrf] }, async (req, reply) => {
    if (req.sessionId) {
      await destroySession(sessionStore, req.sessionId);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions());
    reply.status(204).send();
  });

  app.get('/auth/me', { preHandler: [app.requireAuth] }, async (req, reply) => {
    reply.send({ data: { user: toPublicUser(req.user!) } });
  });
}
