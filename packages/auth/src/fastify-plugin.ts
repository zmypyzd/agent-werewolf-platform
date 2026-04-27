import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ISessionStore, IUserStore, User } from '@agent-poker/persistence';

import { SESSION_COOKIE_NAME, clearCookieOptions, sessionCookieOptions } from './cookie.js';
import { assertCsrfHeader } from './csrf.js';
import { CsrfError, UnauthenticatedError } from './errors.js';
import type { SessionConfig } from './sessions.js';
import { DEFAULT_SESSION_CONFIG, validateSession } from './sessions.js';
import type { RuntimeEnv } from './config.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler;
    requireCsrf: preHandlerHookHandler;
  }
}

export interface AuthPluginOptions {
  userStore: IUserStore;
  sessionStore: ISessionStore;
  sessionConfig?: SessionConfig;
  env?: RuntimeEnv;
  cookieSecret?: string;
}

const pluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const env: RuntimeEnv = opts.env ?? (process.env.NODE_ENV as RuntimeEnv) ?? 'development';
  const sessionConfig = opts.sessionConfig ?? DEFAULT_SESSION_CONFIG;

  if (!app.hasPlugin('@fastify/cookie')) {
    await app.register(fastifyCookie, opts.cookieSecret ? { secret: opts.cookieSecret } : {});
  }

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const sid = request.cookies?.[SESSION_COOKIE_NAME];
    if (!sid) {
      request.user = null;
      request.sessionId = null;
      return;
    }

    const session = await validateSession(opts.sessionStore, sid, sessionConfig);
    if (!session) {
      request.user = null;
      request.sessionId = null;
      reply.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions());
      return;
    }

    const user = await opts.userStore.findById(session.userId);
    request.user = user;
    request.sessionId = user ? session.sessionId : null;
  });

  app.decorate('requireAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new UnauthenticatedError();
    }
  });

  app.decorate('requireCsrf', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      assertCsrfHeader(request.method, request.headers);
    } catch (err) {
      if (err instanceof CsrfError) throw err;
      throw new CsrfError(err instanceof Error ? err.message : 'CSRF check failed');
    }
  });

  // The cookie plugin's secure flag is enforced when the route writes the cookie;
  // expose the env so route handlers can compute consistent options.
  app.decorate('authEnv', env);
};

export const authPlugin = fp(pluginImpl, {
  name: '@agent-poker/auth',
  fastify: '4.x',
});

declare module 'fastify' {
  interface FastifyInstance {
    authEnv: RuntimeEnv;
  }
}

export function buildSessionCookieOptions(env: RuntimeEnv, ttlMs?: number) {
  return sessionCookieOptions(env, ttlMs);
}
