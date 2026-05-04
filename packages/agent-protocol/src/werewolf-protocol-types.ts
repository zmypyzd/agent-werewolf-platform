import { z } from 'zod';
import type {
  WerewolfActionSchema,
  WerewolfDecisionRequestSchema,
  WerewolfDecisionResponseSchema,
  WerewolfReasoningSummarySchema,
} from './werewolf-schemas.js';

export type WerewolfActionZod = z.infer<typeof WerewolfActionSchema>;
export type WerewolfDecisionRequestZod = z.infer<typeof WerewolfDecisionRequestSchema>;
export type WerewolfDecisionResponseZod = z.infer<typeof WerewolfDecisionResponseSchema>;
export type WerewolfReasoningSummaryZod = z.infer<typeof WerewolfReasoningSummarySchema>;
