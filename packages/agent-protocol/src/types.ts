import { z } from 'zod';
import type {
  AgentDecisionRequestSchema,
  AgentDecisionResponseSchema,
  PublicGameStateSchema,
  PrivatePlayerStateSchema,
  LegalActionSchema,
  GameActionSchema,
  HandSummarySchema,
  ReplayEventSchema,
  TableConfigSchema,
  BlindConfigSchema,
  CardSchema,
  PotSchema,
  PublicPlayerSchema,
  HandEvaluationSchema,
  HandPlayerSummarySchema,
  HandResultSchema,
  MatchArtifactFileRefSchema,
  MatchSummarySchema,
  MatchArtifactManifestSchema,
  MatchArtifactIndexEntrySchema,
  MatchArtifactRecordSchema,
  SimulateRequestSchema,
  AddAgentRequestSchema,
  CreateTableRequestSchema,
} from './schemas.js';

export type AgentDecisionRequestZod = z.infer<typeof AgentDecisionRequestSchema>;
export type AgentDecisionResponseZod = z.infer<typeof AgentDecisionResponseSchema>;
export type PublicGameStateZod = z.infer<typeof PublicGameStateSchema>;
export type PrivatePlayerStateZod = z.infer<typeof PrivatePlayerStateSchema>;
export type LegalActionZod = z.infer<typeof LegalActionSchema>;
export type GameActionZod = z.infer<typeof GameActionSchema>;
export type HandSummaryZod = z.infer<typeof HandSummarySchema>;
export type ReplayEventZod = z.infer<typeof ReplayEventSchema>;
export type TableConfigZod = z.infer<typeof TableConfigSchema>;
export type BlindConfigZod = z.infer<typeof BlindConfigSchema>;
export type CardZod = z.infer<typeof CardSchema>;
export type PotZod = z.infer<typeof PotSchema>;
export type PublicPlayerZod = z.infer<typeof PublicPlayerSchema>;
export type HandEvaluationZod = z.infer<typeof HandEvaluationSchema>;
export type HandPlayerSummaryZod = z.infer<typeof HandPlayerSummarySchema>;
export type HandResultZod = z.infer<typeof HandResultSchema>;
export type SimulateRequestZod = z.infer<typeof SimulateRequestSchema>;
export type AddAgentRequestZod = z.infer<typeof AddAgentRequestSchema>;
export type CreateTableRequestZod = z.infer<typeof CreateTableRequestSchema>;
export type MatchArtifactFileRefZod = z.infer<typeof MatchArtifactFileRefSchema>;
export type MatchSummaryZod = z.infer<typeof MatchSummarySchema>;
export type MatchArtifactManifestZod = z.infer<typeof MatchArtifactManifestSchema>;
export type MatchArtifactIndexEntryZod = z.infer<typeof MatchArtifactIndexEntrySchema>;
export type MatchArtifactRecordZod = z.infer<typeof MatchArtifactRecordSchema>;
