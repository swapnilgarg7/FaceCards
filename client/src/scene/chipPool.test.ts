import { describe, expect, it } from "vitest";
import { assignChips, type ChipInstance, type ChipSlot } from "./chipPool.js";

function slot(
  pile: string,
  denomination: number,
  x: number,
  z = 0,
): ChipSlot {
  return { pile, denomination, x, y: 0.76, z, spin: 0 };
}

function live(chips: (ChipInstance | null)[]) {
  return chips;
}

function at(denomination: number, x: number, z = 0): ChipInstance {
  return { denomination, x, y: 0.76, z };
}

describe("assignChips", () => {
  it("gives every wanted chip an instance on an empty table", () => {
    const slots = [slot("pot", 100, 0), slot("pot", 25, 0.1)];
    const result = assignChips(live([]), slots, 16);
    expect(result.assignments).toHaveLength(2);
    expect(new Set(result.assignments.map((a) => a.instance)).size).toBe(2);
    expect(result.retired).toEqual([]);
  });

  it("keeps a chip's identity as its pile moves, so it slides", () => {
    // One five, bet in front of a seat, then collected into the middle.
    const before = live([at(5, 0.5)]);
    const result = assignChips(before, [slot("pot", 5, 0)], 16);
    expect(result.assignments[0]?.instance).toBe(0);
    expect(result.retired).toEqual([]);
  });

  it("never turns a chip into a different denomination in place", () => {
    const before = live([at(100, 0.5)]);
    const result = assignChips(before, [slot("pot", 5, 0.5)], 16);
    // Instance 0 is a hundred and the wanted chip is a five, so the five is
    // drawn on a fresh instance and the hundred retires.
    expect(result.assignments[0]?.instance).not.toBe(0);
    expect(result.retired).toContain(0);
  });

  it("moves the nearest matching chip rather than an arbitrary one", () => {
    const before = live([at(25, -1), at(25, 0.45), at(25, 2)]);
    const result = assignChips(before, [slot("pot", 25, 0.5)], 16);
    expect(result.assignments[0]?.instance).toBe(1);
    expect(result.retired.sort()).toEqual([0, 2]);
  });

  it("retires the chips a shrinking table no longer needs", () => {
    const before = live([at(100, 0), at(100, 0.05), at(100, 0.1)]);
    const result = assignChips(before, [slot("stack", 100, 0)], 16);
    expect(result.assignments).toHaveLength(1);
    expect(result.retired).toHaveLength(2);
  });

  it("recycles a retired instance once nothing is free", () => {
    // A full pool where one hundred retires and one five appears. The five has
    // to take the hundred's instance, or a table that churns its denominations
    // would run out of chips it is still perfectly able to draw.
    const before = live([at(100, 0), at(5, 1), at(5, 2), at(5, 3)]);
    const slots = [slot("pot", 5, 0), slot("pot", 5, 1), slot("pot", 5, 2), slot("pot", 5, 3)];
    const result = assignChips(before, slots, 4);
    expect(result.assignments).toHaveLength(4);
    expect(new Set(result.assignments.map((a) => a.instance)).size).toBe(4);
    expect(result.retired).toEqual([]);
  });

  it("prefers a genuinely free instance over recycling a live one", () => {
    const before = live([at(100, 0), null]);
    const result = assignChips(before, [slot("pot", 100, 0), slot("pot", 5, 1)], 4);
    const five = result.assignments.find((a) => a.slot.denomination === 5);
    expect(five?.instance).not.toBe(0);
  });

  it("assigns the same way on every client", () => {
    const before = live([at(25, 0.3), at(25, -0.3), at(100, 0)]);
    const slots = [
      slot("pot", 25, 0),
      slot("pot", 25, 0.31),
      slot("pot", 100, 0.6),
    ];
    const a = assignChips(before, slots, 32);
    const b = assignChips(before, slots, 32);
    expect(a).toEqual(b);
  });

  it("breaks an exact tie by index, not by iteration order", () => {
    const before = live([at(5, 0), at(5, 0)]);
    const result = assignChips(before, [slot("pot", 5, 1)], 8);
    expect(result.assignments[0]?.instance).toBe(0);
  });

  it("never hands two chips the same instance", () => {
    const before = live([at(5, 0), at(5, 0.02), at(5, 0.04)]);
    const slots = [
      slot("pot", 5, 0),
      slot("pot", 5, 0.01),
      slot("pot", 5, 0.02),
    ];
    const result = assignChips(before, slots, 8);
    expect(new Set(result.assignments.map((a) => a.instance)).size).toBe(3);
  });

  it("draws what it can and drops the rest at capacity", () => {
    const slots = Array.from({ length: 10 }, (_, i) => slot("pot", 5, i));
    const result = assignChips(live([]), slots, 4);
    expect(result.assignments).toHaveLength(4);
    for (const a of result.assignments) {
      expect(a.instance).toBeLessThan(4);
    }
  });

  it("handles a table that empties completely", () => {
    const before = live([at(5, 0), at(100, 1)]);
    const result = assignChips(before, [], 8);
    expect(result.assignments).toEqual([]);
    expect(result.retired).toEqual([0, 1]);
  });
});
