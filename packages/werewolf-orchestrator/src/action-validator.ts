import type { WerewolfAction } from '@agent-poker/shared';

export function actionsMatchByShape(a: WerewolfAction, b: WerewolfAction): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'werewolf-vote': {
      const bb = b as Extract<WerewolfAction, { type: 'werewolf-vote' }>;
      return a.voterId === bb.voterId && a.targetId === bb.targetId;
    }
    case 'witch-save':
    case 'witch-poison': {
      const bb = b as Extract<WerewolfAction, { type: 'witch-save' | 'witch-poison' }>;
      return a.targetId === bb.targetId;
    }
    case 'witch-skip-save':
    case 'witch-skip-poison':
      return true;
    case 'seer-divine': {
      const bb = b as Extract<WerewolfAction, { type: 'seer-divine' }>;
      return a.targetId === bb.targetId;
    }
    case 'speak': {
      // Free text (inner / performance / speech) intentionally ignored. The
      // engine accepts whatever the agent produces; we only care that the
      // speaker is allowed to speak right now.
      const bb = b as Extract<WerewolfAction, { type: 'speak' }>;
      return a.playerId === bb.playerId;
    }
    case 'day-vote': {
      const bb = b as Extract<WerewolfAction, { type: 'day-vote' }>;
      return a.voterId === bb.voterId && a.targetId === bb.targetId;
    }
    case 'hunter-shoot': {
      const bb = b as Extract<WerewolfAction, { type: 'hunter-shoot' }>;
      return a.targetId === bb.targetId;
    }
    default: {
      // Exhaustiveness guard. If WerewolfAction gains a new variant and this
      // switch is not updated, `_exhaustive: never = a` becomes a compile error.
      const _exhaustive: never = a;
      throw new Error(
        `actionsMatchByShape: unhandled action type ${(a as { type: string }).type} (${_exhaustive as never})`,
      );
    }
  }
}

export type ActionValidationResult =
  | { readonly valid: true; readonly action: WerewolfAction }
  | { readonly valid: false; readonly reason: string };

export function validateWerewolfAction(
  action: WerewolfAction,
  validActions: ReadonlyArray<WerewolfAction>,
): ActionValidationResult {
  const matched = validActions.some((v) => actionsMatchByShape(action, v));
  if (!matched) {
    // Reason text is broadcast to spectators via the agent.invalid_action
    // event's `reason` field. The action payload itself is sanitized
    // separately by sanitizeActionForBroadcast (the broadcast `received`
    // field), but the `reason` string flows through unchanged. Embedding
    // JSON.stringify(action) here leaked the full payload including
    // night-action IDs (werewolf-vote.voterId, witch-poison.targetId,
    // seer-divine.targetId) — a public SSE spectator could then identify
    // wolves by parsing the reason of any malformed wolf vote. Use only
    // action.type, which is also already public via `received` after
    // night-redaction. validActions length stays for debug context.
    return {
      valid: false,
      reason: `Action of type "${action.type}" not in validActions (${validActions.length} options)`,
    };
  }
  return { valid: true, action };
}
