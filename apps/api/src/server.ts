import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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
  IWerewolfMatchRegistry,
  IWerewolfReplayEventStore,
  SqliteDb,
} from '@agent-poker/persistence';
import {
  WerewolfOrchestrator,
  attachWerewolfHub,
  type WerewolfHubAttachment,
} from '@agent-poker/werewolf-orchestrator';
import {
  AppError,
  RateLimitedError,
  buildDefaultWerewolfBriefing,
} from '@agent-poker/shared';
import { RateLimiter, authPlugin, MockAuthService } from '@agent-poker/auth';
import type { RateLimiterConfig, RuntimeEnv, IAuthService } from '@agent-poker/auth';
import { registerJwtAuthMiddleware } from './middleware/auth.js';
import { RealtimeHub, agentStatusTopic } from '@agent-poker/realtime';
import { tablesRoutes } from './routes/tables.js';
import { simulateRoutes } from './routes/simulate.js';
import { matchesRoutes } from './routes/matches.js';
import { werewolfMatchesRoutes } from './routes/werewolf-matches.js';
import { werewolfGamesRoutes } from './routes/werewolf-games.js';
import { WerewolfLobbyRegistry } from './werewolf-lobby-registry.js';
import { AgentConfigUsageService } from './services/agent-config-usage.js';
import { authRoutes } from './routes/auth.js';
import { wsRoutes } from './routes/ws.js';
import { agentsWsRoutes } from './routes/agents-ws.js';
import { AgentConnectionRegistry } from '@agent-poker/agent-runtime';
import { meAgentsRoutes } from './routes/me-agents.js';
import { agentInvitesRoutes } from './routes/agent-invites.js';
import { werewolfDocsRoutes } from './routes/werewolf-docs.js';
import { healthRoutes } from './routes/health.js';
import { werewolfMailboxRoutes } from './routes/werewolf-mailbox.js';
import { meWerewolfAgentsRoutes } from './routes/me-werewolf-agents.js';
import { werewolfStreamRoutes } from './routes/werewolf-stream.js';
import type { IAgentStore, IWerewolfDecisionMailbox, SupabaseClientConfig } from '@agent-poker/persistence';
import { createMatchArtifactStore } from './match-artifact-store-factory.js';
import { createWerewolfMatchArtifactStore } from './werewolf-match-artifact-store-factory.js';

export interface BuildServerOptions {
  orchestrator?: TableOrchestrator;
  handStore?: InstanceType<typeof MemoryHandStore>;
  matchArtifactStore?: IMatchArtifactStore;
  decisionTraceStore?: IDecisionTraceStore;
  werewolfMatchArtifactStore?: IWerewolfMatchArtifactStore;
  werewolfDecisionTraceStore?: IWerewolfDecisionTraceStore;
  // Optional Postgres-backed match registry. When set, lobby.start() persists
  // each match into werewolf_matches before the first decision fires, so the
  // trace store's resolveMatchPk() can find the row. Required for any deploy
  // that ships the Postgres bundle; safe to leave undefined for the in-memory
  // dev/test path (the trace store is then memory-backed too, no resolver
  // round-trip happens).
  werewolfMatchRegistry?: IWerewolfMatchRegistry;
  // Paired with werewolfMatchRegistry: when both are set, lobby.start() also
  // appends every replay event to werewolf_replay_events live, so the SSE
  // stream + replay queries see a non-empty stream for an in-flight match.
  // Without this, only the end-of-match artifact upsert populates the table.
  werewolfReplayEventStore?: IWerewolfReplayEventStore;
  werewolfOrchestrator?: WerewolfOrchestrator;
  // When provided, buildServer uses this attachment instead of creating one.
  // Used by tests that need a handle on WerewolfHubAttachment to drive
  // attachMatch from outside buildServer. buildServer always registers an
  // onClose hook that calls detachAll(), so callers need not do it themselves.
  werewolfHubAttachment?: WerewolfHubAttachment;
  werewolfLobbyRegistry?: WerewolfLobbyRegistry;
  userStore?: IUserStore;
  sessionStore?: ISessionStore;
  agentConfigStore?: IUserAgentConfigStore;
  agentInviteStore?: IAgentInviteStore;
  authDb?: SqliteDb;
  env?: RuntimeEnv;
  hub?: RealtimeHub;
  // Singleton holding live agent WS connections opened against
  // /api/v1/agents/connect. Optional for test injection; if omitted
  // (and werewolfAgentStore is set), buildServer constructs one. Without
  // werewolfAgentStore the route is not registered at all, so a registry
  // would be unreachable anyway.
  agentRegistry?: AgentConnectionRegistry;
  // When set, /auth/login + /auth/register are rate-limited per request.ip
  // using a small in-memory counter. Default off so the existing test suite
  // doesn't trip the limit running 30+ register calls in seconds.
  authRateLimit?: RateLimiterConfig;
  // When both are provided, the server registers /api/v1/werewolf/wait +
  // /action backed by the Postgres mailbox. Omitted in the SQLite-only
  // dev path (the existing tests don't need them); production wires
  // these from the Supabase-backed bootstrap in index.ts.
  werewolfAgentStore?: IAgentStore;
  werewolfMailbox?: IWerewolfDecisionMailbox;
  publicDir?: string;  // Absolute path or repo-relative path to SPA dist directory
  // When provided, JWT-based requireJwtAuth decorator uses this implementation.
  // Defaults to MockAuthService('test-user-default') so existing tests are unaffected.
  authService?: IAuthService;
  // When provided, agent-invites routes use Postgres-backed stores with RLS.
  // Without this, all agent-invites endpoints return 501 (not configured).
  supabaseConfig?: SupabaseClientConfig;
  // Test-injection seam for the register-time HTTP probe. Defaults to
  // globalThis.fetch in production. See
  // apps/api/src/services/probe-http-agent-endpoint.ts.
  probeFetch?: typeof fetch;
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
  // One registry per server instance. Empty when no agents are connected;
  // memory cost is bounded by the number of registered ws agents.
  const agentRegistry = opts.agentRegistry ?? new AgentConnectionRegistry();

  // Bridge agent connection presence onto the realtime hub. Subscribers
  // to `agent.status:<agentId>` see `agent.online` / `agent.offline`
  // messages as the agent's WS comes and goes. Wired here (before any
  // route runs) so the very first /agents/connect upgrade emits through
  // a populated subscriber set if a lobby UI already opened the /ws first.
  // The hub is a noop when nobody is listening, so this is cheap if
  // unused.
  agentRegistry.on('online', (agentId) => {
    const topic = agentStatusTopic(agentId);
    hub.publish(topic, {
      topic,
      type: 'agent.online',
      payload: { agentId, ts: Date.now() },
    });
  });
  agentRegistry.on('offline', (agentId) => {
    const topic = agentStatusTopic(agentId);
    hub.publish(topic, {
      topic,
      type: 'agent.offline',
      payload: { agentId, ts: Date.now() },
    });
  });
  const orch = opts.orchestrator ?? new TableOrchestrator(tableStore, hs, hub, decisionTraceStore);

  const werewolfMatchArtifactStore =
    opts.werewolfMatchArtifactStore ?? createWerewolfMatchArtifactStore();
  const werewolfDecisionTraceStore =
    opts.werewolfDecisionTraceStore ?? new MemoryWerewolfDecisionTraceStore();

  // WEREWOLF_AGENT_TIMEOUT_MS lets the operator stretch (or shorten) the
  // per-call agent budget without recompiling. Falls back to the orchestrator's
  // built-in default (60s) when unset or unparseable. Anything <= 0 is rejected
  // so a typo can't accidentally collapse the timeout.
  const rawAgentTimeout = process.env['WEREWOLF_AGENT_TIMEOUT_MS'];
  const parsedAgentTimeout = rawAgentTimeout
    ? Number.parseInt(rawAgentTimeout, 10)
    : NaN;
  const werewolfDefaultTimeoutMs =
    Number.isFinite(parsedAgentTimeout) && parsedAgentTimeout > 0
      ? parsedAgentTimeout
      : undefined;

  const werewolfOrch =
    opts.werewolfOrchestrator ??
    new WerewolfOrchestrator({
      artifactStore: werewolfMatchArtifactStore,
      decisionTraceStore: werewolfDecisionTraceStore,
      ...(werewolfDefaultTimeoutMs !== undefined
        ? { defaultTimeoutMs: werewolfDefaultTimeoutMs }
        : {}),
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

  // trustProxy: true makes Fastify honor X-Forwarded-Proto / X-Forwarded-Host
  // when computing req.protocol and req.hostname. Render terminates TLS at its
  // load balancer and forwards to the container as plain HTTP, so without this
  // the agent-invites registerUrl comes back as http:// even on production.
  const app = Fastify({ logger: false, trustProxy: true });

  // Register JWT-based auth decorator alongside the existing cookie auth plugin.
  // Uses a distinct name (requireJwtAuth) to avoid colliding with requireAuth from
  // authPlugin. Tasks 10-11 (agent-invites, me-agents) reference requireJwtAuth.
  // Task 14 will delete the cookie plugin and rename this to requireAuth.
  const authService = opts.authService ?? new MockAuthService('test-user-default');
  registerJwtAuthMiddleware(app, authService);

  if (opts.publicDir) {
    // Resolve publicDir to an absolute path (relative paths are resolved against repo root)
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const publicPath = opts.publicDir.startsWith('/') ? opts.publicDir : join(repoRoot, opts.publicDir);

    app.register(fastifyStatic, {
      root: publicPath,
      prefix: '/',
    });

    // SPA history fallback: any non-/api 404 returns index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
        return;
      }
      reply.sendFile('index.html');
    });
  }

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
        // 409 — caller tried to seat a protocol='ws' agent that doesn't
        // currently have an AgentConnection in AgentConnectionRegistry.
        // Strict policy: refuse at seat time rather than letting the
        // seat go mute on the first decision request.
        AGENT_OFFLINE: 409,
        // 400 — the supplied endpointUrl is reachable but failed the
        // register-time probe. The body's `message` field carries the
        // specific reason (timeout, non-2xx, malformed JSON, schema mismatch).
        ENDPOINT_UNREACHABLE: 400,
        ENDPOINT_INVALID_RESPONSE: 400,
        HAND_NOT_FOUND: 404,
        MATCH_NOT_FOUND: 404,
        NOT_ENOUGH_PLAYERS: 400,
        INVALID_CONFIG: 400,
        SCHEMA_VALIDATION_FAILED: 400,
        INVALID_ACTION: 400,
        ARTIFACT_LIMIT_EXCEEDED: 413,
        WEREWOLF_GAME_NOT_FOUND: 404,
        WEREWOLF_SEAT_OCCUPIED: 409,
        WEREWOLF_GAME_NOT_READY: 409,
        WEREWOLF_GAME_ALREADY_STARTED: 409,
        UNAUTHENTICATED: 401,
        CSRF_FAILED: 403,
        FORBIDDEN: 403,
        RATE_LIMITED: 429,
        NOT_IMPLEMENTED: 501,
        INTERNAL_ERROR: 500,
        SERVICE_UNAVAILABLE: 503,
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

  const werewolfHubAttachment =
    opts.werewolfHubAttachment ?? attachWerewolfHub(werewolfOrch, hub);
  // Always detach on shutdown so neither buildServer-owned nor test-injected
  // attachments leak EventEmitter listeners between cycles.
  app.addHook('onClose', async () => {
    werewolfHubAttachment.detachAll();
    // Close every live agent WS connection with a `goodbye{server_shutdown}`
    // so reconnect logic on the agent side knows it's a planned restart,
    // not a transient network blip.
    agentRegistry.closeAll('server shutdown');
  });

  // Briefing is opt-in via env so existing fixtures and the demo CLIs don't
  // start sending it implicitly. WEREWOLF_BRIEFING_ENABLED toggles inclusion;
  // WEREWOLF_BRIEFING_DOCS_URL adds an optional pointer back to the full
  // docs/werewolf-http-agent-guide.md when the operator hosts it.
  const briefingEnvRaw = process.env['WEREWOLF_BRIEFING_ENABLED'];
  const briefingEnabled =
    briefingEnvRaw === '1' ||
    briefingEnvRaw === 'true' ||
    briefingEnvRaw === 'yes';
  const briefingDocsUrl = process.env['WEREWOLF_BRIEFING_DOCS_URL'];
  const werewolfBriefing = briefingEnabled
    ? buildDefaultWerewolfBriefing(
        briefingDocsUrl ? { docsUrl: briefingDocsUrl } : {},
      )
    : undefined;

  const werewolfLobbyRegistry =
    opts.werewolfLobbyRegistry ??
    new WerewolfLobbyRegistry({
      orchestrator: werewolfOrch,
      attachMatch: (gameId, ownership) =>
        werewolfHubAttachment.attachMatch(gameId, ownership),
      detachMatch: (gameId) => werewolfHubAttachment.detachMatch(gameId),
      // Postgres-backed lookup for inviteAgent. Mirrors the read path
      // already taken by /me/agents (which since the auth-migration is
      // postgres-only) so the agent the user sees in AgentPicker is the
      // same record this seats. Falls back to SQLite agentConfigStore
      // below when werewolfAgentStore isn't wired — that's the legacy
      // dev/test path; production always sets werewolfAgentStore.
      ...(opts.werewolfAgentStore ? { agentStore: opts.werewolfAgentStore } : {}),
      agentConfigStore: agentConfigStore!,
      // Pass the live-agent registry so the lobby can (a) construct
      // WerewolfWsAgentAdapter for protocol='ws' agents, (b) enforce
      // the strict-online seat-time check that rejects offline ws
      // agents with AGENT_OFFLINE instead of letting the seat go mute.
      agentRegistry,
      ...(werewolfBriefing ? { briefing: werewolfBriefing } : {}),
      ...(opts.werewolfMatchRegistry
        ? { matchRegistry: opts.werewolfMatchRegistry }
        : {}),
      ...(opts.werewolfReplayEventStore
        ? { replayEventStore: opts.werewolfReplayEventStore }
        : {}),
    });

  // Cross-game in-use joiner — passed to me-agents.ts so DELETE rejects when
  // an agent config is seated in either a poker table or a werewolf lobby.
  const agentConfigUsage = new AgentConfigUsageService(orch, werewolfLobbyRegistry);

  // Auth plugin + WebSocket plugin must register before any route plugin that
  // needs request.user / requireAuth or the websocket route option.
  app.register(async (scope) => {
    await scope.register(authPlugin, {
      userStore,
      sessionStore,
      env,
      // Same authService that powers requireJwtAuth — wire it into the
      // cookie plugin so legacy requireAuth routes also accept a Bearer
      // JWT, find-or-create the matching user_store row, and populate
      // request.user. Without this, every Supabase login can reach a
      // route via ProtectedRoute but cannot perform any mutating call
      // (POST /tables, /werewolf-games, etc. all 401) because the
      // Stage-2 JWT migration only covered a subset of endpoints.
      authService,
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
    await scope.register(werewolfGamesRoutes, {
      prefix: '/api/v1',
      registry: werewolfLobbyRegistry,
    });
    await scope.register(meAgentsRoutes, {
      prefix: '/api/v1',
      agentConfigUsage,
      ...(opts.supabaseConfig ? { supabaseConfig: opts.supabaseConfig } : {}),
    });
    await scope.register(agentInvitesRoutes, {
      prefix: '/api/v1',
      ...(opts.supabaseConfig ? { supabaseConfig: opts.supabaseConfig } : {}),
      ...(opts.probeFetch ? { probeFetch: opts.probeFetch } : {}),
    });
    await scope.register(werewolfDocsRoutes, { prefix: '/api/v1' });
    if (opts.werewolfAgentStore) {
      await scope.register(meWerewolfAgentsRoutes, {
        prefix: '/api/v1',
        agentStore: opts.werewolfAgentStore,
        agentRegistry,
      });
    }
    if (opts.werewolfAgentStore && opts.werewolfMailbox) {
      await scope.register(werewolfMailboxRoutes, {
        prefix: '/api/v1',
        agentStore: opts.werewolfAgentStore,
        mailbox: opts.werewolfMailbox,
      });
    }
    // Reverse-WS transport for external werewolf agents. Needs the
    // agent store for Bearer-token auth; without it the route is not
    // registered (mirrors the gating on werewolfMailboxRoutes).
    if (opts.werewolfAgentStore) {
      await scope.register(agentsWsRoutes, {
        prefix: '/api/v1',
        agentStore: opts.werewolfAgentStore,
        agentRegistry,
      });
    }
    await scope.register(wsRoutes, { hub });
    await scope.register(werewolfStreamRoutes, { prefix: '/api/v1', hub });
    await scope.register(healthRoutes);
  });

  return app;
}
