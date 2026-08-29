import { describe, expect, it } from "vitest";
import { buildPots, splitPot, type Contribution } from "./pots.js";

const c = (seat: number, total: number, folded = false): Contribution => ({
  seat,
  total,
  folded,
});

/** The standing invariant, asserted on every case in this file. */
const totals = (contributions: Contribution[]) =>
  contributions.reduce((sum, x) => sum + x.total, 0);

function pots(contributions: Contribution[]) {
  const built = buildPots(contributions);
  expect(built.reduce((sum, p) => sum + p.amount, 0)).toBe(
    totals(contributions),
  );
  return built;
}

describe("buildPots", () => {
  it("makes one pot when everyone put in the same", () => {
    expect(pots([c(0, 100), c(1, 100), c(2, 100)])).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
    ]);
  });

  it("keeps a folded player's chips in the pot but not their claim on it", () => {
    expect(pots([c(0, 100), c(1, 100, true), c(2, 100)])).toEqual([
      { amount: 300, eligible: [0, 2] },
    ]);
  });

  it("builds a side pot for a short all-in", () => {
    expect(pots([c(0, 200), c(1, 50), c(2, 200)])).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [0, 2] },
    ]);
  });

  it("builds the three-way multi-all-in ladder", () => {
    // The case that kills engines: three all-ins at three stack sizes.
    expect(pots([c(0, 50), c(1, 120), c(2, 300)])).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 140, eligible: [1, 2] },
      { amount: 180, eligible: [2] },
    ]);
  });

  it("collapses consecutive levels that nobody new is eligible for", () => {
    // Five limpers must not produce five identical pots.
    const built = pots([c(0, 10), c(1, 10), c(2, 10), c(3, 10), c(4, 10)]);
    expect(built).toHaveLength(1);
    expect(built[0]).toEqual({ amount: 50, eligible: [0, 1, 2, 3, 4] });
  });

  it("folds dead money down into the pot below it", () => {
    // Seat 2 out-contributed everyone still live and then folded. Their extra
    // chips cannot be won on their own, so they ride with the pot below.
    const built = pots([c(0, 40), c(1, 40), c(2, 100, true)]);
    expect(built).toHaveLength(1);
    expect(built[0]!.amount).toBe(180);
    expect(built[0]!.eligible).toEqual([0, 1]);
  });

  it("ignores seats that put nothing in", () => {
    expect(pots([c(0, 100), c(1, 100), c(2, 0)])).toEqual([
      { amount: 200, eligible: [0, 1] },
    ]);
  });

  it("returns nothing for a hand with no chips in it", () => {
    expect(buildPots([])).toEqual([]);
    expect(buildPots([c(0, 0), c(1, 0)])).toEqual([]);
  });

  it("refuses a negative or fractional contribution", () => {
    expect(() => buildPots([c(0, -5)])).toThrow(/contributed/);
    expect(() => buildPots([c(0, 2.5)])).toThrow(/contributed/);
  });
});

describe("splitPot", () => {
  const seats = [0, 1, 2, 3];

  it("gives the whole pot to a single winner", () => {
    expect([...splitPot(300, [2], 0, seats)]).toEqual([[2, 300]]);
  });

  it("splits evenly when it divides", () => {
    expect([...splitPot(300, [1, 3], 0, seats)]).toEqual([
      [1, 150],
      [3, 150],
    ]);
  });

  it("gives the odd chip to the first winner left of the button", () => {
    // Button on seat 0, so the walk is 1, 2, 3, 0. Seat 1 gets the extra.
    const payouts = splitPot(101, [1, 3], 0, seats);
    expect(payouts.get(1)).toBe(51);
    expect(payouts.get(3)).toBe(50);
  });

  it("moves the odd chip when the button moves", () => {
    // Button on seat 1, so the walk is 2, 3, 0, 1. Seat 3 now gets it.
    const payouts = splitPot(101, [1, 3], 1, seats);
    expect(payouts.get(3)).toBe(51);
    expect(payouts.get(1)).toBe(50);
  });

  it("hands out several odd chips one at a time, never all to one seat", () => {
    const payouts = splitPot(101, [0, 1, 2], 3, seats);
    expect(payouts.get(0)).toBe(34);
    expect(payouts.get(1)).toBe(34);
    expect(payouts.get(2)).toBe(33);
  });

  it("never loses or invents a chip", () => {
    for (let amount = 0; amount < 200; amount++) {
      for (const winners of [[0], [0, 1], [1, 2, 3], [0, 1, 2, 3]]) {
        for (const button of seats) {
          const paid = [...splitPot(amount, winners, button, seats).values()];
          expect(paid.reduce((sum, n) => sum + n, 0)).toBe(amount);
        }
      }
    }
  });

  it("refuses to split a pot with no winner", () => {
    expect(() => splitPot(100, [], 0, seats)).toThrow(/needs a winner/);
  });
});
