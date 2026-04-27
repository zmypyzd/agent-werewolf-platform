import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../rate-limit.js';

describe('RateLimiter', () => {
  it('allows up to max hits, then rejects with retryAfterMs', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 1000, max: 3 }, () => now);
    expect(rl.check('ip-1').ok).toBe(true);
    expect(rl.check('ip-1').ok).toBe(true);
    expect(rl.check('ip-1').ok).toBe(true);
    const blocked = rl.check('ip-1');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it('resets after the window expires', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 500, max: 1 }, () => now);
    expect(rl.check('ip-1').ok).toBe(true);
    expect(rl.check('ip-1').ok).toBe(false);
    now = 1500;
    expect(rl.check('ip-1').ok).toBe(true);
  });

  it('keys are independent', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 1000, max: 1 }, () => now);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(false);
    expect(rl.check('b').ok).toBe(true);
  });

  it('prune drops entries whose window has expired', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 100, max: 10 }, () => now);
    rl.check('a');
    rl.check('b');
    now = 2000;
    rl.prune();
    // After prune, a fresh check on the same key starts a new window.
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(true);
  });
});
