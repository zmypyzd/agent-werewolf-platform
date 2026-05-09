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

// Owner-scoped invite of a registered HTTP agent. agentConfigId must be a
// UserAgentConfig owned by the authenticated requester; cross-account access
// surfaces as AGENT_NOT_FOUND (404, not 403) to keep cfg existence private.
const InviteAgentBody = z
  .object({
    agentConfigId: z.string().min(1),
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
  // Auth required (D1=A): once agent-config-backed seating exists, anonymous
  // creation lets anyone spin up a board to seat someone else's agents on.
  app.post(
    '/werewolf-games',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const body = parseBody(CreateGameBody, req.body);
      const createInput: { name?: string; seed?: string; creatorUserId: string } = {
        creatorUserId: req.user!.userId,
      };
      if (body.name !== undefined) createInput.name = body.name;
      if (body.seed !== undefined) createInput.seed = body.seed;
      const entry = registry.create(createInput);
      reply.status(201).send({ data: entry });
    },
  );

  // GET /werewolf-games — list
  app.get('/werewolf-games', async (_req, reply) => {
    reply.send({ data: registry.list() });
  });

  // GET /werewolf-games/:gameId — full lobby state
  // Auth-aware (D5=A): public response stays public for anon/spectator viewers,
  // but if a session cookie is present, the registry computes seat.isMine for
  // any kind:'agent' seat owned by the requester. This is the load-bearing
  // owner-identification mechanism and the only place req.user can leak into
  // the response — projection lives in publicEntry().
  app.get<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId',
    async (req, reply) => {
      const viewerUserId = req.user?.userId;
      const entry = registry.get(req.params.gameId, viewerUserId);
      if (!entry) {
        throw new WerewolfGameNotFoundError(req.params.gameId);
      }
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/seats/:seatIndex/invite-npc
  app.post<{ Params: { gameId: string; seatIndex: string } }>(
    '/werewolf-games/:gameId/seats/:seatIndex/invite-npc',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { gameId, seatIndex } = parseBody(SeatParams, req.params);
      const body = parseBody(InviteNpcBody, req.body);
      // Host-only — see registry.assertCreatorOnly. Without this, any
      // logged-in user could seat bots into another user's lobby.
      const entry = registry.inviteNpc(gameId, seatIndex, body.displayName, req.user!.userId);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/seats/:seatIndex/invite-agent
  // Mirrors invite-npc shape but seats the requester's registered HTTP agent
  // (UserAgentConfig). Owner check happens inside registry.inviteAgent.
  app.post<{ Params: { gameId: string; seatIndex: string } }>(
    '/werewolf-games/:gameId/seats/:seatIndex/invite-agent',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const { gameId, seatIndex } = parseBody(SeatParams, req.params);
      const body = parseBody(InviteAgentBody, req.body);
      const ownerUserId = req.user!.userId;
      const entry = await registry.inviteAgent(
        gameId,
        seatIndex,
        body.agentConfigId,
        ownerUserId,
        body.displayName,
      );
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/fill-with-npcs
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/fill-with-npcs',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      // Host-only — same authorization model as invite-npc.
      const entry = registry.fillWithNpcs(req.params.gameId, req.user!.userId);
      reply.send({ data: entry });
    },
  );

  // POST /werewolf-games/:gameId/start
  app.post<{ Params: { gameId: string } }>(
    '/werewolf-games/:gameId/start',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      // start() returns the run-promise; we deliberately do NOT await it.
      // Errors during runMatch land in the registry's internal handler and
      // flip status to 'failed'. Attach a no-op catch so unhandled rejection
      // warnings don't fire. Host-only — see registry.assertCreatorOnly;
      // before this gate, any logged-in user could start any lobby they
      // discovered in the public list endpoint.
      const promise = registry.start(req.params.gameId, req.user!.userId);
      promise.catch(() => {
        /* recorded in registry */
      });
      const entry = registry.get(req.params.gameId)!;
      reply.status(202).send({ data: entry });
    },
  );
}
