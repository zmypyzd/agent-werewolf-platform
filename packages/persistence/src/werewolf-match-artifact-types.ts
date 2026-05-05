import type {
  WerewolfDecisionTrace,
  WerewolfPublicHistoryEntry,
  WerewolfRole,
  WerewolfSide,
} from '@agent-poker/shared';
// WerewolfReplayEvent lives in @agent-poker/shared so the persistence layer
// can use the canonical type without depending on werewolf-orchestrator.
import type { WerewolfReplayEvent } from '@agent-poker/shared';

export type { WerewolfReplayEvent };

export interface WerewolfMatchArtifactFileRef {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
}

export interface WerewolfMatchArtifactManifest {
  readonly artifactVersion: 1;
  readonly matchId: string;
  readonly createdAt: number;
  readonly files: {
    readonly summary: WerewolfMatchArtifactFileRef;
    readonly replay: WerewolfMatchArtifactFileRef;
    readonly decisionTrace: WerewolfMatchArtifactFileRef;
  };
}

// Player snapshot in the public summary. At game-over all roles are revealed
// (deaths reveal their role, alive winners reveal theirs at the reveal step),
// so finalPlayers carrying role+side at end-of-game does not leak game-time
// secrets.
export interface WerewolfMatchFinalPlayerPublic {
  readonly id: string;
  readonly seatIndex: number;
  readonly name: string;
  readonly role: WerewolfRole;
  readonly side: WerewolfSide;
  readonly alive: boolean;
}

export interface WerewolfMatchPublicSummary {
  readonly matchId: string;
  // Note: seed deliberately omitted; the public artifact must not let
  // spectators replay private RNG draws. Mirrors poker omitting `seed`
  // from PublicMatchSummary in apps/api/src/routes/matches.ts.
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly nightCount: number;
  readonly dayCount: number;
  readonly stepCount: number;
  readonly replayEventCount: number;
  readonly finalPlayers: ReadonlyArray<WerewolfMatchFinalPlayerPublic>;
  readonly history: ReadonlyArray<WerewolfPublicHistoryEntry>;
}

export interface WerewolfMatchArtifactRecord {
  readonly manifest: WerewolfMatchArtifactManifest;
  readonly summary: WerewolfMatchPublicSummary;
  readonly replayEvents: ReadonlyArray<WerewolfReplayEvent>;
  readonly decisionTraces: ReadonlyArray<WerewolfDecisionTrace>;
}

export interface WerewolfMatchArtifactIndexEntry {
  readonly matchId: string;
  readonly winner: WerewolfSide;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly createdAt: number;
  readonly artifactPath: string;
}
