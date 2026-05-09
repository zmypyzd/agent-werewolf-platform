import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ZodError } from 'zod';
import { AgentInUseError, AppError, NotFoundError, SchemaValidationError } from '@agent-poker/shared';
import {
  CreateUserAgentConfigRequestSchema,
  PatchUserAgentConfigRequestSchema,
} from '@agent-poker/agent-protocol';
import {
  PostgresAgentStore,
  createUserScopedClient,
  type AgentRecord,
  type SupabaseClientConfig,
} from '@agent-poker/persistence';
import type { JwtAuthenticatedRequest } from '../middleware/auth.js';
import type { AgentConfigUsageService } from '../services/agent-config-usage.js';

interface MeAgentsPluginOptions extends FastifyPluginOptions {
  supabaseConfig?: SupabaseClientConfig;
  // Cross-game in-use joiner — replaces the previous direct
  // TableOrchestrator dependency so this route stays game-agnostic.
  // Adding werewolf in-use means just changing the joiner's wiring,
  // not this file.
  agentConfigUsage: AgentConfigUsageService;
}

function requireSupabaseConfig(opts: MeAgentsPluginOptions): SupabaseClientConfig {
  if (!opts.supabaseConfig) {
    throw new AppError('NOT_IMPLEMENTED', 'Supabase config not provided');
  }
  return opts.supabaseConfig;
}

function toPublicAgent(agent: AgentRecord) {
  return {
    agentConfigId: agent.id,
    agentName: agent.name,
    endpointUrl: agent.callbackUrl,
    authHeaderName: agent.authHeaderName,
    hasAuthHeader: agent.authHeaderValue !== null && agent.authHeaderValue !== undefined && agent.authHeaderValue.length > 0,
    timeoutMs: agent.timeoutMs,
    description: agent.description,
    protocol: agent.protocol,
    status: agent.status,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function meAgentsRoutes(app: FastifyInstance, opts: MeAgentsPluginOptions) {
  const { agentConfigUsage } = opts;

  // GET /me/agents — list user's agents
  app.get(
    '/me/agents',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const config = requireSupabaseConfig(opts);
      const userClient = createUserScopedClient(config, jwt);
      const store = new PostgresAgentStore(userClient);

      const agents = await store.list(userId);
      reply.send({ data: agents.map(toPublicAgent) });
    },
  );

  // POST /me/agents — create a new agent directly (without invite flow)
  app.post(
    '/me/agents',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const config = requireSupabaseConfig(opts);

      let body;
      try {
        body = CreateUserAgentConfigRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const userClient = createUserScopedClient(config, jwt);
      const store = new PostgresAgentStore(userClient);

      const { agent } = await store.create({
        ownerId: userId,
        name: body.agentName,
        protocol: 'http',
        callbackUrl: body.endpointUrl,
        authHeaderName: body.authHeaderName,
        authHeaderValue: body.authHeaderValue,
        timeoutMs: body.timeoutMs,
        description: body.description,
      });
      reply.status(201).send({ data: toPublicAgent(agent) });
    },
  );

  // GET /me/agents/:agentId — get one agent
  app.get<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const config = requireSupabaseConfig(opts);
      const userClient = createUserScopedClient(config, jwt);
      const store = new PostgresAgentStore(userClient);

      const agent = await store.get(userId, req.params.agentId);
      if (!agent) throw new AppError('AGENT_NOT_FOUND', `Agent config ${req.params.agentId} not found`);
      reply.send({ data: toPublicAgent(agent) });
    },
  );

  // PATCH /me/agents/:agentId — update one agent
  app.patch<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const config = requireSupabaseConfig(opts);

      let body;
      try {
        body = PatchUserAgentConfigRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const userClient = createUserScopedClient(config, jwt);
      const store = new PostgresAgentStore(userClient);

      // Map from agent-protocol field names to PostgresAgentStore PatchAgent field names
      const patch: Parameters<PostgresAgentStore['update']>[2] = {
        ...(body.agentName !== undefined ? { name: body.agentName } : {}),
        ...(body.endpointUrl !== undefined ? { callbackUrl: body.endpointUrl } : {}),
        ...(body.authHeaderName !== undefined ? { authHeaderName: body.authHeaderName } : {}),
        ...(body.authHeaderValue !== undefined ? { authHeaderValue: body.authHeaderValue } : {}),
        ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      };

      const updated = await store
        .update(userId, req.params.agentId, patch)
        .catch(e => {
          if (e instanceof NotFoundError) throw new AppError('AGENT_NOT_FOUND', e.message);
          throw e;
        });
      reply.send({ data: toPublicAgent(updated) });
    },
  );

  // DELETE /me/agents/:agentId — delete one agent
  app.delete<{ Params: { agentId: string } }>(
    '/me/agents/:agentId',
    { preHandler: [app.requireJwtAuth] },
    async (req, reply) => {
      const { userId, jwt } = (req as JwtAuthenticatedRequest).jwtUser;
      const config = requireSupabaseConfig(opts);
      const userClient = createUserScopedClient(config, jwt);
      const store = new PostgresAgentStore(userClient);

      const agent = await store.get(userId, req.params.agentId);
      if (!agent) throw new AppError('AGENT_NOT_FOUND', `Agent config ${req.params.agentId} not found`);
      if (agentConfigUsage.isInUse(agent.id)) {
        throw new AgentInUseError(agent.id);
      }
      await store.delete(userId, req.params.agentId);
      reply.status(204).send();
    },
  );
}
