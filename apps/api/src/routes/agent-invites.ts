import { randomBytes, randomUUID } from 'crypto';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AgentInviteNotFoundError,
  AgentInviteUnavailableError,
  SchemaValidationError,
} from '@agent-poker/shared';
import {
  CreateAgentInviteRequestSchema,
  RegisterAgentInviteRequestSchema,
} from '@agent-poker/agent-protocol';
import type {
  AgentInvite,
  IAgentInviteStore,
  IUserAgentConfigStore,
  UserAgentConfig,
} from '@agent-poker/persistence';

interface AgentInvitesPluginOptions extends FastifyPluginOptions {
  agentInviteStore: IAgentInviteStore;
  agentConfigStore: IUserAgentConfigStore;
}

function toPublicConfig(config: UserAgentConfig) {
  return {
    agentConfigId: config.agentConfigId,
    agentName: config.agentName,
    endpointUrl: config.endpointUrl,
    authHeaderName: config.authHeaderName,
    hasAuthHeader: config.authHeaderValue !== null && config.authHeaderValue.length > 0,
    timeoutMs: config.timeoutMs,
    description: config.description,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function inviteStatus(invite: AgentInvite, now = Date.now()): 'pending' | 'used' | 'expired' {
  if (invite.usedAt !== null) return 'used';
  if (invite.expiresAt < now) return 'expired';
  return 'pending';
}

function toPublicInvite(invite: AgentInvite) {
  return {
    token: invite.token,
    displayName: invite.displayName,
    notes: invite.notes,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    createdAt: invite.createdAt,
    registeredAgentConfigId: invite.registeredAgentConfigId,
    status: inviteStatus(invite),
  };
}

function registerUrlFor(req: FastifyRequest, token: string): string {
  const protocol = req.protocol || 'http';
  return `${protocol}://${req.hostname}/api/v1/agents/invites/${token}/register`;
}

function assertInviteUsable(invite: AgentInvite): void {
  if (
    invite.usedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < Date.now()
  ) {
    throw new AgentInviteUnavailableError(invite.token);
  }
}

export async function agentInvitesRoutes(app: FastifyInstance, opts: AgentInvitesPluginOptions) {
  const { agentInviteStore, agentConfigStore } = opts;

  app.post(
    '/agents/invites',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body;
      try {
        body = CreateAgentInviteRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const token = randomBytes(24).toString('base64url');
      const invite = await agentInviteStore.create({
        token,
        ownerUserId: req.user!.userId,
        displayName: body.displayName ?? null,
        notes: body.notes ?? null,
        expiresAt: Date.now() + body.ttlSec * 1000,
      });

      reply.status(201).send({
        data: {
          token: invite.token,
          expiresAt: invite.expiresAt,
          registerUrl: registerUrlFor(req, invite.token),
        },
      });
    },
  );

  app.get(
    '/agents/invites',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const invites = await agentInviteStore.list(req.user!.userId);
      reply.send({ data: invites.map(toPublicInvite) });
    },
  );

  app.delete<{ Params: { token: string } }>(
    '/agents/invites/:token',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const invite = await agentInviteStore.findByToken(req.params.token);
      if (!invite || invite.ownerUserId !== req.user!.userId) {
        throw new AgentInviteNotFoundError(req.params.token);
      }
      assertInviteUsable(invite);
      const revoked = await agentInviteStore.revokeUnused(req.user!.userId, req.params.token);
      if (!revoked) throw new AgentInviteUnavailableError(req.params.token);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { token: string } }>(
    '/agents/invites/:token/register',
    async (req, reply) => {
      let body;
      try {
        body = RegisterAgentInviteRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const invite = await agentInviteStore.findByToken(req.params.token);
      if (!invite) throw new AgentInviteNotFoundError(req.params.token);
      assertInviteUsable(invite);

      const config = await agentConfigStore.create({
        agentConfigId: `cfg-${randomUUID().slice(0, 12)}`,
        userId: invite.ownerUserId,
        agentName: body.displayName,
        endpointUrl: body.endpointUrl,
        authHeaderName: body.authHeaderName ?? null,
        authHeaderValue: body.authHeaderValue ?? null,
        timeoutMs: body.timeoutMs,
        description: invite.notes,
      });
      await agentInviteStore.markUsed(invite.token, config.agentConfigId);

      reply.status(201).send({
        data: {
          agent: toPublicConfig(config),
          invite: toPublicInvite({
            ...invite,
            usedAt: Date.now(),
            registeredAgentConfigId: config.agentConfigId,
          }),
        },
      });
    },
  );
}
