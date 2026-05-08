import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError } from '@agent-poker/shared';
import type { AgentRecord, IAgentStore } from '@agent-poker/persistence';

// /api/v1/me/werewolf-agents — owner-bound CRUD for longpoll werewolf
// agents. Parallel surface to /api/v1/me/agents (which manages SQLite
// user_agent_configs for HTTP-webhook poker agents). The two stores are
// independent during Phase 1; Phase 2 will collapse them once auth
// migrates to Supabase Auth and the agents table FKs back to auth.users.

interface MeWerewolfAgentsPluginOptions extends FastifyPluginOptions {
  agentStore: IAgentStore;
}

const CreateRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_\-\.]+$/, 'name may contain only A-Z, a-z, 0-9, _, -, .'),
  description: z.string().max(500).optional(),
  // Mailbox per-call budget. Werewolf decisions are slower than poker.
  // 1s floor prevents footguns; 2-min ceiling lines up with the DB
  // CHECK constraint on agents.timeout_ms.
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

// Public DTO. Excludes token_hash (never serialized) and callback_url /
// auth_header_* (only relevant to protocol='http' agents, which are
// managed via /me/agents instead).
function toPublicWerewolfAgent(a: AgentRecord) {
  return {
    agentId: a.id,
    name: a.name,
    description: a.description,
    protocol: a.protocol,
    timeoutMs: a.timeoutMs,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function meWerewolfAgentsRoutes(
  app: FastifyInstance,
  opts: MeWerewolfAgentsPluginOptions,
) {
  const { agentStore } = opts;

  app.get(
    '/me/werewolf-agents',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const list = await agentStore.list(req.user!.userId);
      const longpollOnly = list.filter((a) => a.protocol === 'longpoll');
      reply.send({ data: longpollOnly.map(toPublicWerewolfAgent) });
    },
  );

  // Returns the raw token in the response body. The token is shown
  // exactly once — the platform stores only sha256(token) — so the UI
  // must surface it to the operator immediately. Subsequent reads only
  // see the public DTO.
  app.post(
    '/me/werewolf-agents',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const parsed = CreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          'SCHEMA_VALIDATION_FAILED',
          `/me/werewolf-agents body failed validation: ${parsed.error.message}`,
        );
      }
      const { name, description, timeoutMs } = parsed.data;
      const result = await agentStore.create({
        ownerId: req.user!.userId,
        name,
        description: description ?? null,
        protocol: 'longpoll',
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
      // create() always returns rawToken for protocol='longpoll' (the
      // store generates one and persists sha256). Defence-in-depth:
      // assert non-null so a future protocol change can't silently
      // ship a route that fails to surface a credential.
      if (result.rawToken === null) {
        throw new AppError(
          'INTERNAL_ERROR',
          `agent ${result.agent.id} created without a token (protocol mismatch)`,
        );
      }
      reply.status(201).send({
        data: {
          agent: toPublicWerewolfAgent(result.agent),
          rawToken: result.rawToken,
        },
      });
    },
  );

  app.post(
    '/me/werewolf-agents/:id/rotate-token',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const result = await agentStore.rotateToken(req.user!.userId, id);
        reply.send({
          data: {
            agent: toPublicWerewolfAgent(result.agent),
            rawToken: result.rawToken,
          },
        });
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        throw err;
      }
    },
  );

  app.delete(
    '/me/werewolf-agents/:id',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      // Lookup-then-delete so we can return 404 distinctly from a
      // silent no-op. The two queries race in theory but the worst
      // case is a 200 followed by a stale read — acceptable.
      const existing = await agentStore.get(req.user!.userId, id);
      if (!existing) throw new NotFoundError('Agent', id);
      await agentStore.delete(req.user!.userId, id);
      reply.status(204).send();
    },
  );
}
