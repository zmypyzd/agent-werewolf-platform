import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { TableOrchestrator } from '@agent-poker/table-orchestrator';
import {
  MemoryTableStore,
  MemoryHandStore,
  MemoryDecisionTraceStore,
  MemoryWerewolfDecisionTraceStore,
  openDatabase,
  SqliteUserStore,
  SqliteSessionStore,
  SqliteUserAgentConfigStore,
  SqliteAgentInviteStore,
} from '@agent-poker/persistence';
import type {
  IUserStore,
  ISessionStore,
  IUserAgentConfigStore,
  IAgentInviteStore,
  IMatchArtifactStore,
  IDecisionTraceStore,
  IWerewolfMatchArtifactStore,
  IWerewolfDecisionTraceStore,
  SqliteDb,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import { AppError, RateLimitedError } from '@agent-poker/shared';
import { RateLimiter, authPlugin } from '@agent-poker/auth';
import type { RateLimiterConfig, RuntimeEnv } from '@agent-poker/auth';
import { RealtimeHub } from '@agent-poker/realtime';
import { tablesRoutes } from './routes/tables.js';
import { simulateRoutes } from './routes/simulate.js';
import { matchesRoutes } from './routes/matches.js';
import { werewolfMatchesRoutes } from './routes/werewolf-matches.js';
import { authRoutes } from './routes/auth.js';
import { wsRoutes } from './routes/ws.js';
import { meAgentsRoutes } from './routes/me-agents.js';
import { agentInvitesRoutes } from './routes/agent-invites.js';
import { healthRoutes } from './routes/health.js';
import { createMatchArtifactStore } from './match-artifact-store-factory.js';
import { createWerewolfMatchArtifactStore } from './werewolf-match-artifact-store-factory.js';

export interface BuildServerOptions {
  orchestrator?: TableOrchestrator;
  handStore?: InstanceType<typeof MemoryHandStore>;
  matchArtifactStore?: IMatchArtifactStore;
  decisionTraceStore?: IDecisionTraceStore;
  werewolfMatchArtifactStore?: IWerewolfMatchArtifactStore;
  werewolfDecisionTraceStore?: IWerewolfDecisionTraceStore;
  werewolfOrchestrator?: WerewolfOrchestrator;
  // When provided, buildServer assumes the caller has already attached the
  // werewolf orchestrator to the hub and will skip its own attach call. Used
  // by tests that need a handle on the WerewolfHubAttachment to drive
  // attachMatch from outside buildServer.
  werewolfHubAttachment?: WerewolfHubAttachment;
  userStore?: IUserStore;
  sessionStore?: ISessionStore;
  agentConfigStore?: IUserAgentConfigStore;
  agentInviteStore?: IAgentInviteStore;
  authDb?: SqliteDb;
  env?: RuntimeEnv;
  hub?: RealtimeHub;
  // When set, /auth/login + /auth/register are rate-limited per request.ip
  // using a small in-memory counter. Default off so the existing test suite
  // doesn't trip the limit running 30+ register calls in seconds.
  authRateLimit?: RateLimiterConfig;
}

export function buildServer(opts: BuildServerOptions = {}) {
  if (opts.orchestrator && !opts.handStore) {
    throw new Error('buildServer requires handStore when orchestrator is provided');
  }

  const tableStore = new MemoryTableStore();
  const hs = opts.handStore ?? new MemoryHandStore();
  const matchArtifactStore = opts.matchArtifactStore || createMatchArtifactStore();
  const decisionTraceStore = opts.decisionTraceStore ?? new MemoryDecisionTraceStore();
  const hub = opts.hub ?? new RealtimeHub();
  const orch = opts.orchestrator ?? new TableOrchestrator(tableStore, hs, hub, decisionTraceStore);

  const werewolfMatchArtifactStore =
    opts.werewolfMatchArtifactStore ?? createWerewolfMatchArtifactStore();
  const werewolfDecisionTraceStore =
    opts.werewolfDecisionTraceStore ?? new MemoryWerewolfDecisionTraceStore();

  const werewolfOrch =
    opts.werewolfOrchestrator ??
    new WerewolfOrchestrator({
      artifactStore: werewolfMatchArtifactStore,
      decisionTraceStore: werewolfDecisionTraceStore,
    });

  const authDb =
    opts.userStore && opts.sessionStore && opts.agentConfigStore && opts.agentInviteStore
      ? null
      : (opts.authDb ?? openDatabase(':memory:'));
  const userStore = opts.userStore ?? new SqliteUserStore(authDb!);
  const sessionStore = opts.sessionStore ?? new SqliteSessionStore(authDb!);
  const agentConfigStore = opts.agentConfigStore ?? new SqliteUserAgentConfigStore(authDb!);
  const agentInviteStore = opts.agentInviteStore ?? new SqliteAgentInviteStore(authDb!);
  const env: RuntimeEnv = opts.env ?? (process.env['NODE_ENV'] as RuntimeEnv) ?? 'development';
  const authRateLimiter = opts.authRateLimit ? new RateLimiter(opts.authRateLimit) : undefined;

  const app = Fastify({ logger: false });

  // Allow empty JSON bodies on routes that don't need one (e.g. POST /auth/logout
  // sent with `Content-Type: application/json` but no payload).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (typeof body !== 'string' || body.length === 0) return done(null, undefined);
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const statusMap: Record<string, number> = {
        TABLE_FULL: 409,
        HAND_IN_PROGRESS: 409,
        EMAIL_TAKEN: 409,
        SEAT_TAKEN: 409,
        ACTION_CONFLICT: 409,
        AGENT_IN_USE: 409,
        NOT_FOUND: 404,
        TABLE_NOT_FOUND: 404,
        AGENT_NOT_FOUND: 404,
        AGENT_INVITE_NOT_FOUND: 404,
        AGENT_INVITE_UNAVAILABLE: 410,
        HAND_NOT_FOUND: 404,
        MATCH_NOT_FOUND: 404,
        NOT_ENOUGH_PLAYERS: 400,
        INVALID_CONFIG: 400,
        SCHEMA_VALIDATION_FAILED: 400,
        INVALID_ACTION: 400,
        ARTIFACT_LIMIT_EXCEEDED: 413,
        UNAUTHENTICATED: 401,
        CSRF_FAILED: 403,
        FORBIDDEN: 403,
        RATE_LIMITED: 429,
        NOT_IMPLEMENTED: 501,
        INTERNAL_ERROR: 500,
      };
      const statusCode = statusMap[error.code] ?? 500;
      if (error instanceof RateLimitedError) {
        reply.header('Retry-After', Math.ceil(error.retryAfterMs / 1000));
      }
      reply.status(statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          statusCode,
        },
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
        statusCode: 500,
      },
    });
  });

  // If the caller passed a pre-built attachment, trust them. Otherwise create one
  // and own its lifecycle here. (Tests that need to drive attachMatch externally
  // pass werewolfHubAttachment.)
  if (!opts.werewolfHubAttachment) {
    const attachment = attachWerewolfHub(werewolfOrch, hub);
    // Cleanly detach werewolf subscribers when Fastify shuts down so
    // long-lived servers (or test instances that ran matches) don't leak
    // EventEmitter listeners between buildServer/app.close cycles.
    app.addHook('onClose', async () => {
      attachment.detachAll();
    });
  }

  // Auth plugin + WebSocket plugin must register before any route plugin that
  // needs request.user / requireAuth or the websocket route option.
  app.register(async (scope) => {
    await scope.register(authPlugin, {
      userStore,
      sessionStore,
      env,
    });
    await scope.register(fastifyWebsocket);
    await scope.register(authRoutes, {
      prefix: '/api/v1', userStore, sessionStore, env,
      ...(authRateLimiter ? { rateLimiter: authRateLimiter } : {}),
    });
    await scope.register(tablesRoutes, { prefix: '/api/v1', orchestrator: orch, handStore: hs, agentConfigStore });
    await scope.register(simulateRoutes, {
      prefix: '/api/v1',
      orchestrator: orch,
      handStore: hs,
      matchArtifactStore,
      decisionTraceStore,
    });
    await scope.register(matchesRoutes, { prefix: '/api/v1', matchArtifactStore });
    await scope.register(werewolfMatchesRoutes, {
      prefix: '/api/v1',
      werewolfMatchArtifactStore,
    });
    await scope.register(meAgentsRoutes, { prefix: '/api/v1', agentConfigStore, orchestrator: orch });
    await scope.register(agentInvitesRoutes, { prefix: '/api/v1', agentInviteStore, agentConfigStore });
    await scope.register(wsRoutes, { hub });
    await scope.register(healthRoutes);
  });

  return app;
}
