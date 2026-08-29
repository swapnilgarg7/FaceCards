import { describe, expect, it } from "vitest";
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK } from "@facecards/shared";
import {
  CHIP_COLOURS,
  CHIP_THICKNESS,
  DENOMINATIONS,
  MAX_CHIPS_PER_PILE,
  POT_PILES,
  betAnchor,
  chipBreakdown,
  chipValue,
  pileLayout,
  potAnchor,
  splitAcrossPiles,
  stackAnchor,
} from "./chips.js";
import { TABLE, seatLayout } from "./layout.js";

describe("chipBreakdown", () => {
  it("is worth exactly what it draws, at every legal amount", () => {
    // Every amount reachable at these stakes is a multiple of the small blind,
    // and the smallest denomination divides it, so nothing is ever lost.
    for (let amount = 0; amount <= 4000; amount += SMALL_BLIND) {
      expect(chipValue(chipBreakdown(amount))).toBe(amount);
    }
  });

  it("never exceeds the pile cap", () => {
    for (let amount = 0; amount <= 20000; amount += SMALL_BLIND) {
      expect(chipBreakdown(amount).length).toBeLessThanOrEqual(
        MAX_CHIPS_PER_PILE,
      );
    }
  });

  it("draws a starting stack as ten hundreds, not two plaques", () => {
    expect(chipBreakdown(STARTING_STACK)).toEqual(Array(10).fill(100));
  });

  it("uses the biggest chips only once the small ones would not fit", () => {
    expect(chipBreakdown(3000)).toEqual(Array(6).fill(500));
  });

  it("makes change downward", () => {
    expect(chipBreakdown(985)).toEqual([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 25, 25, 25, 5, 5,
    ]);
  });

  it("draws a blind as a single chip and a big blind as two", () => {
    expect(chipBreakdown(SMALL_BLIND)).toEqual([5]);
    expect(chipBreakdown(BIG_BLIND)).toEqual([5, 5]);
  });

  it("draws nothing for nothing", () => {
    expect(chipBreakdown(0)).toEqual([]);
    expect(chipBreakdown(-100)).toEqual([]);
    expect(chipBreakdown(Number.NaN)).toEqual([]);
  });

  it("is descending, so a pile never has a big chip on top of a small one", () => {
    for (let amount = 5; amount <= 5000; amount += 5) {
      const chips = chipBreakdown(amount);
      for (let i = 1; i < chips.length; i++) {
        expect(chips[i]!).toBeLessThanOrEqual(chips[i - 1]!);
      }
    }
  });

  it("truncates rather than towering when an amount is beyond every base", () => {
    const chips = chipBreakdown(1_000_000);
    expect(chips.length).toBe(MAX_CHIPS_PER_PILE);
    expect(chips.every((c) => c === 500)).toBe(true);
  });

  it("has a colour for every denomination", () => {
    for (const denom of DENOMINATIONS) {
      expect(CHIP_COLOURS[denom]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("pileLayout", () => {
  const origin = { x: 0, y: TABLE.topY, z: 0 };

  it("places one chip per denomination handed to it", () => {
    expect(pileLayout(chipBreakdown(1000), origin, 0, 1)).toHaveLength(10);
  });

  it("stacks upward from the felt, never through it", () => {
    for (const chip of pileLayout(chipBreakdown(1000), origin, 0, 1)) {
      expect(chip.y).toBeGreaterThan(TABLE.topY);
      expect(chip.y).toBeLessThan(TABLE.topY + 0.05);
    }
  });

  it("starts a new column rather than one tower", () => {
    const tall = pileLayout(Array(24).fill(100), origin, 0, 1);
    const heights = tall.map((c) => c.y);
    expect(Math.max(...heights) - TABLE.topY).toBeLessThan(
      CHIP_THICKNESS * 9,
    );
    // Three columns of eight, spread sideways.
    const xs = new Set(tall.map((c) => Math.round(c.x * 100)));
    expect(xs.size).toBeGreaterThanOrEqual(3);
  });

  it("is identical on every client for the same pile", () => {
    const a = pileLayout(chipBreakdown(725), origin, 0.4, 99);
    const b = pileLayout(chipBreakdown(725), origin, 0.4, 99);
    expect(a).toEqual(b);
  });

  it("does not lay every chip perfectly square", () => {
    const spins = pileLayout(Array(8).fill(25), origin, 0, 3).map((c) => c.spin);
    expect(new Set(spins.map((s) => Math.round(s * 1000))).size).toBe(8);
  });

  it("spreads along the seat's right, not towards the middle", () => {
    // A row pointing at the pot is indistinguishable from chips on their way
    // into it. Slot 0 sits on +X looking at the origin, so its right is +Z.
    const seat = seatLayout(2)[0]!;
    const chips = pileLayout(Array(16).fill(100), stackAnchor(seat), seat.yaw, 5);
    const spanX = Math.max(...chips.map((c) => c.x)) - Math.min(...chips.map((c) => c.x));
    const spanZ = Math.max(...chips.map((c) => c.z)) - Math.min(...chips.map((c) => c.z));
    expect(spanZ).toBeGreaterThan(spanX * 4);
  });
});

describe("anchors", () => {
  const ring = seatLayout(6);

  it("puts every seat's chips on the felt and inside the rail", () => {
    for (const seat of ring) {
      for (const anchor of [stackAnchor(seat), betAnchor(seat)]) {
        expect(anchor.y).toBe(TABLE.topY);
        expect(Math.hypot(anchor.x, anchor.z)).toBeLessThan(TABLE.radius);
      }
    }
  });

  it("puts a bet nearer the middle than the stack it came from", () => {
    for (const seat of ring) {
      const stack = stackAnchor(seat);
      const bet = betAnchor(seat);
      expect(Math.hypot(bet.x, bet.z)).toBeLessThan(Math.hypot(stack.x, stack.z));
    }
  });

  it("keeps every seat's chips in front of that seat", () => {
    for (const seat of ring) {
      const stack = stackAnchor(seat);
      // Closer to its own seat than to any other.
      const mine = Math.hypot(stack.x - seat.x, stack.z - seat.z);
      for (const other of ring) {
        if (other.index === seat.index) continue;
        expect(mine).toBeLessThan(
          Math.hypot(stack.x - other.x, stack.z - other.z),
        );
      }
    }
  });

  it("rings the pot around the middle, evenly", () => {
    const radii = Array.from({ length: POT_PILES }, (_, i) => {
      const pile = potAnchor(i);
      return Math.hypot(pile.x, pile.z);
    });
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 10);
    // No pile favours a seat: the ring is the same shape from every bearing.
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBe(1);
  });

  it("clears the board row with every pot pile", () => {
    // The board runs along the Z axis through the origin; the piles sit on the
    // diagonals, so none of them lands on a community card.
    for (let i = 0; i < POT_PILES; i++) {
      expect(Math.abs(potAnchor(i).x)).toBeGreaterThan(0.1);
    }
  });

  it("wraps a pile index past the end of the ring", () => {
    expect(potAnchor(POT_PILES)).toEqual(potAnchor(0));
  });
});

describe("splitAcrossPiles", () => {
  it("keeps every chip and keeps the piles level", () => {
    const chips = chipBreakdown(1755);
    const piles = splitAcrossPiles(chips);
    expect(piles.flat().length).toBe(chips.length);
    const sizes = piles.map((p) => p.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("makes empty piles for an empty pot", () => {
    expect(splitAcrossPiles([])).toEqual([[], [], [], []]);
  });
});
