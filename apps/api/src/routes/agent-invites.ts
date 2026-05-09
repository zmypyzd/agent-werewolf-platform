import { randomBytes } from 'crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AgentInviteNotFoundError,
  AgentInviteUnavailableError,
  AppError,
  SchemaValidationError,
} from '@agent-poker/shared';
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

interface AgentInvitesPluginOptions extends FastifyPluginOptions {
  supabaseConfig?: SupabaseClientConfig;
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
    registeredAgentId: invite.registeredAgentId,
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

      reply.status(201).send({
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

      const { agent } = await agentStore.create({
        ownerId: invite.ownerId,
        name: body.displayName,
        description: invite.notes ?? null,
        protocol: 'http',
        callbackUrl: body.endpointUrl,
        authHeaderName: body.authHeaderName ?? null,
        authHeaderValue: body.authHeaderValue ?? null,
        timeoutMs: body.timeoutMs,
      });

      await inviteStore.markUsed(req.params.token, agent.id);

      reply.status(201).send({
        data: {
          agent: toPublicAgent(agent),
          invite: {
            ...toPublicInvite(invite),
            status: 'used' as const,
            registeredAgentId: agent.id,
          },
        },
      });
    },
  );
}
