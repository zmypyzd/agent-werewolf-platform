import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ISessionStore, IUserStore, User } from '@agent-poker/persistence';

import type { IAuthService } from './auth-service.js';
import { SESSION_COOKIE_NAME, clearCookieOptions, sessionCookieOptions } from './cookie.js';
import { assertCsrfHeader } from './csrf.js';
import { CsrfError, UnauthenticatedError } from './errors.js';
import { hashPassword } from './password.js';
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
  // Optional JWT verifier. When provided, requests without a valid cookie
  // session fall through to a Bearer-token check; a verified Supabase
  // user is materialized into user_store on first sight (find-by-email,
  // create otherwise) and exposed via request.user just like a cookie
  // session would. Lets a half-migrated dual-auth deployment serve both
  // auth modes from the same set of legacy cookie-protected routes.
  authService?: IAuthService;
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
    if (sid) {
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
      return;
    }

    request.user = null;
    request.sessionId = null;

    if (!opts.authService) return;
    const authHeader = request.headers.authorization;
    if (!authHeader) return;
    let verified;
    try {
      verified = await opts.authService.verifyJwt(authHeader);
    } catch {
      // Invalid/expired JWT → treat as anonymous; requireAuth on the
      // route will reject with 401. Don't surface auth errors here
      // because some routes are public and would otherwise blow up on
      // a stale Authorization header.
      return;
    }
    request.user = await materializeJwtUser(opts.userStore, verified);
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

async function materializeJwtUser(
  userStore: IUserStore,
  verified: { userId: string; email: string; displayName: string },
): Promise<User> {
  // Match Supabase users to existing user_store entries by email so a
  // human who registered via the legacy cookie path with the same email
  // doesn't end up with two unlinked identities. If no row matches, we
  // create one using Supabase's user.id as the user_store userId — the
  // passwordHash is a sentinel because these users authenticate via JWT
  // and never go through the cookie /auth/login password verifier.
  const existing = await userStore.findByEmail(verified.email);
  if (existing) return existing;
  const passwordHash = await hashPassword(`supabase-jwt-${verified.userId}-${Date.now()}`);
  return userStore.createUser({
    userId: verified.userId,
    email: verified.email,
    passwordHash,
    displayName: verified.displayName,
  });
}

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
