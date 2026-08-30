import { describe, expect, it } from "vitest";
import { ClientMessage, type ClientMessageType } from "@facecards/shared";
import { MESSAGE_LIMITS, MessageLimiter } from "./messageLimits.js";

/** A clock a test drives by hand, so nothing here sleeps. */
function clock() {
  let now = 0;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

const ALL_TYPES = Object.values(ClientMessage) as ClientMessageType[];

describe("MESSAGE_LIMITS", () => {
  it("has a budget for every message the protocol defines", () => {
    // The point of the exhaustive Record: adding a message without deciding
    // its budget should be a compile error, and this is the runtime half of
    // the same claim.
    for (const type of ALL_TYPES) {
      expect(MESSAGE_LIMITS[type]).toBeDefined();
    }
    expect(Object.keys(MESSAGE_LIMITS).length).toBe(ALL_TYPES.length);
  });

  it("gives every message a positive budget over a real window", () => {
    for (const type of ALL_TYPES) {
      expect(MESSAGE_LIMITS[type].limit).toBeGreaterThan(0);
      expect(MESSAGE_LIMITS[type].windowMs).toBeGreaterThan(0);
    }
  });

  it("leaves room for a fast but human player on every game message", () => {
    // The gap this file relies on: a person at a table produces single-digit
    // messages per decision, a loop produces thousands. Any budget below about
    // one a second is close enough to human speed to one day refuse a real
    // fold.
    for (const type of ALL_TYPES) {
      if (type === ClientMessage.RequestMediaToken) continue;
      const { limit, windowMs } = MESSAGE_LIMITS[type];
      expect(limit / (windowMs / 1000)).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the token mint far tighter than anything else", () => {
    // Signing an HMAC JWT is the most expensive thing this process does per
    // inbound byte, and a client legitimately asks about once per session.
    const token = MESSAGE_LIMITS[ClientMessage.RequestMediaToken];
    const action = MESSAGE_LIMITS[ClientMessage.Action];
    expect(token.limit / token.windowMs).toBeLessThan(
      action.limit / action.windowMs,
    );
  });
});

describe("MessageLimiter", () => {
  it("allows a budget's worth and then refuses", () => {
    const limiter = new MessageLimiter(clock().now);
    const { limit } = MESSAGE_LIMITS[ClientMessage.Action];
    for (let i = 0; i < limit; i++) {
      expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(true);
    }
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(false);
  });

  it("keeps types apart, so buying in cannot cost you your fold", () => {
    // One shared bucket would turn a limiter into a way of freezing somebody
    // out of their own hand.
    const limiter = new MessageLimiter(clock().now);
    const { limit } = MESSAGE_LIMITS[ClientMessage.BuyIn];
    for (let i = 0; i <= limit + 5; i++) {
      limiter.allow(ClientMessage.BuyIn, "seat-a");
    }
    expect(limiter.allow(ClientMessage.BuyIn, "seat-a")).toBe(false);
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(true);
  });

  it("keeps clients apart, so one flooder cannot mute the table", () => {
    const limiter = new MessageLimiter(clock().now);
    const { limit } = MESSAGE_LIMITS[ClientMessage.Action];
    for (let i = 0; i <= limit + 50; i++) {
      limiter.allow(ClientMessage.Action, "flooder");
    }
    expect(limiter.allow(ClientMessage.Action, "flooder")).toBe(false);
    expect(limiter.allow(ClientMessage.Action, "somebody-else")).toBe(true);
  });

  it("gives the budget back when the window turns over", () => {
    const time = clock();
    const limiter = new MessageLimiter(time.now);
    const { limit, windowMs } = MESSAGE_LIMITS[ClientMessage.BuyIn];
    for (let i = 0; i < limit; i++) limiter.allow(ClientMessage.BuyIn, "seat-a");
    expect(limiter.allow(ClientMessage.BuyIn, "seat-a")).toBe(false);

    // A blocked caller must not extend their own block by hammering: that
    // would turn a shared household address into a permanent ban.
    for (let i = 0; i < 100; i++) limiter.allow(ClientMessage.BuyIn, "seat-a");
    time.advance(windowMs);
    expect(limiter.allow(ClientMessage.BuyIn, "seat-a")).toBe(true);
  });

  it("logs a flood once rather than once a frame", () => {
    const limiter = new MessageLimiter(clock().now);
    const { limit } = MESSAGE_LIMITS[ClientMessage.Action];
    for (let i = 0; i < limit; i++) limiter.allow(ClientMessage.Action, "seat-a");
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(false);
    expect(limiter.shouldLog("seat-a")).toBe(true);
    expect(limiter.shouldLog("seat-a")).toBe(false);
    expect(limiter.shouldLog("seat-a")).toBe(false);
  });

  it("arms the log again once the client is behaving", () => {
    const time = clock();
    const limiter = new MessageLimiter(time.now);
    const { limit, windowMs } = MESSAGE_LIMITS[ClientMessage.Action];
    const flood = () => {
      for (let i = 0; i <= limit; i++) limiter.allow(ClientMessage.Action, "seat-a");
    };

    flood();
    expect(limiter.shouldLog("seat-a")).toBe(true);
    time.advance(windowMs);
    // One allowed message is the cheapest possible signal that the window has
    // turned over.
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(true);
    flood();
    expect(limiter.shouldLog("seat-a")).toBe(true);
  });

  it("forgets a session completely when it leaves", () => {
    const limiter = new MessageLimiter(clock().now);
    const { limit } = MESSAGE_LIMITS[ClientMessage.Action];
    for (let i = 0; i <= limit; i++) limiter.allow(ClientMessage.Action, "seat-a");
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(false);

    // A client handed a recycled session id must not inherit a spent budget.
    limiter.forget("seat-a");
    expect(limiter.allow(ClientMessage.Action, "seat-a")).toBe(true);
    expect(limiter.shouldLog("seat-a")).toBe(true);
  });

  it("passes a whole evening of ordinary play without a single refusal", () => {
    // The real test of the numbers. Sixty hands, eight seats, four decisions
    // each per hand, plus the showdown vote and the occasional top-up.
    const time = clock();
    const limiter = new MessageLimiter(time.now);
    const seats = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let refusals = 0;

    for (let hand = 0; hand < 60; hand++) {
      for (const seat of seats) {
        for (let decision = 0; decision < 4; decision++) {
          if (!limiter.allow(ClientMessage.Action, seat)) refusals += 1;
          // A decision at a real table is seconds, not milliseconds.
          time.advance(3_000);
        }
        if (!limiter.allow(ClientMessage.NextHand, seat)) refusals += 1;
      }
      if (hand % 10 === 0) {
        if (!limiter.allow(ClientMessage.BuyIn, seats[hand % 8]!)) refusals += 1;
      }
    }

    expect(refusals).toBe(0);
  });
});
