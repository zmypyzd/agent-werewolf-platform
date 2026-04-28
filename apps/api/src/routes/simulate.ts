import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ZodError } from 'zod';
import type { TableOrchestrator } from '@agent-poker/table-orchestrator';
import type { IDecisionTraceStore, IHandStore, IMatchArtifactStore } from '@agent-poker/persistence';
import { SchemaValidationError, AppError } from '@agent-poker/shared';
import type { MatchArtifactManifest } from '@agent-poker/shared';
import { SimulateRequestSchema } from '@agent-poker/agent-protocol';
import { RandomMockAgent, AlwaysCallAgent, AlwaysFoldAgent, AggressiveAgent } from '@agent-poker/agent-runtime';
import { randomUUID } from 'crypto';
import { publicHandSummaries } from './public-hand-summary.js';

interface SimulatePluginOptions extends FastifyPluginOptions {
  orchestrator: TableOrchestrator;
  handStore: IHandStore;
  matchArtifactStore: IMatchArtifactStore;
  decisionTraceStore: IDecisionTraceStore;
}

type PublicMatchArtifactManifest = Omit<MatchArtifactManifest, 'files'>;

function publicMatchArtifactManifest(manifest: MatchArtifactManifest): PublicMatchArtifactManifest {
  const { files: _files, ...publicManifest } = manifest;
  return publicManifest;
}

export async function simulateRoutes(app: FastifyInstance, opts: SimulatePluginOptions) {
  const { orchestrator, handStore, matchArtifactStore, decisionTraceStore } = opts;

  app.post('/simulate', { preHandler: [app.requireAuth, app.requireCsrf] }, async (req, reply) => {
    let body: ReturnType<typeof SimulateRequestSchema.parse>;
    try {
      body = SimulateRequestSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new SchemaValidationError(e.message);
      throw e;
    }

    try {
      const ownerUserId = req.user!.userId;
      const table = await orchestrator.createTable(
        {
          name: body.name,
          maxSeats: body.maxSeats,
          blindConfig: body.blindConfig,
          ...(body.seed !== undefined ? { seed: body.seed } : {}),
          defaultTimeoutMs: body.defaultTimeoutMs ?? 5000,
        },
        ownerUserId,
      );

      for (const agentSpec of body.agents) {
        const agentId = `agent-${randomUUID().slice(0, 8)}`;
        let agent;
        switch (agentSpec.strategy) {
          case 'always-call': agent = new AlwaysCallAgent(agentId, agentSpec.name); break;
          case 'always-fold': agent = new AlwaysFoldAgent(agentId, agentSpec.name); break;
          case 'aggressive': agent = new AggressiveAgent(agentId, agentSpec.name); break;
          default: agent = new RandomMockAgent(agentId, agentSpec.name);
        }
        await orchestrator.addAgent(
          table.tableId,
          { agentId, name: agentSpec.name, adapterType: 'mock' },
          agent,
          agentSpec.buyIn,
          { ownerUserId: `sys-sim-${ownerUserId}-${agentId}`, adapterType: 'mock' },
        );
      }

      const hands = await orchestrator.runSimulation(table.tableId, body.numHands);

      const finalTable = await orchestrator.getTable(table.tableId);
      const finalStacks: Record<string, number> = {};
      for (const seat of finalTable.seats) {
        if (seat) {
          finalStacks[seat.agentId] = seat.stack;
        }
      }

      const replayEvents = (
        await Promise.all(hands.map(hand => handStore.getReplayEvents(hand.handId)))
      ).flat();
      const decisionTraces = await decisionTraceStore.listDecisionTraces(table.tableId);

      const matchArtifact = await matchArtifactStore.saveMatchArtifact({
        matchId: table.tableId,
        tableId: table.tableId,
        name: body.name,
        seed: table.config.seed || body.seed || table.tableId,
        hands,
        replayEvents,
        decisionTraces,
      });

      reply.send({
        data: {
          tableId: table.tableId,
          hands: publicHandSummaries(hands),
          finalStacks,
          totalHands: hands.length,
          matchArtifact: {
            matchId: matchArtifact.manifest.matchId,
            manifest: publicMatchArtifactManifest(matchArtifact.manifest),
          },
        },
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('SIMULATION_FAILED', (e as Error).message);
    }
  });
}
