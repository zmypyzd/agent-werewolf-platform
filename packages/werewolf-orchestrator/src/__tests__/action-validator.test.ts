import { describe, it, expect } from 'vitest';
import type { WerewolfAction } from '@agent-poker/shared';
import { actionsMatchByShape, validateWerewolfAction } from '../action-validator.js';

describe('actionsMatchByShape', () => {
  it('returns false for different types', () => {
    const a: WerewolfAction = { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' };
    const b: WerewolfAction = { type: 'witch-skip-save' };
    expect(actionsMatchByShape(a, b)).toBe(false);
  });

  it('werewolf-vote matches when voterId + targetId equal', () => {
    expect(
      actionsMatchByShape(
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
      ),
    ).toBe(true);
  });

  it('werewolf-vote rejects mismatched targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
        { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
      ),
    ).toBe(false);
  });

  it('speak matches by playerId only (free text ignored)', () => {
    expect(
      actionsMatchByShape(
        { type: 'speak', playerId: 'p3', inner: 'I am the seer', performance: '冷静', speech: '我查验了 p7 是好人' },
        { type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' },
      ),
    ).toBe(true);
  });

  it('speak rejects mismatched playerId', () => {
    expect(
      actionsMatchByShape(
        { type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' },
        { type: 'speak', playerId: 'p4', inner: '', performance: '', speech: '' },
      ),
    ).toBe(false);
  });

  it('day-vote matches null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: null },
      ),
    ).toBe(true);
  });

  it('day-vote rejects null vs non-null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'day-vote', voterId: 'p1', targetId: null },
        { type: 'day-vote', voterId: 'p1', targetId: 'p2' },
      ),
    ).toBe(false);
  });

  it('hunter-shoot matches null target', () => {
    expect(
      actionsMatchByShape(
        { type: 'hunter-shoot', targetId: null },
        { type: 'hunter-shoot', targetId: null },
      ),
    ).toBe(true);
  });

  it('witch-save matches by targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'witch-save', targetId: 'p4' },
        { type: 'witch-save', targetId: 'p4' },
      ),
    ).toBe(true);
    expect(
      actionsMatchByShape(
        { type: 'witch-save', targetId: 'p4' },
        { type: 'witch-save', targetId: 'p5' },
      ),
    ).toBe(false);
  });

  it('witch-skip-save matches by type', () => {
    expect(
      actionsMatchByShape({ type: 'witch-skip-save' }, { type: 'witch-skip-save' }),
    ).toBe(true);
  });

  it('seer-divine matches by targetId', () => {
    expect(
      actionsMatchByShape(
        { type: 'seer-divine', targetId: 'p7' },
        { type: 'seer-divine', targetId: 'p7' },
      ),
    ).toBe(true);
  });
});

describe('validateWerewolfAction', () => {
  const valid: WerewolfAction[] = [
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p4' },
    { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
  ];

  it('returns valid=true when action is in validActions', () => {
    const result = validateWerewolfAction(
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' },
      valid,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.action).toEqual({ type: 'werewolf-vote', voterId: 'p1', targetId: 'p5' });
    }
  });

  it('returns valid=false when action is not in validActions', () => {
    const result = validateWerewolfAction(
      { type: 'werewolf-vote', voterId: 'p1', targetId: 'p9' },
      valid,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/not in validActions/);
    }
  });

  it('returns valid=false when validActions is empty', () => {
    const result = validateWerewolfAction(
      { type: 'witch-skip-save' },
      [],
    );
    expect(result.valid).toBe(false);
  });

  it('preserves free-text fields when speak matches by shape', () => {
    const result = validateWerewolfAction(
      { type: 'speak', playerId: 'p3', inner: 'thinking...', performance: 'calm', speech: 'I divine p7' },
      [{ type: 'speak', playerId: 'p3', inner: '', performance: '', speech: '' }],
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.action).toEqual({
        type: 'speak',
        playerId: 'p3',
        inner: 'thinking...',
        performance: 'calm',
        speech: 'I divine p7',
      });
    }
  });
});
