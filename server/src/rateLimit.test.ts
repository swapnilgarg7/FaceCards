import { describe, expect, it } from "vitest";
import { RateLimiter, clientKey } from "./rateLimit.js";

/** A clock the test drives by hand, so nothing here sleeps. */
function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("allows exactly `limit` requests in a window and refuses the next", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: clock.now,
    });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const third = limiter.check("a");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    expect(limiter.check("a").allowed).toBe(false);
  });

  it("keeps callers in separate buckets", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    // b has spent nothing, and must not inherit a's exhaustion.
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("reopens once the window has fully elapsed", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: clock.now,
    });

    limiter.check("a");
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    clock.advance(59_999);
    expect(limiter.check("a").allowed).toBe(false);

    clock.advance(1);
    expect(limiter.check("a").allowed).toBe(true);
  });

  /**
   * The rule that stops a shared address - an office, a hostel, a phone
   * network - from becoming a permanent ban for everyone behind it. Hammering
   * a closed window must not push its reset further out.
   */
  it("does not extend a block when a blocked caller keeps retrying", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 10_000,
      now: clock.now,
    });

    limiter.check("a");
    for (let i = 0; i < 50; i++) {
      clock.advance(100);
      expect(limiter.check("a").allowed).toBe(false);
    }

    // 5s of hammering happened inside the window; the original window still
    // expires on its own schedule rather than on the last rejected attempt.
    clock.advance(5_000);
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("never reports a retry-after of zero while still blocked", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 10_000,
      now: clock.now,
    });

    limiter.check("a");
    // 400ms left: rounding down would say "retry now", straight into another
    // rejection.
    clock.advance(9_600);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("holds its key ceiling under a flood of distinct addresses", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
      maxKeys: 100,
    });

    for (let i = 0; i < 5_000; i++) limiter.check(`ip-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it("evicts the oldest key rather than the most recent one", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
      maxKeys: 2,
    });

    limiter.check("old");
    limiter.check("mid");
    expect(limiter.check("old").allowed).toBe(false);

    // Pushes the ceiling over, dropping "old" - the least recently opened.
    limiter.check("new");
    expect(limiter.check("old").allowed).toBe(true);
    // "new" was just seen and must still be counted.
    expect(limiter.check("new").allowed).toBe(false);
  });

  it("rejects nonsensical configuration rather than limiting nothing", () => {
    expect(() => new RateLimiter({ limit: 0, windowMs: 1_000 })).toThrow();
    expect(() => new RateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});

describe("clientKey", () => {
  it("passes an address through", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
  });

  /**
   * An unknown address shares one bucket rather than bypassing the limiter.
   * Returning a unique key here would hand a free pass to exactly the caller
   * who managed to hide.
   */
  it("buckets an unknown address together rather than exempting it", () => {
    expect(clientKey(undefined)).toBe(clientKey(""));
    expect(clientKey(undefined)).toBe("unknown");
  });
});
