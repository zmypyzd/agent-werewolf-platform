import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type {
  GetWerewolfMatchArtifactOptions,
  IWerewolfMatchArtifactStore,
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
} from '@agent-poker/persistence';
import { AppError } from '@agent-poker/shared';
import type { WerewolfDecisionTrace } from '@agent-poker/shared';

interface WerewolfMatchesPluginOptions extends FastifyPluginOptions {
  werewolfMatchArtifactStore: IWerewolfMatchArtifactStore;
}

type PublicWerewolfMatchArtifactManifest = Omit<WerewolfMatchArtifactManifest, 'files'>;
type PublicWerewolfDecisionTrace = Omit<
  WerewolfDecisionTrace,
  'privateStateHash' | 'reasoningSummary'
>;

function publicManifest(
  manifest: WerewolfMatchArtifactManifest,
): PublicWerewolfMatchArtifactManifest {
  const { files: _files, ...rest } = manifest;
  return rest;
}

function publicIndexEntry(
  entry: WerewolfMatchArtifactIndexEntry,
): WerewolfMatchArtifactIndexEntry {
  // The persisted index entry already lacks `seed` by design — no stripping needed.
  // Spread to return a plain object (defense-in-depth against reference leakage).
  return { ...entry };
}

function publicDecisionTraces(
  traces: ReadonlyArray<WerewolfDecisionTrace>,
): PublicWerewolfDecisionTrace[] {
  return traces.map((t) => {
    const {
      privateStateHash: _privateStateHash,
      reasoningSummary: _reasoningSummary,
      ...rest
    } = t;
    return rest;
  });
}

async function getRecordOrThrow(
  store: IWerewolfMatchArtifactStore,
  matchId: string,
  options?: GetWerewolfMatchArtifactOptions,
) {
  try {
    const record = await store.getMatchArtifact(matchId, options);
    if (record) return record;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid matchId path segment:')) {
      throw new AppError('MATCH_NOT_FOUND', `Werewolf match ${matchId} not found`);
    }
    throw e;
  }
  throw new AppError('MATCH_NOT_FOUND', `Werewolf match ${matchId} not found`);
}

export async function werewolfMatchesRoutes(
  app: FastifyInstance,
  opts: WerewolfMatchesPluginOptions,
) {
  const { werewolfMatchArtifactStore: store } = opts;

  app.get('/werewolf-matches', async (_req, reply) => {
    const entries = await store.listMatchArtifacts();
    reply.send({ data: entries.map(publicIndexEntry) });
  });

  app.get<{ Params: { matchId: string } }>('/werewolf-matches/:matchId', async (req, reply) => {
    const record = await getRecordOrThrow(store, req.params.matchId, {
      includeReplayEvents: false,
      includeDecisionTraces: false,
    });
    reply.send({
      data: {
        manifest: publicManifest(record.manifest),
        summary: record.summary,
      },
    });
  });

  app.get<{ Params: { matchId: string } }>(
    '/werewolf-matches/:matchId/replay',
    async (req, reply) => {
      const record = await getRecordOrThrow(store, req.params.matchId, {
        includeDecisionTraces: false,
      });
      reply.send({ data: record.replayEvents });
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/werewolf-matches/:matchId/decision-trace',
    async (req, reply) => {
      const record = await getRecordOrThrow(store, req.params.matchId, {
        includeReplayEvents: false,
      });
      reply.send({ data: publicDecisionTraces(record.decisionTraces) });
    },
  );
}
