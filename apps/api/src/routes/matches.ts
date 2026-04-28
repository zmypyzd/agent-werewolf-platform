import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { GetMatchArtifactOptions, IMatchArtifactStore } from '@agent-poker/persistence';
import { replayEventToPublic } from '@agent-poker/realtime';
import { AppError } from '@agent-poker/shared';
import type {
  DecisionTrace,
  MatchArtifactIndexEntry,
  MatchArtifactManifest,
  MatchSummary,
  ReplayEvent,
} from '@agent-poker/shared';
import { publicHandSummary } from './public-hand-summary.js';

interface MatchesPluginOptions extends FastifyPluginOptions {
  matchArtifactStore: IMatchArtifactStore;
}

function publicReplayEvents(events: ReplayEvent[]) {
  return events
    .map(event => replayEventToPublic(event))
    .filter((event): event is ReplayEvent => event !== null);
}

type PublicMatchSummary = Omit<MatchSummary, 'seed'>;
type PublicMatchArtifactIndexEntry = Omit<MatchArtifactIndexEntry, 'seed'>;
type PublicMatchArtifactManifest = Omit<MatchArtifactManifest, 'files'>;
type PublicDecisionTrace = Omit<DecisionTrace, 'privateStateHash' | 'reasoningSummary'>;

function publicMatchArtifactIndexEntry(entry: MatchArtifactIndexEntry): PublicMatchArtifactIndexEntry {
  const { seed: _seed, ...publicEntry } = entry;
  return publicEntry;
}

function publicMatchSummary(summary: MatchSummary): PublicMatchSummary {
  const { seed: _seed, ...rest } = summary;
  return {
    ...rest,
    hands: summary.hands.map(publicHandSummary),
  };
}

function publicMatchArtifactManifest(manifest: MatchArtifactManifest): PublicMatchArtifactManifest {
  const { files: _files, ...publicManifest } = manifest;
  return publicManifest;
}

function publicDecisionTraces(traces: DecisionTrace[]): PublicDecisionTrace[] {
  return traces.map(trace => {
    const {
      privateStateHash: _privateStateHash,
      reasoningSummary: _reasoningSummary,
      ...publicTrace
    } = trace;
    return publicTrace;
  });
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
    reply.send({ data: entries.map(publicMatchArtifactIndexEntry) });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(
      matchArtifactStore,
      req.params.matchId,
      { includeReplayEvents: false, includeDecisionTraces: false },
    );
    reply.send({
      data: {
        manifest: publicMatchArtifactManifest(record.manifest),
        summary: publicMatchSummary(record.summary),
      },
    });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId/replay', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(matchArtifactStore, req.params.matchId);
    reply.send({ data: publicReplayEvents(record.replayEvents) });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId/decision-trace', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(
      matchArtifactStore,
      req.params.matchId,
      { includeReplayEvents: false },
    );
    reply.send({ data: publicDecisionTraces(record.decisionTraces) });
  });

  app.get<{ Params: { matchId: string } }>('/matches/:matchId/analysis', async (req, reply) => {
    const record = await getMatchArtifactOrThrow(
      matchArtifactStore,
      req.params.matchId,
      { includeReplayEvents: false, includeDecisionTraces: false },
    );
    reply.send({ data: record.analysisSummary });
  });
}
