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

  // Regression: prune() exists but had no caller — every unique IP that
  // hit /auth/login left a permanent Map entry, since check() only
  // overwrites the entry for the SAME key when its window expires. A
  // botnet / spoofed-IP-range attack against /auth/login would leak
  // memory linearly with the number of distinct source IPs, eventually
  // OOM-ing the Render free-tier container. check() must invoke prune
  // automatically once the Map grows past the threshold so the
  // memory footprint stays bounded without a periodic timer.
  it('automatically prunes expired entries when Map grows past threshold', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 100, max: 10 }, () => now);
    // Fill the Map past the prune threshold (1000). Each call is one
    // unique key so the Map size grows monotonically.
    // Fill past the PRUNE_THRESHOLD (1024). 1025 entries → next check
    // will see size > 1024 and run inline prune.
    for (let i = 0; i <= 1024; i++) {
      rl.check(`ip-${i}`);
    }
    expect(rl.size()).toBe(1025);

    // Advance time past the window so every existing entry is expired.
    now = now + 1_000;

    // One more check on a fresh key. At entry, Map.size > THRESHOLD →
    // check() runs prune() inline → all 1001 expired entries get dropped.
    // Then the new key is added. Final size should be 1.
    rl.check('ip-fresh');
    expect(rl.size()).toBeLessThanOrEqual(2);
  });

  it('does not prune unexpired entries even when Map grows past threshold', () => {
    let now = 1000;
    const rl = new RateLimiter({ windowMs: 60_000, max: 10 }, () => now);
    // Same as above, but DON'T advance time. The inline prune walks the
    // Map but every entry is still in its window, so nothing is dropped.
    // (Memory still bounded by /auth/login traffic over the window.)
    // Fill past the PRUNE_THRESHOLD (1024). 1025 entries → next check
    // will see size > 1024 and run inline prune.
    for (let i = 0; i <= 1024; i++) {
      rl.check(`ip-${i}`);
    }
    expect(rl.size()).toBe(1025);

    rl.check('ip-fresh');
    // No expired entries to drop; size grows by 1.
    expect(rl.size()).toBe(1026);
  });
});
