import { describe, expect, it } from "vitest";
import {
  MAX_BUY_IN,
  MAX_STACK,
  MIN_BUY_IN,
  maxBuyIn,
  minBuyIn,
} from "@facecards/shared";
import { decideBuyIn } from "./buyIn.js";

const busted = { stack: 0, pending: 0, inHand: false };
const short = { stack: 120, pending: 0, inHand: false };

describe("re-staking a busted seat", () => {
  it("accepts anything inside the band", () => {
    expect(decideBuyIn(MIN_BUY_IN, busted)).toEqual({
      ok: true,
      amount: MIN_BUY_IN,
      immediate: true,
    });
    expect(decideBuyIn(MAX_BUY_IN, busted)).toEqual({
      ok: true,
      amount: MAX_BUY_IN,
      immediate: true,
    });
  });

  it("refuses a stack too short to play a hand with", () => {
    const decision = decideBuyIn(MIN_BUY_IN - 1, busted);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/minimum buy-in/);
  });

  it("refuses to let one seat sit down deeper than the table allows", () => {
    const decision = decideBuyIn(MAX_BUY_IN + 1, busted);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/most you can add/);
  });
});

describe("topping a seat up", () => {
  it("lets a short stack add any whole chip, not just a full buy-in", () => {
    // Someone who is 80 chips off a round number should not have to buy a
    // whole extra stack to get there.
    expect(minBuyIn(short)).toBe(1);
    expect(decideBuyIn(80, short)).toEqual({
      ok: true,
      amount: 80,
      immediate: true,
    });
  });

  it("counts chips already waiting against the ceiling", () => {
    const context = { stack: MAX_STACK - 100, pending: 60, inHand: false };
    expect(maxBuyIn(context)).toBe(40);
    expect(decideBuyIn(41, context).ok).toBe(false);
    expect(decideBuyIn(40, context).ok).toBe(true);
  });

  it("refuses outright once a seat is at the ceiling", () => {
    const full = { stack: MAX_STACK, pending: 0, inHand: false };
    expect(maxBuyIn(full)).toBe(0);
    const decision = decideBuyIn(1, full);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/cannot hold more/);
  });
});

describe("table stakes", () => {
  it("holds chips bought during a hand until the hand is over", () => {
    // The whole point: you cannot cover a bet with money you reached for after
    // seeing the action.
    expect(decideBuyIn(500, { stack: 40, pending: 0, inHand: true })).toEqual({
      ok: true,
      amount: 500,
      immediate: false,
    });
  });

  it("applies them straight away between hands", () => {
    expect(decideBuyIn(500, { stack: 40, pending: 0, inHand: false })).toEqual({
      ok: true,
      amount: 500,
      immediate: true,
    });
  });
});

describe("amounts that are not amounts", () => {
  it("refuses anything that is not a whole positive number of chips", () => {
    for (const bad of [undefined, null, "500", NaN, Infinity, {}, []]) {
      expect(decideBuyIn(bad, busted).ok).toBe(false);
    }
    expect(decideBuyIn(0, busted).ok).toBe(false);
    expect(decideBuyIn(-500, busted).ok).toBe(false);
    expect(decideBuyIn(500.5, busted).ok).toBe(false);
  });
});
