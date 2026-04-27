import { z } from 'zod';

export const RankSchema = z.enum(['2','3','4','5','6','7','8','9','T','J','Q','K','A']);
export const SuitSchema = z.enum(['c','d','h','s']);

export const CardSchema = z.object({
  rank: RankSchema,
  suit: SuitSchema,
});

export const ActionTypeSchema = z.enum(['fold','check','call','bet','raise','all-in']);
export const HandPhaseSchema = z.enum(['preflop','flop','turn','river','showdown','complete']);
export const DecisionTracePhaseSchema = z.enum(['preflop','flop','turn','river']);
export const PlayerStatusSchema = z.enum(['waiting','active','folded','all-in','sitting-out']);
export const AgentAdapterTypeSchema = z.enum(['mock','http','websocket','openclaw']);
export const ReasoningIntentSchema = z.enum([
  'value',
  'bluff',
  'semi_bluff',
  'pot_control',
  'protection',
  'information',
  'survival',
  'unknown',
]);
export const ReasoningRiskLevelSchema = z.enum(['low','medium','high']);
export const DecisionTraceFallbackReasonSchema = z.enum(['timeout','invalid_action','missing_agent']);
export const HandRankCategorySchema = z.enum([
  'high_card','one_pair','two_pair','three_of_a_kind',
  'straight','flush','full_house','four_of_a_kind','straight_flush'
]);

export const LegalActionSchema = z.object({
  type: ActionTypeSchema,
  callAmount: z.number().int().nonnegative().optional(),
  minAmount: z.number().int().positive().optional(),
  maxAmount: z.number().int().positive().optional(),
});

export const PotSchema = z.object({
  amount: z.number().int().nonnegative(),
  eligiblePlayerIds: z.array(z.string()),
});

export const PublicPlayerSchema = z.object({
  playerId: z.string(),
  seatIndex: z.number().int().nonnegative(),
  stack: z.number().int().nonnegative(),
  status: PlayerStatusSchema,
  totalBetInHand: z.number().int().nonnegative(),
  currentRoundBet: z.number().int().nonnegative(),
});

export const GameActionSchema = z.object({
  actionId: z.string(),
  handId: z.string(),
  playerId: z.string(),
  phase: HandPhaseSchema,
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative(),
  stackAfter: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
});

export const PublicGameStateSchema = z.object({
  handId: z.string(),
  tableId: z.string(),
  phase: HandPhaseSchema,
  players: z.array(PublicPlayerSchema),
  communityCards: z.array(CardSchema),
  pots: z.array(PotSchema),
  button: z.number().int().nonnegative(),
  smallBlindIndex: z.number().int().nonnegative(),
  bigBlindIndex: z.number().int().nonnegative(),
  currentActorIndex: z.number().int().nonnegative(),
  currentRoundMinBet: z.number().int().nonnegative(),
  minRaiseAmount: z.number().int().nonnegative(),
  allActions: z.array(GameActionSchema),
});

export const PrivatePlayerStateSchema = z.object({
  playerId: z.string(),
  holeCards: z.tuple([CardSchema, CardSchema]),
});

export const AgentDecisionRequestSchema = z.object({
  requestId: z.string(),
  handId: z.string(),
  tableId: z.string(),
  agentId: z.string(),
  publicState: PublicGameStateSchema,
  privateState: PrivatePlayerStateSchema,
  legalActions: z.array(LegalActionSchema),
  timeoutMs: z.number().int().positive(),
});

const ReasoningTextSchema = z.string().min(1).max(160);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ReasoningConsideredActionSchema = z.object({
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
  reason: ReasoningTextSchema,
}).strict();

export const ReasoningSummarySchema = z.object({
  intent: ReasoningIntentSchema,
  confidence: z.number().min(0).max(1),
  riskLevel: ReasoningRiskLevelSchema,
  keyObservations: z.array(ReasoningTextSchema).max(5),
  consideredActions: z.array(ReasoningConsideredActionSchema).max(6),
}).strict();

export const AgentDecisionResponseSchema = z.object({
  requestId: z.string(),
  agentId: z.string(),
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
  reasoningSummary: ReasoningSummarySchema.optional(),
});

export const DecisionTraceActionSchema = z.object({
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
}).strict();

export const DecisionTraceAppliedActionSchema = z.object({
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative(),
  fallbackReason: DecisionTraceFallbackReasonSchema.optional(),
}).strict();

export const DecisionTraceSchema = z.object({
  traceId: z.string().min(1),
  matchId: z.string().min(1),
  handId: z.string().min(1),
  actionId: z.string().min(1).nullable(),
  requestId: z.string().min(1),
  agentId: z.string().min(1),
  playerId: z.string().min(1),
  phase: DecisionTracePhaseSchema,
  publicStateHash: Sha256Schema,
  privateStateHash: Sha256Schema,
  legalActions: z.array(LegalActionSchema).max(16),
  responseAction: DecisionTraceActionSchema.nullable(),
  appliedAction: DecisionTraceAppliedActionSchema,
  latencyMs: z.number().int().nonnegative(),
  timedOut: z.boolean(),
  invalidReason: z.string().max(500).nullable(),
  reasoningSummary: ReasoningSummarySchema.nullable(),
  createdAt: z.number().int().positive(),
}).strict();

export const BlindConfigSchema = z.object({
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
});

export const TableConfigSchema = z.object({
  tableId: z.string(),
  name: z.string().min(1),
  maxSeats: z.number().int().min(2).max(9),
  blindConfig: BlindConfigSchema,
  defaultTimeoutMs: z.number().int().positive(),
  seed: z.string().optional(),
});

export const HandEvaluationSchema = z.object({
  category: HandRankCategorySchema,
  categoryRank: z.number().int().nonnegative(),
  tiebreakers: z.array(z.number().int()),
  bestCards: z.tuple([CardSchema, CardSchema, CardSchema, CardSchema, CardSchema]),
  description: z.string(),
});

export const HandPlayerSummarySchema = z.object({
  playerId: z.string(),
  agentId: z.string(),
  seatIndex: z.number().int().nonnegative(),
  stackBefore: z.number().int().nonnegative(),
  stackAfter: z.number().int().nonnegative(),
  holeCards: z.tuple([CardSchema, CardSchema]),
  handEvaluation: HandEvaluationSchema.optional(),
});

export const PublicHandPlayerSummarySchema = HandPlayerSummarySchema.omit({
  holeCards: true,
  handEvaluation: true,
});

export const HandResultSchema = z.object({
  playerId: z.string(),
  seatIndex: z.number().int().nonnegative(),
  potIndex: z.number().int().nonnegative(),
  winAmount: z.number().int().nonnegative(),
  netChange: z.number().int(),
});

export const HandSummarySchema = z.object({
  handId: z.string(),
  tableId: z.string(),
  handNumber: z.number().int().positive(),
  seed: z.string(),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  players: z.array(HandPlayerSummarySchema),
  blindConfig: BlindConfigSchema,
  communityCards: z.array(CardSchema),
  allActions: z.array(GameActionSchema),
  results: z.array(HandResultSchema),
  finalPots: z.array(PotSchema),
});

export const PublicHandSummarySchema = HandSummarySchema.extend({
  players: z.array(PublicHandPlayerSummarySchema),
});

export const ReplayEventSchema = z.object({
  eventId: z.string(),
  handId: z.string(),
  tableId: z.string(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  timestamp: z.number().int().positive(),
  data: z.record(z.unknown()),
});

export const MatchArtifactFileRefSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

const ActionCountMapSchema = z.record(ActionTypeSchema, z.number().int().nonnegative());
const StreetActionCountMapSchema = z.record(DecisionTracePhaseSchema, ActionCountMapSchema);
const IntentCountMapSchema = z.record(ReasoningIntentSchema, z.number().int().nonnegative());
const RiskCountMapSchema = z.record(ReasoningRiskLevelSchema, z.number().int().nonnegative());

export const AnalysisMetricSummarySchema = z.object({
  decisionCount: z.number().int().nonnegative(),
  actionCounts: ActionCountMapSchema,
  streetCounts: StreetActionCountMapSchema,
  intentCounts: IntentCountMapSchema,
  riskCounts: RiskCountMapSchema,
  missingReasoningCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  invalidActionCount: z.number().int().nonnegative(),
  fallbackCount: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1).nullable(),
  averageLatencyMs: z.number().nonnegative().nullable(),
  maxLatencyMs: z.number().int().nonnegative().nullable(),
}).strict();

export const AgentAnalysisSummarySchema = AnalysisMetricSummarySchema.extend({
  agentId: z.string().min(1),
  playerIds: z.array(z.string().min(1)),
  handIds: z.array(z.string().min(1)),
}).strict();

export const MatchAnalysisSummarySchema = z.object({
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  generatedAt: z.number().int().positive(),
  handCount: z.number().int().nonnegative(),
  agentCount: z.number().int().nonnegative(),
  decisionCount: z.number().int().nonnegative(),
  totals: AnalysisMetricSummarySchema,
  agents: z.array(AgentAnalysisSummarySchema),
}).strict();

export const MatchSummarySchema = z.object({
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  name: z.string().min(1),
  seed: z.string().min(1),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  handIds: z.array(z.string().min(1)),
  hands: z.array(PublicHandSummarySchema),
  finalStacks: z.record(z.number().int()),
  agentIds: z.array(z.string().min(1)),
});

export const MatchArtifactManifestSchema = z.object({
  artifactVersion: z.literal(1),
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  createdAt: z.number().int().positive(),
  handIds: z.array(z.string().min(1)),
  files: z.object({
    summary: MatchArtifactFileRefSchema,
    replay: MatchArtifactFileRefSchema,
    decisionTrace: MatchArtifactFileRefSchema,
    analysisSummary: MatchArtifactFileRefSchema,
  }),
});

export const MatchArtifactIndexEntrySchema = z.object({
  matchId: z.string().min(1),
  tableId: z.string().min(1),
  name: z.string().min(1),
  seed: z.string().min(1),
  handCount: z.number().int().nonnegative(),
  agentIds: z.array(z.string().min(1)),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  artifactPath: z.string().min(1),
});

export const MatchArtifactRecordSchema = z.object({
  manifest: MatchArtifactManifestSchema,
  summary: MatchSummarySchema,
  replayEvents: z.array(ReplayEventSchema),
  decisionTraces: z.array(DecisionTraceSchema),
  analysisSummary: MatchAnalysisSummarySchema,
}).superRefine((record, ctx) => {
  if (record.manifest.matchId !== record.summary.matchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'manifest.matchId must match summary.matchId',
      path: ['manifest', 'matchId'],
    });
  }

  if (record.manifest.tableId !== record.summary.tableId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'manifest.tableId must match summary.tableId',
      path: ['manifest', 'tableId'],
    });
  }

  const manifestHandIds = record.manifest.handIds;
  const summaryHandIds = record.summary.handIds;
  if (
    manifestHandIds.length !== summaryHandIds.length ||
    manifestHandIds.some((handId, index) => handId !== summaryHandIds[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'manifest.handIds must equal summary.handIds in order',
      path: ['manifest', 'handIds'],
    });
  }

  const handIdsFromSummaries = record.summary.hands.map(hand => hand.handId);
  if (
    summaryHandIds.length !== handIdsFromSummaries.length ||
    summaryHandIds.some((handId, index) => handId !== handIdsFromSummaries[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'summary.handIds must equal summary.hands handIds in order',
      path: ['summary', 'handIds'],
    });
  }

  record.summary.hands.forEach((hand, index) => {
    if (hand.tableId !== record.summary.tableId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'summary hand tableId must match summary.tableId',
        path: ['summary', 'hands', index, 'tableId'],
      });
    }
  });

  const summaryHandIdSet = new Set(summaryHandIds);
  if (record.analysisSummary.matchId !== record.summary.matchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'analysis summary matchId must match summary.matchId',
      path: ['analysisSummary', 'matchId'],
    });
  }

  if (record.analysisSummary.tableId !== record.summary.tableId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'analysis summary tableId must match summary.tableId',
      path: ['analysisSummary', 'tableId'],
    });
  }

  record.replayEvents.forEach((event, index) => {
    if (event.tableId !== record.summary.tableId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'replay event tableId must match summary.tableId',
        path: ['replayEvents', index, 'tableId'],
      });
    }

    if (!summaryHandIdSet.has(event.handId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'replay event handId must be included in summary.handIds',
        path: ['replayEvents', index, 'handId'],
      });
    }
  });

  record.decisionTraces.forEach((trace, index) => {
    if (trace.matchId !== record.summary.matchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'decision trace matchId must match summary.matchId',
        path: ['decisionTraces', index, 'matchId'],
      });
    }

    if (!summaryHandIdSet.has(trace.handId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'decision trace handId must be included in summary.handIds',
        path: ['decisionTraces', index, 'handId'],
      });
    }
  });
});

export const MAX_SIMULATION_HANDS = 20;

export const SimulateRequestSchema = z.object({
  name: z.string().min(1),
  maxSeats: z.number().int().min(2).max(9),
  blindConfig: BlindConfigSchema,
  seed: z.string().optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
  agents: z.array(z.object({
    name: z.string().min(1),
    strategy: z.enum(['random','always-call','always-fold','aggressive']),
    buyIn: z.number().int().positive(),
  })).min(2),
  numHands: z.number().int().positive().max(MAX_SIMULATION_HANDS),
});

export const AddAgentRequestSchema = z.object({
  name: z.string().min(1),
  adapterType: AgentAdapterTypeSchema,
  strategy: z.enum(['random','always-call','always-fold','aggressive']).optional(),
  buyIn: z.number().int().positive(),
  endpoint: z.string().url().optional(),
});

export const CreateTableRequestSchema = z.object({
  name: z.string().min(1),
  maxSeats: z.number().int().min(2).max(9),
  blindConfig: BlindConfigSchema,
  seed: z.string().optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
  maxSpectators: z.number().int().min(0).max(1000).optional(),
});

// ─── Auth (Phase 2 / M3) ─────────────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(40),
});

export const LoginRequestSchema = z.object({
  email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

export const PublicUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
});

// ─── Action submission (Phase 2 / M5) ────────────────────────────────────────

export const SubmitActionRequestSchema = z.object({
  handId: z.string(),
  actionType: ActionTypeSchema,
  amount: z.number().int().nonnegative().optional(),
});

// ─── Lobby + seats + agent configs (Phase 2 / M8 + M9) ──────────────────────

export const TableSummarySchema = z.object({
  tableId: z.string(),
  tableName: z.string(),
  status: z.enum(['preparing', 'in_hand', 'paused', 'completed']),
  seatedCount: z.number().int().nonnegative(),
  maxSeats: z.number().int().min(2).max(9),
  spectatorCount: z.number().int().nonnegative(),
  blinds: BlindConfigSchema,
  canSit: z.boolean(),
  currentHandId: z.string().nullable(),
});

export const SitAsHumanRequestSchema = z.object({
  seatIndex: z.number().int().min(0).max(8),
  buyIn: z.number().int().positive(),
});

export const SitAsAgentRequestSchema = SitAsHumanRequestSchema.extend({
  agentConfigId: z.string().min(1),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isAcceptableEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export const UserAgentConfigPublicSchema = z.object({
  agentConfigId: z.string(),
  agentName: z.string(),
  endpointUrl: z.string(),
  authHeaderName: z.string().nullable(),
  hasAuthHeader: z.boolean(),
  timeoutMs: z.number().int(),
  description: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const CreateUserAgentConfigRequestSchema = z.object({
  agentName: z.string().min(1).max(40),
  endpointUrl: z.string().url().refine(isAcceptableEndpoint, {
    message: 'endpointUrl must be https:// (or http:// for localhost / 127.0.0.1 / ::1)',
  }),
  authHeaderName: z.string().min(1).max(80).nullable(),
  authHeaderValue: z.string().min(1).max(2048).nullable(),
  timeoutMs: z.number().int().min(100).max(30000),
  description: z.string().max(500).nullable(),
});

export const PatchUserAgentConfigRequestSchema =
  CreateUserAgentConfigRequestSchema.partial();

// ─── Realtime / WebSocket (Phase 2 / M7) ─────────────────────────────────────

export const WsClientMessageSchema = z.object({
  topic: z.string().min(1).max(80),
  type: z.enum(['subscribe', 'unsubscribe', 'ping']),
  payload: z.record(z.unknown()).default({}),
});

export const WsServerMessageSchema = z.object({
  topic: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
});
