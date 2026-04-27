// Tiny in-memory rate limiter keyed by IP. Sliding-window-of-one: each key
// gets a counter that resets `windowMs` after the FIRST hit in the current
// window. That's coarser than a true sliding window but cheap and fine for
// /auth/login (the only caller) — the limit only needs to slow brute force.
//
// Why we ship our own instead of @fastify/rate-limit: the M18 install path
// has been brittle in this environment, and the cost is one ~30-line class.

export interface RateLimiterConfig {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    public readonly config: RateLimiterConfig,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.config.windowMs });
      return { ok: true, retryAfterMs: 0 };
    }
    entry.count += 1;
    if (entry.count > this.config.max) {
      return { ok: false, retryAfterMs: entry.resetAt - t };
    }
    return { ok: true, retryAfterMs: 0 };
  }

  // Drops every entry whose window has expired. Cheap; called occasionally.
  prune(): void {
    const t = this.now();
    for (const [k, v] of this.hits) {
      if (v.resetAt <= t) this.hits.delete(k);
    }
  }
}
