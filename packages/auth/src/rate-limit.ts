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

  // Inline prune is triggered once the Map grows past this size. Without it,
  // every unique IP that hits a rate-limited route (currently /auth/login)
  // would leave a permanent entry — check() only overwrites the entry for
  // the SAME key when its window expires, so a flood from many distinct
  // source IPs leaks memory linearly. 1024 covers organic burst traffic
  // comfortably for /auth/login while still kicking in well before any
  // botnet-scale flood could OOM the API container (Render free tier has
  // a tight RAM ceiling).
  private static readonly PRUNE_THRESHOLD = 1024;

  constructor(
    public readonly config: RateLimiterConfig,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    // Bounded maintenance: when the Map has grown past the threshold,
    // drop expired entries before the check logic runs. Amortized O(1)
    // per call because prune walks O(hits.size) at most once every
    // PRUNE_THRESHOLD new keys.
    if (this.hits.size > RateLimiter.PRUNE_THRESHOLD) {
      this.prune();
    }
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

  // Drops every entry whose window has expired. Cheap; called inline by
  // check() once the Map grows past PRUNE_THRESHOLD, and still exposed
  // publicly so a host process can prune on its own cadence (e.g. via a
  // periodic timer) if it prefers steady-state rather than threshold-driven
  // cleanup.
  prune(): void {
    const t = this.now();
    for (const [k, v] of this.hits) {
      if (v.resetAt <= t) this.hits.delete(k);
    }
  }

  // Read-only Map size. Tests use this to assert the inline prune is
  // bounded; production callers do not depend on it.
  size(): number {
    return this.hits.size;
  }
}
