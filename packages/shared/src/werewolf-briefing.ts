// Compact briefing handed to external HTTP agents inside every
// WerewolfDecisionRequest when the API server has briefing enabled
// (env: WEREWOLF_BRIEFING_ENABLED). Keeps the agent author from having
// to reverse-engineer the protocol — an LLM-backed agent that already
// passes the request body to its model picks this up as part of the
// prompt with no additional code.
//
// Kept short on purpose. Bigger briefings inflate every request and
// every persisted artifact. The full reference lives in
// docs/werewolf-http-agent-guide.md; agents that need more detail can
// follow the optional docsUrl pointer.

export interface WerewolfBriefing {
  readonly rulesSummary: string;
  readonly outputFormat: string;
  readonly docsUrl?: string;
}

export const WEREWOLF_BRIEFING_RULES_SUMMARY =
  "9-player werewolf. Roles: 3 werewolves, 3 villagers, 1 seer, 1 witch, 1 hunter. " +
  "Sides: 'werewolf' vs 'good'. Wolves win when alive wolves >= alive non-wolves; " +
  "good wins when all wolves are dead. Roles are revealed ONLY at game-over " +
  "(publicState.players[].revealedRole stays null until then; deaths do not flip roles). " +
  "Phases you may be called in: night-werewolf-vote (wolves only), night-witch " +
  "(save then poison sub-steps), night-seer, day-speeches (everyone alive, seat order), " +
  "day-vote, hunter-shoot (only when the dying player is the hunter). The engine " +
  "emits the legal options for this turn in 'validActions' — pick exactly one entry " +
  "that structurally matches.";

export const WEREWOLF_BRIEFING_OUTPUT_FORMAT =
  "Return JSON: { requestId, agentId, action, reasoningSummary? }. Echo 'requestId' " +
  "and 'agentId' from the request unchanged. 'action' MUST be structurally one of " +
  "the entries in 'validActions'. CRITICAL for day-speeches: the speak entry comes " +
  "with empty strings — fill all three fields or your seat appears silent. Caps: " +
  "'inner' (private monologue, never shown to other seats) <= 4000 chars, 'performance' " +
  "(public stage-direction style) <= 500, 'speech' (public, what you say out loud) <= 2000. " +
  "Default speech language: English. Optional 'reasoningSummary' = { intent <= 200, " +
  "confidence in [0,1], keyObservations[<=10 each <= 200] } — no chain-of-thought. " +
  "On failure (timeout, malformed JSON, schema mismatch) the orchestrator substitutes " +
  "validActions[0], which on day-speeches is the empty-string skeleton.";

export interface BuildDefaultWerewolfBriefingOptions {
  readonly docsUrl?: string;
}

export function buildDefaultWerewolfBriefing(
  options: BuildDefaultWerewolfBriefingOptions = {},
): WerewolfBriefing {
  return {
    rulesSummary: WEREWOLF_BRIEFING_RULES_SUMMARY,
    outputFormat: WEREWOLF_BRIEFING_OUTPUT_FORMAT,
    ...(options.docsUrl ? { docsUrl: options.docsUrl } : {}),
  };
}
