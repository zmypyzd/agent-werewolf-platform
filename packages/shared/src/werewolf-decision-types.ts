import type { WerewolfBriefing } from './werewolf-briefing.js';
import type {
  WerewolfAction,
  WerewolfPhase,
  WerewolfPlayerId,
  WerewolfPublicState,
  WerewolfPrivateState,
} from './werewolf-types.js';

export interface WerewolfReasoningSummary {
  // 1-line intent, ≤ 200 chars (enforced by the Zod schema in agent-protocol).
  readonly intent: string;
  // Probability the agent thinks this action is correct, in [0, 1].
  readonly confidence: number;
  // Up to 10 short observations (each ≤ 200 chars).
  readonly keyObservations: ReadonlyArray<string>;
}

export interface WerewolfDecisionRequest {
  readonly requestId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly playerId: WerewolfPlayerId;
  readonly phase: WerewolfPhase;
  readonly nightNumber: number;
  readonly dayNumber: number;
  readonly publicState: WerewolfPublicState;
  readonly privateState: WerewolfPrivateState;
  readonly validActions: ReadonlyArray<WerewolfAction>;
  readonly deadlineMs: number;
  // Optional protocol briefing for external HTTP agents (rules summary +
  // output format). Present when the API server has briefing enabled via
  // env (WEREWOLF_BRIEFING_ENABLED). Absent otherwise — local mocks and
  // tests run without it. See packages/shared/src/werewolf-briefing.ts.
  readonly briefing?: WerewolfBriefing;
}

export interface WerewolfDecisionResponse {
  readonly requestId: string;
  readonly agentId: string;
  readonly action: WerewolfAction;
  // Optional public-safe summary. The reducer's `speak` action carries `inner`
  // separately; that field is private and is stripped from public history by
  // getPublicState (Plan 1). Do NOT include private reasoning here.
  readonly reasoningSummary?: WerewolfReasoningSummary;
}
