import { describe, it, expect } from 'vitest';
import { createGame } from '../create-game.js';
import { applyAction } from '../apply-action.js';
import { startFirstNight } from '../phases.js';
import { InvalidWerewolfActionError } from '@agent-poker/shared';
import type { WerewolfAction } from '@agent-poker/shared';

// Regression: applyAction's top-level switch (apply-action.ts:30) has no
// `default` arm. The discriminated union `WerewolfAction` covers every
// known type at the TypeScript boundary, but the orchestrator/mailbox
// path eventually feeds the engine values that originated as JSON. The
// Zod schema at the agent-protocol boundary catches malformed payloads,
// but a runtime cast slip (e.g., a future migration or a misbehaving
// custom adapter) would let an unknown action.type through. With no
// default arm, applyAction silently returns `undefined`, which the
// orchestrator then dereferences as `state.phase` and crashes the match
// with a confusing "cannot read property 'phase' of undefined" stack.
//
// The engine should refuse the unknown type with a typed
// InvalidWerewolfActionError so the orchestrator can map it to a
// public 400 INVALID_ACTION rather than a 500 INTERNAL_ERROR.

describe('applyAction — unknown action.type', () => {
  it('throws InvalidWerewolfActionError instead of returning undefined', () => {
    let s = createGame({ gameId: 'g1', seed: 'fuzz-seed' });
    s = startFirstNight(s);

    const bogus = { type: 'banana-vote', voterId: 'p1', targetId: 'p2' } as unknown as WerewolfAction;

    expect(() => applyAction(s, bogus)).toThrowError(InvalidWerewolfActionError);
  });

  it('throws even when state is fresh from createGame (phase=setup)', () => {
    const s = createGame({ gameId: 'g1', seed: 'fuzz-seed-2' });
    const bogus = { type: 'mystery' } as unknown as WerewolfAction;
    expect(() => applyAction(s, bogus)).toThrowError(InvalidWerewolfActionError);
  });
});
