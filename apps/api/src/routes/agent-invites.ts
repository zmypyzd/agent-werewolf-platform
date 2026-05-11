import { randomBytes } from 'crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AgentInviteNotFoundError,
  AgentInviteUnavailableError,
  AppError,
  SchemaValidationError,
} from '@agent-poker/shared';
import { z } from 'zod';
import {
  CreateAgentInviteRequestSchema,
  RegisterAgentInviteRequestSchema,
} from '@agent-poker/agent-protocol';
import {
  PostgresAgentStore,
  PostgresAgentInviteStore,
  createServiceRoleClient,
  createUserScopedClient,
  type AgentRecord,
  type AgentInviteRecord,
  type SupabaseClientConfig,
} from '@agent-poker/persistence';
import type { JwtAuthenticatedRequest } from '../middleware/auth.js';
import {
  probeHttpAgentEndpoint,
  type ProbeOutcome,
} from '../services/probe-http-agent-endpoint.js';

interface AgentInvitesPluginOptions extends FastifyPluginOptions {
  supabaseConfig?: SupabaseClientConfig;
  // Test-injection seam for the register-time HTTP probe (see
  // probe-http-agent-endpoint.ts). When undefined the probe uses the
  // global fetch, which is what production wants. Tests pass a fake
  // fetch so they can simulate unreachable / malformed endpoints
  // without a real listener.
  probeFetch?: typeof fetch;
}

function requireSupabaseConfig(supabaseConfig: SupabaseClientConfig | undefined): SupabaseClientConfig {
  if (!supabaseConfig) {
    throw new AppError('NOT_IMPLEMENTED', 'Agent invites require Supabase configuration (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)');
  }
  return supabaseConfig;
}

function registerUrlFor(req: FastifyRequest, token: string): string {
  const protocol = req.protocol || 'http';
  return `${protocol}://${req.hostname}/api/v1/agents/invites/${token}/register`;
}

// wss:// for production HTTPS hosts, ws:// for localhost dev. Mirrors the
// scheme decision in registerUrlFor — `req.protocol` already follows the
// X-Forwarded-Proto header when trustProxy is on (set in server.ts).
function wsConnectUrlFor(req: FastifyRequest): string {
  const scheme = (req.protocol || 'http') === 'https' ? 'wss' : 'ws';
  return `${scheme}://${req.hostname}/api/v1/agents/connect`;
}

// Normalize the legacy/new request shapes into one tagged record. Legacy
// callers send endpointUrl at the top level; new callers send a
// `transport` discriminated union (see schema). After this both flows
// agree on shape.
type NormalizedTransport =
  | { kind: 'http'; endpointUrl: string; authHeaderName: string | null; authHeaderValue: string | null }
  | { kind: 'ws' };

type RegisterBody = z.infer<typeof RegisterAgentInviteRequestSchema>;

function normalizeTransport(body: RegisterBody): NormalizedTransport {
  if ('transport' in body) {
    if (body.transport.kind === 'ws') return { kind: 'ws' };
    return {
      kind: 'http',
      endpointUrl: body.transport.endpointUrl,
      authHeaderName: body.transport.authHeaderName ?? null,
      authHeaderValue: body.transport.authHeaderValue ?? null,
    };
  }
  return {
    kind: 'http',
    endpointUrl: body.endpointUrl,
    authHeaderName: body.authHeaderName ?? null,
    authHeaderValue: body.authHeaderValue ?? null,
  };
}

function toPublicInvite(invite: AgentInviteRecord) {
  // Compute status without leaking the raw token
  let status: 'pending' | 'used' | 'revoked' | 'expired';
  if (invite.usedAt !== null) status = 'used';
  else if (invite.revokedAt !== null) status = 'revoked';
  else if (invite.expiresAt < Date.now()) status = 'expired';
  else status = 'pending';

  return {
    tokenHash: invite.tokenHash,
    displayName: invite.displayName,
    notes: invite.notes,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    createdAt: invite.createdAt,
    // Wire-name kept stable with the SQLite store + IAgentInviteStore
    // interface; Postgres internally calls this `registeredAgentId` (the
    // column is `registered_agent_id`), but every API consumer expects
    // the platform-level "agent config" terminology.
    registeredAgentConfigId: invite.registeredAgentId,
    status,
  };
}

function toPublicAgent(agent: AgentRecord) {
  return {
    agentId: agent.id,
    name: agent.name,
    protocol: agent.protocol,
    callbackUrl: agent.callbackUrl,
    authHeaderName: agent.authHeaderName,
    hasAuthHeader: agent.authHeaderValue !== null && agent.authHeaderValue.length > 0,
    timeoutMs: agent.timeoutMs,
    description: agent.description,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function agentInvitesRoutes(app: FastifyInstance, opts: AgentInvitesPluginOptions) {
  // POST /agents/invites — create invite (owner authenticated)
  app.post(
    '/agents/invites',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const cfg = requireSupabaseConfig(opts.supabaseConfig);

      let body;
      try {
        body = CreateAgentInviteRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const userClient = createUserScopedClient(cfg, jwt);
      const store = new PostgresAgentInviteStore(userClient);

      const rawToken = randomBytes(24).toString('base64url');
      const invite = await store.create({
        rawToken,
        ownerId: userId,
        displayName: body.displayName ?? null,
        notes: body.notes ?? null,
        expiresAt: Date.now() + body.ttlSec * 1000,
      });

      // The rawToken is shown to the operator exactly once — only sha256
      // is persisted. Forbid intermediary caching so the response can't
      // outlive the legitimate read (CDN POST cache, browser bfcache,
      // reverse-proxy `proxy_cache_methods POST`, dev-tools "preserve
      // log" replay). Same defense as me-werewolf-agents.
      reply
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .status(201)
        .send({
          data: {
            token: rawToken,
            expiresAt: invite.expiresAt,
            registerUrl: registerUrlFor(req, rawToken),
          },
        });
    },
  );

  // GET /agents/invites — list invites (owner authenticated)
  app.get(
    '/agents/invites',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const cfg = requireSupabaseConfig(opts.supabaseConfig);

      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const userClient = createUserScopedClient(cfg, jwt);
      const store = new PostgresAgentInviteStore(userClient);

      const invites = await store.list(userId);
      reply.send({ data: invites.map(toPublicInvite) });
    },
  );

  // DELETE /agents/invites/:token — revoke (owner authenticated)
  app.delete<{ Params: { token: string } }>(
    '/agents/invites/:token',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const cfg = requireSupabaseConfig(opts.supabaseConfig);

      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const userClient = createUserScopedClient(cfg, jwt);
      const store = new PostgresAgentInviteStore(userClient);

      const invite = await store.findByRawToken(req.params.token);
      if (!invite || invite.ownerId !== userId) {
        throw new AgentInviteNotFoundError(req.params.token);
      }
      if (invite.usedAt !== null || invite.revokedAt !== null || invite.expiresAt < Date.now()) {
        throw new AgentInviteUnavailableError(req.params.token);
      }

      const revoked = await store.revokeUnused(userId, req.params.token);
      if (!revoked) throw new AgentInviteUnavailableError(req.params.token);
      reply.status(204).send();
    },
  );

  // POST /agents/invites/:token/register — public, no auth required
  app.post<{ Params: { token: string } }>(
    '/agents/invites/:token/register',
    async (req, reply) => {
      const cfg = requireSupabaseConfig(opts.supabaseConfig);

      let body;
      try {
        body = RegisterAgentInviteRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      // Service-role client (RLS bypassed). Safe because this endpoint validates
      // the raw token before doing anything; an attacker without a valid invite
      // can only get NotFound errors.
      const serviceClient = createServiceRoleClient(cfg);
      const inviteStore = new PostgresAgentInviteStore(serviceClient);
      const agentStore = new PostgresAgentStore(serviceClient);

      const invite = await inviteStore.findByRawToken(req.params.token);
      if (!invite) throw new AgentInviteNotFoundError(req.params.token);
      if (invite.usedAt !== null || invite.revokedAt !== null || invite.expiresAt < Date.now()) {
        throw new AgentInviteUnavailableError(req.params.token);
      }

      const transport = normalizeTransport(body);

      // For HTTP transports, synthetically probe the supplied endpoint
      // BEFORE creating the agent record. Without this, a misconfigured
      // URL (broken tunnel, wrong port, etc.) is silently accepted and
      // only manifests as a mute seat during a real match. See
      // services/probe-http-agent-endpoint.ts for the rationale + the
      // shape of the synthetic request. ws transports skip this — they
      // have no inbound endpoint to probe; reachability is verified at
      // WS upgrade time instead.
      if (transport.kind === 'http') {
        const outcome: ProbeOutcome = await probeHttpAgentEndpoint({
          endpointUrl: transport.endpointUrl,
          authHeaderName: transport.authHeaderName,
          authHeaderValue: transport.authHeaderValue,
          timeoutMs: body.timeoutMs,
          ...(opts.probeFetch ? { fetchImpl: opts.probeFetch } : {}),
        });
        if (!outcome.ok) {
          throw new AppError(
            outcome.code ?? 'ENDPOINT_UNREACHABLE',
            `endpointUrl probe failed: ${outcome.reason ?? 'unknown'}`,
          );
        }
      }

      const created = transport.kind === 'http'
        ? await agentStore.create({
            ownerId: invite.ownerId,
            name: body.displayName,
            description: invite.notes ?? null,
            protocol: 'http',
            callbackUrl: transport.endpointUrl,
            authHeaderName: transport.authHeaderName,
            authHeaderValue: transport.authHeaderValue,
            timeoutMs: body.timeoutMs,
          })
        : await agentStore.create({
            ownerId: invite.ownerId,
            name: body.displayName,
            description: invite.notes ?? null,
            protocol: 'ws',
            // No callbackUrl / authHeader for ws; the bearer wsToken is
            // generated by the store and returned in `created.rawToken`.
            timeoutMs: body.timeoutMs,
          });

      const { agent, rawToken } = created;
      await inviteStore.markUsed(req.params.token, agent.id);

      // Same one-shot defenses as POST /agents/invites: the wsToken is
      // shown to the agent author exactly once and only sha256 is
      // persisted. Disable any caching path that could resurface it.
      if (transport.kind === 'ws') {
        reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
      }

      reply.status(201).send({
        data: {
          agent: toPublicAgent(agent),
          invite: {
            ...toPublicInvite(invite),
            status: 'used' as const,
            registeredAgentConfigId: agent.id,
          },
          // Present only for protocol=ws. Holds everything the agent
          // process needs to open the reverse-WS: the URL plus the bearer
          // token (one-time read).
          ...(transport.kind === 'ws' && rawToken !== null
            ? {
                wsConnect: {
                  url: wsConnectUrlFor(req),
                  token: rawToken,
                },
              }
            : {}),
        },
      });
    },
  );

  // DELETE /agents/invites/by-hash/:tokenHash — revoke a pending invite by its
  // sha256 hash. The list/render path only ever sees tokenHash (raw token is
  // emitted exactly once at creation), so the UI uses this to revoke a
  // forgotten invite. Distinct route from /:token to keep the raw-token vs
  // hash semantics unambiguous in URL parameters.
  app.delete<{ Params: { tokenHash: string } }>(
    '/agents/invites/by-hash/:tokenHash',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const cfg = requireSupabaseConfig(opts.supabaseConfig);

      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const userClient = createUserScopedClient(cfg, jwt);
      const store = new PostgresAgentInviteStore(userClient);

      const revoked = await store.revokeUnusedByHash(userId, req.params.tokenHash);
      if (!revoked) {
        // Collapse "no such hash for this owner" and "already used / revoked
        // / expired" into one error — by-hash callers cannot distinguish via
        // a separate findByHash without leaking that the hash exists.
        throw new AgentInviteNotFoundError(req.params.tokenHash);
      }
      reply.status(204).send();
    },
  );
}
