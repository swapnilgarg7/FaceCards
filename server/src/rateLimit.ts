/**
 * A fixed-window rate limiter, and the room-count backstop behind it.
 *
 * `POST /api/rooms` is the softest target this server has: it is
 * unauthenticated by design (a private table you can invite friends to has
 * nobody to authenticate yet), and every call allocates a real Colyseus room
 * that is pinned in memory for `ROOM_EMPTY_GRACE_MS` whether or not anyone
 * joins it. On the 0.1-CPU free instance that is a handful of curl calls away
 * from taking the table down for everyone actually playing. `GET
 * /api/rooms/:code` is cheaper but not free: it runs `matchMaker.query()`,
 * which walks every live room, so its cost grows with exactly the thing an
 * attacker is inflating.
 *
 * Deliberately in-process and dependency-free. A free Render web service
 * cannot scale horizontally, so there is exactly one of these and no shared
 * store to coordinate with; the moment that stops being true this needs to
 * move to Redis, and the comment on `RateLimiter` says so. Writing it here
 * rather than adding `express-rate-limit` keeps it unit-testable without an
 * HTTP server, which is the same argument `poker/` makes for itself.
 *
 * Fixed window, not a token bucket, on purpose: the failure this is stopping
 * is a flood, and a flood looks identical under both. What differs is that a
 * fixed window is trivially auditable - "six a minute" means six a minute, and
 * a test can say so without modelling drip rates.
 */

/** One caller's activity inside the current window. */
interface Window {
  /** Requests counted since `startedAt`. */
  hits: number;
  /** When this window opened, in ms on the injected clock. */
  startedAt: number;
}

export interface RateLimitResult {
  /** Whether the caller may proceed. */
  allowed: boolean;
  /** Requests left in this window after this one. Zero once blocked. */
  remaining: number;
  /** Whole seconds until the window resets. Suitable for `Retry-After`. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Requests permitted per key per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Clock, injected so tests do not sleep. Defaults to `Date.now`; this
   * deliberately does not use `performance.now`, because a limiter that
   * forgets everything on a process restart is fine and one that disagrees
   * with `Retry-After` about what a second is, is not.
   */
  now?: () => number;
  /**
   * Ceiling on tracked keys, after which the oldest windows are dropped.
   *
   * Without this the map *is* the memory leak: every distinct source address
   * that ever touched the endpoint would be retained forever, which on a
   * 512 MB instance is a slower version of the attack this file exists to
   * stop. Eviction can only ever forgive a caller, never punish one.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  /**
   * key -> current window. Insertion-ordered, which is what makes the eviction
   * below "oldest first" without keeping a second structure: a key's position
   * only changes when its window is replaced, and replacing a window is what
   * makes it new.
   */
  private readonly windows = new Map<string, Window>();

  constructor(options: RateLimiterOptions) {
    if (options.limit < 1) throw new Error("limit must be at least 1");
    if (options.windowMs < 1) throw new Error("windowMs must be at least 1");
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /**
   * Count one request against `key` and say whether it may proceed.
   *
   * Counts the blocked requests too. A caller who keeps hammering a closed
   * window does not get a fresh one early, but they also do not extend their
   * own block past the window - that would turn a shared NAT address into a
   * permanent ban for a household.
   */
  check(key: string): RateLimitResult {
    const now = this.now();
    const existing = this.windows.get(key);

    if (!existing || now - existing.startedAt >= this.windowMs) {
      // A fresh window. Delete first so the re-insert moves this key to the
      // back of the insertion order, which is what the eviction below reads.
      this.windows.delete(key);
      this.windows.set(key, { hits: 1, startedAt: now });
      this.evictIfNeeded();
      return {
        allowed: true,
        remaining: this.limit - 1,
        retryAfterSeconds: 0,
      };
    }

    existing.hits += 1;
    const elapsed = now - existing.startedAt;
    // Ceil, never floor: a `Retry-After: 0` on a window with 400ms left is an
    // invitation to retry into another rejection.
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((this.windowMs - elapsed) / 1000),
    );

    if (existing.hits > this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return {
      allowed: true,
      remaining: this.limit - existing.hits,
      retryAfterSeconds,
    };
  }

  /**
   * Drop one key's window.
   *
   * Only ever forgives. Used where a key has a known end of life rather than
   * an expiry - a session id when its client leaves - so that a client handed
   * a recycled id does not inherit somebody else's spent budget. There is no
   * matching "spend a key's whole budget" and there must not be: a method that
   * could punish a key by name is a method that will one day be called on the
   * wrong one.
   */
  forget(key: string): void {
    this.windows.delete(key);
  }

  /** Forget everything. Tests, and nothing else. */
  reset(): void {
    this.windows.clear();
  }

  /** How many keys are currently tracked. Tests and diagnostics. */
  get size(): number {
    return this.windows.size;
  }

  private evictIfNeeded(): void {
    if (this.windows.size <= this.maxKeys) return;
    // One per insert is enough to hold the ceiling, because the size only ever
    // grows by one at a time.
    const oldest = this.windows.keys().next();
    if (!oldest.done) this.windows.delete(oldest.value);
  }
}

/**
 * The address a request came from, as far as it can be trusted.
 *
 * Express fills `req.ip` from `X-Forwarded-For` only when `trust proxy` is
 * set, and `server/src/index.ts` sets it to exactly one hop because Render
 * puts exactly one proxy in front of us. That number is load-bearing in both
 * directions: too low and every caller shares the proxy's address, so one
 * abusive client rate-limits the entire internet; too high and a client can
 * prepend whatever it likes to `X-Forwarded-For` and mint a fresh identity per
 * request, which is a limiter that does nothing while looking like it works.
 *
 * The fallback is a single shared bucket rather than "allow". An address we
 * cannot determine is the case an attacker would engineer if unlimited access
 * were on the other side of it.
 */
export function clientKey(ip: string | undefined): string {
  return ip && ip.length > 0 ? ip : "unknown";
}
