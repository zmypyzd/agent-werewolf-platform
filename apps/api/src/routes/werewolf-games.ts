import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z, ZodError } from 'zod';
import {
  SchemaValidationError,
  WerewolfGameNotFoundError,
} from '@agent-poker/shared';
import type { WerewolfLobbyRegistry } from '../werewolf-lobby-registry.js';

interface WerewolfGamesPluginOptions extends FastifyPluginOptions {
  registry: WerewolfLobbyRegistry;
}

const CreateGameBody = z.object({
  name: z.string().max(100).optional(),
  seed: z.string().max(100).optional(),
});

const InviteNpcBody = z
  .object({
    displayName: z.string().min(1).max(50).optional(),
  })
  .strict();

const SeatParams = z.object({
  gameId: z.string().min(1),
  seatIndex: z.coerce.number().int().min(0).max(8),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body ?? {});
  } catch (e) {
    if (e instanceof ZodError) throw new SchemaValidationError(e.message);
    throw e;
  }
}

export async function werewolfGamesRoutes(
  app: FastifyInstance,
  opts: WerewolfGamesPluginOptions,
) {
  const { registry } = opts;

  // POST /werewolf-games — create
  app.post('/werewolf-games', { preHandler: [app.requireCsrf] }, async (req, reply) => {
    const body = parseBody(CreateGameBody, req.body);
    const entry = registry.create(body);
    reply.status(201).send({ data: entry });
  });

  // GET /werewolf-games — list
  app.get('/werewolf-games', async (_req, reply) => {
    reply.send({ data: registry.list() });
  });

  // GET /werewolf-games/:gameId — full lobby state
  app.get<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId',
    async (req, reply) => {
      const entry = registry.get(req.params.gameId);
      if (!entry) {
        throw new WerewolfGameNotFoundError(req.params.gameId);
      }
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/seats/:seatIndex/invite-npc
  app.post<{ Params: { gameId: string; seatIndex: string } }>(
    '/werewolf-games/:gameId/seats/:seatIndex/invite-npc',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      const { gameId, seatIndex } = parseBody(SeatParams, req.params);
      const body = parseBody(InviteNpcBody, req.body);
      const entry = registry.inviteNpc(gameId, seatIndex, body.displayName);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/fill-with-npcs
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/fill-with-npcs',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      const entry = registry.fillWithNpcs(req.params.gameId);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/start
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/start',
    { preHandler: [app.requireCsrf] },
    async (req, reply) => {
      // start() returns the run-promise; we deliberately do NOT await it.
      // Errors during runMatch land in the registry's internal handler and
      // flip status to 'failed'. Attach a no-op catch so unhandled rejection
      // warnings don't fire.
      const promise = registry.start(req.params.gameId);
      promise.catch(() => {
        /* recorded in registry */
      });
      const entry = registry.get(req.params.gameId)!;
      reply.status(202).send({ data: entry });
    },
  );
}
