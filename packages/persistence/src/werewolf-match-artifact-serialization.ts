import type {
  WerewolfDecisionTrace,
  WerewolfHistoryEntry,
  WerewolfPublicHistoryEntry,
  WerewolfSide,
} from '@agent-poker/shared';
import {
  fileRef,
  safePathSegment,
  serializeJson,
} from './match-artifact-serialization.js';
import type {
  WerewolfMatchArtifactIndexEntry,
  WerewolfMatchArtifactManifest,
  WerewolfMatchArtifactRecord,
  WerewolfMatchFinalPlayerPublic,
  WerewolfMatchPublicSummary,
  WerewolfReplayEvent,
} from './werewolf-match-artifact-types.js';
import {
  serializeWerewolfDecisionTraces,
  toPublicWerewolfDecisionTrace,
} from './werewolf-decision-trace-serialization.js';
import { werewolfReplayEventToPublic } from '@agent-poker/realtime';

export interface BuildWerewolfArtifactInput {
  readonly matchId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly stepCount: number;
  readonly replayEventCount: number;
  readonly winner: WerewolfSide;
  readonly finalPlayers: ReadonlyArray<WerewolfMatchFinalPlayerPublic>;
  readonly fullHistory: ReadonlyArray<WerewolfHistoryEntry>;
  readonly replayEvents: ReadonlyArray<WerewolfReplayEvent>;
  readonly decisionTraces: ReadonlyArray<WerewolfDecisionTrace>;
}

export interface SerializedWerewolfArtifact {
  readonly record: WerewolfMatchArtifactRecord;
  readonly summaryRaw: string;
  readonly replayRaw: string;
  readonly decisionTraceRaw: string;
  readonly manifestRaw: string;
}

export function buildWerewolfArtifact(
  input: BuildWerewolfArtifactInput,
  createdAt = Date.now(),
): SerializedWerewolfArtifact {
  safePathSegment(input.matchId);

  const publicHistory = toPublicWerewolfHistory(input.fullHistory);
  const summary: WerewolfMatchPublicSummary = {
    matchId: input.matchId,
    winner: input.winner,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    nightCount: input.nightCount,
    dayCount: input.dayCount,
    stepCount: input.stepCount,
    replayEventCount: input.replayEventCount,
    finalPlayers: input.finalPlayers,
    history: publicHistory,
  };

  const replayEvents = toPublicWerewolfReplayEvents(input.replayEvents);
  const decisionTraces = input.decisionTraces.map(toPublicWerewolfDecisionTrace);

  const summaryRaw = serializeJson(summary);
  const replayRaw = serializeWerewolfReplayEvents(replayEvents);
  const decisionTraceRaw = serializeWerewolfDecisionTraces(decisionTraces);

  const manifest: WerewolfMatchArtifactManifest = {
    artifactVersion: 1,
    matchId: input.matchId,
    createdAt,
    files: {
      summary: fileRef('summary.json', summaryRaw, 'application/json'),
      replay: fileRef('replay.jsonl', replayRaw, 'application/x-ndjson'),
      decisionTrace: fileRef('decision-trace.jsonl', decisionTraceRaw, 'application/x-ndjson'),
    },
  };

  return {
    record: { manifest, summary, replayEvents, decisionTraces },
    summaryRaw,
    replayRaw,
    decisionTraceRaw,
    manifestRaw: serializeJson(manifest),
  };
}

export function serializeWerewolfReplayEvents(
  events: ReadonlyArray<WerewolfReplayEvent>,
): string {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  return sorted.map((e) => JSON.stringify(e)).join('\n') + (sorted.length > 0 ? '\n' : '');
}

export function toPublicWerewolfReplayEvents(
  events: ReadonlyArray<WerewolfReplayEvent>,
): WerewolfMatchArtifactRecord['replayEvents'] {
  return events
    .map((e) => werewolfReplayEventToPublic(e))
    .filter((e): e is WerewolfReplayEvent => e !== null);
}

export function toPublicWerewolfHistory(
  history: ReadonlyArray<WerewolfHistoryEntry>,
): WerewolfPublicHistoryEntry[] {
  const out: WerewolfPublicHistoryEntry[] = [];
  for (const entry of history) {
    switch (entry.type) {
      case 'role-assigned':
      case 'night-action':
        continue;
      case 'speech': {
        const { inner: _omit, ...rest } = entry.record;
        out.push({ type: 'speech', day: entry.day, record: rest });
        break;
      }
      case 'death':
      case 'vote':
      case 'hunter-shoot':
      case 'game-over':
        out.push(entry);
        break;
      default: {
        // Exhaustiveness guard — adding a new WerewolfHistoryEntry variant in
        // packages/shared will break this assignment until the new arm is
        // explicitly classified as public or private here.
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }
  return out;
}

export function toWerewolfArtifactIndexEntry(
  record: WerewolfMatchArtifactRecord,
): WerewolfMatchArtifactIndexEntry {
  return {
    matchId: record.manifest.matchId,
    winner: record.summary.winner,
    startedAt: record.summary.startedAt,
    completedAt: record.summary.completedAt,
    createdAt: record.manifest.createdAt,
    artifactPath: `matches/${record.manifest.matchId}/manifest.json`,
  };
}
