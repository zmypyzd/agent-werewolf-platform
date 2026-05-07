import { z } from 'zod';

// Public character caps for the free-text fields on a speak action. Exported so
// callers (UI, agent SDKs) can surface the limits to humans before submission
// instead of discovering them through a rejected response.
export const WEREWOLF_SPEAK_INNER_MAX = 4000;
export const WEREWOLF_SPEAK_PERFORMANCE_MAX = 500;
export const WEREWOLF_SPEAK_SPEECH_MAX = 2000;

const WerewolfPlayerIdSchema = z.string().min(1);
const WerewolfRoleSchema = z.enum(['werewolf', 'villager', 'seer', 'witch', 'hunter']);
const WerewolfSideSchema = z.enum(['werewolf', 'good']);
const WerewolfPhaseSchema = z.enum([
  'setup',
  'night-werewolf-vote',
  'night-witch',
  'night-seer',
  'night-resolve',
  'day-announce',
  'day-speeches',
  'day-vote',
  'day-resolve',
  'hunter-shoot',
  'game-over',
]);

const WerewolfPlayerPublicSchema = z.object({
  id: WerewolfPlayerIdSchema,
  seatIndex: z.number().int().min(0).max(8),
  name: z.string(),
  alive: z.boolean(),
  revealedRole: WerewolfRoleSchema.nullable(),
});

const SpeechRecordPublicSchema = z.object({
  playerId: WerewolfPlayerIdSchema,
  performance: z.string(),
  speech: z.string(),
});

const DayVoteRecordSchema = z.object({
  votes: z.array(
    z.object({
      voterId: WerewolfPlayerIdSchema,
      targetId: WerewolfPlayerIdSchema.nullable(),
    }),
  ),
  tally: z.record(WerewolfPlayerIdSchema, z.number().int().min(0)),
  banished: WerewolfPlayerIdSchema.nullable(),
  pkRound: z.number().int().min(0).max(3),
  tied: z.boolean(),
});

const WerewolfPublicHistoryEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('death'),
    day: z.number().int().min(0),
    playerId: WerewolfPlayerIdSchema,
    cause: z.enum(['wolf-kill', 'witch-poison', 'banishment', 'hunter-shoot']),
  }),
  z.object({
    type: z.literal('speech'),
    day: z.number().int().min(0),
    record: SpeechRecordPublicSchema,
  }),
  z.object({
    type: z.literal('vote'),
    day: z.number().int().min(0),
    record: DayVoteRecordSchema,
  }),
  z.object({
    type: z.literal('hunter-shoot'),
    shooterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('game-over'),
    winner: WerewolfSideSchema,
  }),
]);

const WerewolfPublicStateSchema = z.object({
  gameId: z.string().min(1),
  phase: WerewolfPhaseSchema,
  nightNumber: z.number().int().min(0),
  dayNumber: z.number().int().min(0),
  players: z.array(WerewolfPlayerPublicSchema),
  history: z.array(WerewolfPublicHistoryEntrySchema),
  winner: WerewolfSideSchema.nullable(),
});

const WitchPotionStateSchema = z.object({
  hasSave: z.boolean(),
  hasPoison: z.boolean(),
});

const WerewolfPrivateStateSchema = z.object({
  selfId: WerewolfPlayerIdSchema,
  selfRole: WerewolfRoleSchema,
  selfSide: WerewolfSideSchema,
  knownAllies: z.array(WerewolfPlayerIdSchema),
  seerKnowledge: z.array(
    z.object({
      targetId: WerewolfPlayerIdSchema,
      side: WerewolfSideSchema,
    }),
  ),
  witchView: z
    .object({
      potions: WitchPotionStateSchema,
      currentNightKillTarget: WerewolfPlayerIdSchema.nullable(),
    })
    .nullable(),
  hunterCanShoot: z.boolean(),
});

const WerewolfActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('werewolf-vote'),
    voterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({
    type: z.literal('witch-save'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({ type: z.literal('witch-skip-save') }),
  z.object({
    type: z.literal('witch-poison'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({ type: z.literal('witch-skip-poison') }),
  z.object({
    type: z.literal('seer-divine'),
    targetId: WerewolfPlayerIdSchema,
  }),
  z.object({
    type: z.literal('speak'),
    playerId: WerewolfPlayerIdSchema,
    // Per-field caps protect the runner / event log / match-summary from
    // adversarial agents that could otherwise emit unbounded strings and
    // exhaust memory. Values picked to comfortably fit a thoughtful 9-AI
    // werewolf game; tighten only with care once Plan 4 measures real usage.
    inner: z.string().max(WEREWOLF_SPEAK_INNER_MAX),
    performance: z.string().max(WEREWOLF_SPEAK_PERFORMANCE_MAX),
    speech: z.string().max(WEREWOLF_SPEAK_SPEECH_MAX),
  }),
  z.object({
    type: z.literal('day-vote'),
    voterId: WerewolfPlayerIdSchema,
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('hunter-shoot'),
    targetId: WerewolfPlayerIdSchema.nullable(),
  }),
]);

// Bounded so a misconfigured server can't push unbounded text into every
// request body and every persisted artifact. The default briefing in
// @agent-poker/shared sits well below these caps; the limits exist as a
// safety net rather than a target.
const WerewolfBriefingSchema = z.object({
  rulesSummary: z.string().max(4000),
  outputFormat: z.string().max(4000),
  docsUrl: z.string().url().max(500).optional(),
});

export const WerewolfDecisionRequestSchema = z.object({
  requestId: z.string().min(1),
  gameId: z.string().min(1),
  agentId: z.string().min(1),
  playerId: WerewolfPlayerIdSchema,
  phase: WerewolfPhaseSchema,
  nightNumber: z.number().int().min(0),
  dayNumber: z.number().int().min(0),
  publicState: WerewolfPublicStateSchema,
  privateState: WerewolfPrivateStateSchema,
  validActions: z.array(WerewolfActionSchema),
  deadlineMs: z.number().int().positive(),
  briefing: WerewolfBriefingSchema.optional(),
});

export const WerewolfReasoningSummarySchema = z.object({
  intent: z.string().max(200),
  confidence: z.number().min(0).max(1),
  keyObservations: z.array(z.string().max(200)).max(10),
});

export const WerewolfDecisionResponseSchema = z.object({
  requestId: z.string().min(1),
  agentId: z.string().min(1),
  action: WerewolfActionSchema,
  reasoningSummary: WerewolfReasoningSummarySchema.optional(),
});

export {
  WerewolfActionSchema,
  WerewolfBriefingSchema,
  WerewolfPhaseSchema,
  WerewolfPlayerIdSchema,
  WerewolfPrivateStateSchema,
  WerewolfPublicStateSchema,
  WerewolfRoleSchema,
  WerewolfSideSchema,
};
