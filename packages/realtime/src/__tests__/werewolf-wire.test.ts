import { describe, expect, it } from 'vitest';
import { werewolfMatchTopic, werewolfPlayerTopic } from '../wire.js';

describe('werewolf wire helpers', () => {
  it('werewolfMatchTopic returns "match:<gameId>"', () => {
    expect(werewolfMatchTopic('g-1')).toBe('match:g-1');
  });

  it('werewolfPlayerTopic returns "player:<userId>:<gameId>"', () => {
    expect(werewolfPlayerTopic('u-7', 'g-1')).toBe('player:u-7:g-1');
  });

  it('player topic round-trips: split by ":" yields exactly userId and gameId', () => {
    const t = werewolfPlayerTopic('user-uuid', 'game-uuid');
    const parts = t.split(':');
    expect(parts[0]).toBe('player');
    expect(parts[1]).toBe('user-uuid');
    expect(parts[2]).toBe('game-uuid');
  });
});
