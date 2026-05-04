import { z } from 'zod';

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
    inner: z.string(),
    performance: z.string(),
    speech: z.string(),
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
  WerewolfPhaseSchema,
  WerewolfPlayerIdSchema,
  WerewolfPrivateStateSchema,
  WerewolfPublicStateSchema,
  WerewolfRoleSchema,
  WerewolfSideSchema,
};
