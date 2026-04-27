import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ZodError } from 'zod';
import { randomUUID } from 'crypto';
import { AgentInUseError, AppError, NotFoundError, SchemaValidationError } from '@agent-poker/shared';
import {
  CreateUserAgentConfigRequestSchema,
  PatchUserAgentConfigRequestSchema,
} from '@agent-poker/agent-protocol';
import type { IUserAgentConfigStore, UserAgentConfig } from '@agent-poker/persistence';
import type { TableOrchestrator } from '@agent-poker/table-orchestrator';

interface MeAgentsPluginOptions extends FastifyPluginOptions {
  agentConfigStore: IUserAgentConfigStore;
  orchestrator: TableOrchestrator;
}

function toPublicConfig(c: UserAgentConfig) {
  return {
    agentConfigId: c.agentConfigId,
    agentName: c.agentName,
    endpointUrl: c.endpointUrl,
    authHeaderName: c.authHeaderName,
    hasAuthHeader: c.authHeaderValue !== null && c.authHeaderValue.length > 0,
    timeoutMs: c.timeoutMs,
    description: c.description,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function meAgentsRoutes(app: FastifyInstance, opts: MeAgentsPluginOptions) {
  const { agentConfigStore, orchestrator } = opts;

  app.get(
    '/me/agents',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const list = await agentConfigStore.list(req.user!.userId);
      reply.send({ data: list.map(toPublicConfig) });
    },
  );

  app.post(
    '/me/agents',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body;
      try {
        body = CreateUserAgentConfigRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }
      const cfg = await agentConfigStore.create({
        agentConfigId: `cfg-${randomUUID().slice(0, 12)}`,
        userId: req.user!.userId,
        agentName: body.agentName,
        endpointUrl: body.endpointUrl,
        authHeaderName: body.authHeaderName,
        authHeaderValue: body.authHeaderValue,
        timeoutMs: body.timeoutMs,
        description: body.description,
      });
      reply.status(201).send({ data: toPublicConfig(cfg) });
    },
  );

  app.get<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const cfg = await agentConfigStore.get(req.user!.userId, req.params.agentId);
      if (!cfg) throw new AppError('AGENT_NOT_FOUND', `Agent config ${req.params.agentId} not found`);
      reply.send({ data: toPublicConfig(cfg) });
    },
  );

  app.patch<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body;
      try {
        body = PatchUserAgentConfigRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const updated = await agentConfigStore
        .update(req.user!.userId, req.params.agentId, patch)
        .catch(e => {
          if (e instanceof NotFoundError) throw new AppError('AGENT_NOT_FOUND', e.message);
          throw e;
        });
      reply.send({ data: toPublicConfig(updated) });
    },
  );

  app.delete<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const cfg = await agentConfigStore.get(userId, req.params.agentId);
      if (!cfg) throw new AppError('AGENT_NOT_FOUND', `Agent config ${req.params.agentId} not found`);
      if (orchestrator.isAgentConfigInUse(cfg.agentConfigId)) {
        throw new AgentInUseError(cfg.agentConfigId);
      }
      await agentConfigStore.delete(userId, req.params.agentId);
      reply.status(204).send();
    },
  );
}
