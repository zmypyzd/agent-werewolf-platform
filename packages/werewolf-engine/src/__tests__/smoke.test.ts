import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../index.js';

describe('werewolf-engine smoke', () => {
  it('exports a version constant', () => {
    expect(ENGINE_VERSION).toBe('0.1.0');
  });
});
