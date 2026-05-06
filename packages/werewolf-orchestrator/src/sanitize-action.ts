import type { WerewolfAction } from '@agent-poker/shared';

// Strip private fields from a WerewolfAction before embedding it in a broadcast
// event payload.
//
// - speak: drop `inner` (心声) — explicitly private per WerewolfPublicHistoryEntry.
// - night-phase actions (werewolf-vote / witch-save / witch-poison / seer-divine):
//   strip all ID fields. The act of taking these actions still leaks the actor's
//   role via the surrounding event envelope (playerId / agentId / phase) — that
//   is the public-event-filter concern handled by Plan 4. This sanitizer is the
//   minimum viable redaction at the action-payload layer.
// - witch-skip-* / day-vote / hunter-shoot: pass-through (skip-* carries no IDs;
//   day-vote and hunter-shoot are already public per the engine's history model).
//
// The return type is `Record<string, unknown>` rather than `WerewolfAction` so
// the redacted shape (e.g. `{ type: 'werewolf-vote' }` without `voterId`/`targetId`)
// does not have to satisfy the original discriminated-union schema.
export function sanitizeActionForBroadcast(
  action: WerewolfAction,
): Record<string, unknown> {
  switch (action.type) {
    case 'speak':
      return {
        type: 'speak',
        playerId: action.playerId,
        inner: action.inner,
        performance: action.performance,
        speech: action.speech,
      };
    case 'werewolf-vote':
    case 'witch-save':
    case 'witch-poison':
    case 'seer-divine':
      return { type: action.type };
    case 'witch-skip-save':
    case 'witch-skip-poison':
      return { type: action.type };
    case 'day-vote':
      return {
        type: 'day-vote',
        voterId: action.voterId,
        targetId: action.targetId,
      };
    case 'hunter-shoot':
      return { type: 'hunter-shoot', targetId: action.targetId };
  }
}
