import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { GetMatchArtifactOptions, IMatchArtifactStore } from '@agent-poker/persistence';
import { replayEventToPublic } from '@agent-poker/realtime';
import { AppError } from '@agent-poker/shared';
import type { MatchSummary, PublicHandPlayerSummary, ReplayEvent } from '@agent-poker/shared';

interface MatchesPluginOptions extends FastifyPluginOptions {
  matchArtifactStore: IMatchArtifactStore;
}

function publicReplayEvents(events: ReplayEvent[]) {
  return events
    .map(event => replayEventToPublic(event))
    .filter((event): event is ReplayEvent => event !== null);
}

function publicMatchSummary(summary: MatchSummary): MatchSummary {
  return {
    ...summary,
    hands: summary.hands.map(hand => ({
      ...hand,
      players: hand.players.map(player => {
        const {
          holeCards: _holeCards,
          handEvaluation: _handEvaluation,
          ...publicPlayer
        } = player as PublicHandPlayerSummary & Record<string, unknown>;
        return publicPlayer as PublicHandPlayerSummary;
      }),
    })),
  };
}

async function getMatchArtifactOrThrow(
  store: IMatchArtifactStore,
  matchId: string,
  options?: GetMatchArtifactOptions,
) {
  try {
    const record = await store.getMatchArtifact(matchId, options);
    if (record) return record;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid matchId path segment:')) {
      throw new AppError('MATCH_NOT_FOUND', `Match ${matchId} not found`);
    }
    throw e;
  }
  throw new AppError('MATCH_NOT_FOUND', `Match ${matchId} not found`);
}

export async function matchesRoutes(app: FastifyInstance, opts: MatchesPluginOptions) {
  const { matchArtifactStore } = opts;

  app.get('/matches', async (_req, reply) => {
    const entries = await matchArtifactStore.listMatchArtifacts();
    reply.send({ data: entries });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(
      matchArtifactStore,
      req.params.matchId,
      { includeReplayEvents: false },
    );
    reply.send({
      data: {
        manifest: record.manifest,
        summary: publicMatchSummary(record.summary),
      },
    });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId/replay', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(matchArtifactStore, req.params.matchId);
    reply.send({ data: publicReplayEvents(record.replayEvents) });
  });
}
