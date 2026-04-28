import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import type { TableOrchestrator } from '@agent-poker/table-orchestrator';
import type { MemoryHandStore } from '@agent-poker/persistence';
import {
  NotFoundError, SchemaValidationError, AppError,
  NotImplementedError,
} from '@agent-poker/shared';
import {
  CreateTableRequestSchema,
  AddAgentRequestSchema,
  SubmitActionRequestSchema,
  SitAsHumanRequestSchema,
  SitAsAgentRequestSchema,
} from '@agent-poker/agent-protocol';
import {
  RandomMockAgent, AlwaysCallAgent, AlwaysFoldAgent, AggressiveAgent,
  HumanAgent, HttpAgentAdapter,
} from '@agent-poker/agent-runtime';
import { replayEventToPublic } from '@agent-poker/realtime';
import type { IUserAgentConfigStore } from '@agent-poker/persistence';
import { randomUUID } from 'crypto';
import { publicHandSummaries, publicHandSummary } from './public-hand-summary.js';

interface TablesPluginOptions extends FastifyPluginOptions {
  orchestrator: TableOrchestrator;
  handStore: InstanceType<typeof MemoryHandStore>;
  agentConfigStore: IUserAgentConfigStore;
}

export async function tablesRoutes(app: FastifyInstance, opts: TablesPluginOptions) {
  const { orchestrator, handStore, agentConfigStore } = opts;

  // POST /tables — create
  app.post(
    '/tables',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body: z.infer<typeof CreateTableRequestSchema>;
      try {
        body = CreateTableRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }
      const ownerUserId = req.user!.userId;
      const table = await orchestrator.createTable(
        {
          name: body.name,
          maxSeats: body.maxSeats,
          blindConfig: body.blindConfig,
          ...(body.seed !== undefined ? { seed: body.seed } : {}),
          defaultTimeoutMs: body.defaultTimeoutMs ?? 5000,
          ...(body.maxSpectators !== undefined ? { maxSpectators: body.maxSpectators } : {}),
        },
        ownerUserId,
      );
      reply.status(201).send({ data: table });
    },
  );

  // GET /tables — list with TableSummary shape
  app.get(
    '/tables',
    { preHandler: [app.requireAuth] },
    async (_req, reply) => {
      const tables = await orchestrator.listTables();
      reply.send({ data: tables.map(t => orchestrator.summarize(t)) });
    },
  );

  // GET /tables/:tableId
  app.get<{ Params: { tableId: string } }>(
    '/tables/:tableId',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const table = await orchestrator.getTable(req.params.tableId).catch(e => {
        if (e instanceof NotFoundError) {
          throw new AppError('TABLE_NOT_FOUND', e.message);
        }
        throw e;
      });
      reply.send({
        data: {
          ...table,
          canManage: orchestrator.getTableOwnerUserId(req.params.tableId) === req.user!.userId,
        },
      });
    },
  );

  // DELETE /tables/:tableId — owner only
  app.delete<{ Params: { tableId: string } }>(
    '/tables/:tableId',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const userId = req.user!.userId;
      await orchestrator.deleteTable(req.params.tableId, userId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.send({ data: { deleted: true } });
    },
  );

  // POST /tables/:tableId/agents — add agent (Phase 1 mock-style; the caller owns the seat)
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/agents',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body: z.infer<typeof AddAgentRequestSchema>;
      try {
        body = AddAgentRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      if (body.adapterType !== 'mock') {
        throw new NotImplementedError(`adapterType=${body.adapterType}`);
      }

      const agentId = `agent-${randomUUID().slice(0, 8)}`;
      const strategy = body.strategy ?? 'random';
      let agent;
      switch (strategy) {
        case 'always-call': agent = new AlwaysCallAgent(agentId, body.name); break;
        case 'always-fold': agent = new AlwaysFoldAgent(agentId, body.name); break;
        case 'aggressive': agent = new AggressiveAgent(agentId, body.name); break;
        default: agent = new RandomMockAgent(agentId, body.name);
      }

      const seat = await orchestrator.addAgent(
        req.params.tableId,
        { agentId, name: body.name, adapterType: body.adapterType },
        agent,
        body.buyIn,
        { ownerUserId: req.user!.userId, adapterType: 'mock' },
      ).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });

      reply.send({ data: seat });
    },
  );

  // DELETE /tables/:tableId/agents/:agentId — owner only
  app.delete<{ Params: { tableId: string; agentId: string } }>(
    '/tables/:tableId/agents/:agentId',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const userId = req.user!.userId;
      await orchestrator.removeAgent(req.params.tableId, req.params.agentId, userId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('AGENT_NOT_FOUND', e.message);
        throw e;
      });
      reply.send({ data: { removed: true } });
    },
  );

  // POST /tables/:tableId/hands/start
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/hands/start',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const summary = await orchestrator.startHand(req.params.tableId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.send({ data: summary });
    },
  );

  // POST /tables/:tableId/actions — submit a human player's action for the open turn
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/actions',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body: z.infer<typeof SubmitActionRequestSchema>;
      try {
        body = SubmitActionRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }

      const userId = req.user!.userId;
      const action = {
        handId: body.handId,
        actionType: body.actionType,
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
      };
      await orchestrator.submitHumanAction(req.params.tableId, userId, action).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });

      reply.status(202).send({ data: { accepted: true } });
    },
  );

  // POST /tables/:tableId/watch — register as a spectator
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/watch',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      await orchestrator.addSpectator(req.params.tableId, req.user!.userId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.status(204).send();
    },
  );

  // DELETE /tables/:tableId/watch — leave the spectator list
  app.delete<{ Params: { tableId: string } }>(
    '/tables/:tableId/watch',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      await orchestrator.removeSpectator(req.params.tableId, req.user!.userId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.status(204).send();
    },
  );

  // POST /tables/:tableId/seats — sit as a human player
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/seats',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body: z.infer<typeof SitAsHumanRequestSchema>;
      try {
        body = SitAsHumanRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }
      const userId = req.user!.userId;
      const agentId = `human-${randomUUID().slice(0, 8)}`;
      const agent = new HumanAgent(agentId, req.user!.displayName);
      const seat = await orchestrator.addAgent(
        req.params.tableId,
        { agentId, name: req.user!.displayName, adapterType: 'mock' },
        agent,
        body.buyIn,
        { ownerUserId: userId, adapterType: 'human' },
        body.seatIndex,
      ).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.status(201).send({ data: seat });
    },
  );

  // DELETE /tables/:tableId/seats/me — leave the seat
  app.delete<{ Params: { tableId: string } }>(
    '/tables/:tableId/seats/me',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const result = await orchestrator.leaveSeat(req.params.tableId, userId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      if (result.status === 'left') {
        reply.status(204).send();
      } else {
        reply.send({ data: { sitOutNextHand: true, seatIndex: result.seatIndex } });
      }
    },
  );

  // POST /tables/:tableId/seats/agent — sit one of the user's HTTP agents
  app.post<{ Params: { tableId: string } }>(
    '/tables/:tableId/seats/agent',
    { preHandler: [app.requireAuth, app.requireCsrf] },
    async (req, reply) => {
      let body: z.infer<typeof SitAsAgentRequestSchema>;
      try {
        body = SitAsAgentRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new SchemaValidationError(e.message);
        throw e;
      }
      const userId = req.user!.userId;
      const cfg = await agentConfigStore.get(userId, body.agentConfigId);
      if (!cfg) throw new AppError('AGENT_NOT_FOUND', `Agent config ${body.agentConfigId} not found`);

      const agentId = `http-${randomUUID().slice(0, 8)}`;
      const agent = new HttpAgentAdapter({
        agentId,
        name: cfg.agentName,
        endpointUrl: cfg.endpointUrl,
        authHeaderName: cfg.authHeaderName,
        authHeaderValue: cfg.authHeaderValue,
        timeoutMs: cfg.timeoutMs,
      });
      const seat = await orchestrator.addAgent(
        req.params.tableId,
        { agentId, name: cfg.agentName, adapterType: 'http' },
        agent,
        body.buyIn,
        { ownerUserId: userId, adapterType: 'http', agentConfigId: cfg.agentConfigId },
        body.seatIndex,
      ).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.status(201).send({ data: seat });
    },
  );

  // GET /tables/:tableId/state
  app.get<{ Params: { tableId: string } }>(
    '/tables/:tableId/state',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const state = await orchestrator.getCurrentState(req.params.tableId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      reply.send({ data: state });
    },
  );

  // GET /tables/:tableId/hands
  app.get<{ Params: { tableId: string } }>(
    '/tables/:tableId/hands',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const table = await orchestrator.getTable(req.params.tableId).catch(e => {
        if (e instanceof NotFoundError) throw new AppError('TABLE_NOT_FOUND', e.message);
        throw e;
      });
      const hands = await handStore.listHandSummaries(table.tableId);
      reply.send({ data: publicHandSummaries(hands) });
    },
  );

  // GET /tables/:tableId/hands/:handId
  app.get<{ Params: { tableId: string; handId: string } }>(
    '/tables/:tableId/hands/:handId',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const hand = await handStore.getHandSummary(req.params.handId);
      if (!hand) throw new AppError('HAND_NOT_FOUND', `Hand ${req.params.handId} not found`);
      reply.send({ data: publicHandSummary(hand) });
    },
  );

  // GET /tables/:tableId/hands/:handId/replay
  app.get<{ Params: { tableId: string; handId: string } }>(
    '/tables/:tableId/hands/:handId/replay',
    { preHandler: [app.requireAuth] },
    async (req, reply) => {
      const events = await handStore.getReplayEvents(req.params.handId);
      const publicEvents = events
        .map(event => replayEventToPublic(event))
        .filter(event => event !== null);
      reply.send({ data: publicEvents });
    },
  );
}
