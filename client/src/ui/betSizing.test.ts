import { describe, expect, it } from "vitest";
import {
  chipFace,
  potRaiseTo,
  sizingPresets,
  snapChips,
  trayChips,
  withChip,
  type SizingInput,
} from "./betSizing.js";

function decision(over: Partial<SizingInput> = {}): SizingInput {
  // Heads up at 5/10, preflop, on the small blind: 15 in the middle, 5 to
  // call, and a minimum raise to 20.
  return {
    pot: 15,
    currentBet: 10,
    callAmount: 5,
    bigBlind: 10,
    minRaiseTo: 20,
    maxRaiseTo: 1000,
    ...over,
  };
}

describe("potRaiseTo", () => {
  it("measures the pot after the call, as a card room does", () => {
    // Call the 5, making 20 in the middle, then bet it: raise to 30.
    expect(potRaiseTo(decision(), 1)).toBe(30);
    expect(potRaiseTo(decision(), 0.5)).toBe(20);
  });

  it("bets a fraction of the pot when there is nothing to call", () => {
    const flop = decision({
      pot: 200,
      currentBet: 0,
      callAmount: 0,
      minRaiseTo: 10,
    });
    expect(potRaiseTo(flop, 1)).toBe(200);
    expect(potRaiseTo(flop, 0.5)).toBe(100);
    expect(potRaiseTo(flop, 0.75)).toBe(150);
  });

  it("never leaves the bounds the server published", () => {
    const short = decision({ pot: 4000, maxRaiseTo: 120 });
    expect(potRaiseTo(short, 1)).toBe(120);

    const huge = decision({ pot: 2, currentBet: 0, callAmount: 0 });
    expect(potRaiseTo(huge, 0.5)).toBe(20);
  });

  it("gives a whole number of chips", () => {
    const odd = decision({
      pot: 65,
      currentBet: 0,
      callAmount: 0,
      minRaiseTo: 10,
    });
    expect(potRaiseTo(odd, 0.5)).toBe(33);
    expect(Number.isInteger(potRaiseTo(odd, 0.75))).toBe(true);
  });
});

describe("sizingPresets", () => {
  it("runs from the minimum up to all-in", () => {
    const presets = sizingPresets(
      decision({ pot: 200, currentBet: 0, callAmount: 0 }),
    );
    expect(presets.map((p) => p.label)).toEqual([
      "Min",
      "½ Pot",
      "¾ Pot",
      "Pot",
      "All in",
    ]);
    expect(presets.map((p) => p.amount)).toEqual([20, 100, 150, 200, 1000]);
  });

  it("rises without ever going backwards", () => {
    const amounts = sizingPresets(
      decision({ pot: 340, currentBet: 40, callAmount: 40 }),
    ).map((p) => p.amount);
    const sorted = [...amounts].sort((a, b) => a - b);
    expect(amounts).toEqual(sorted);
  });

  it("drops a fraction that is already the minimum", () => {
    // Preflop, a half-pot raise *is* the min-raise. Two buttons that send the
    // same amount are one button too many.
    const presets = sizingPresets(decision());
    expect(presets.filter((p) => p.amount === 20)).toHaveLength(1);
    expect(presets.map((p) => p.label)).toEqual([
      "Min",
      "¾ Pot",
      "Pot",
      "All in",
    ]);
    expect(presets.map((p) => p.amount)).toEqual([20, 25, 30, 1000]);
  });

  it("drops a fraction that is already all-in", () => {
    const presets = sizingPresets(decision({ pot: 900, maxRaiseTo: 300 }));
    expect(presets.filter((p) => p.amount === 300)).toHaveLength(1);
    expect(presets.at(-1)!.label).toBe("All in");
  });

  it("says all-in and nothing else when that is the only raise", () => {
    expect(sizingPresets(decision({ minRaiseTo: 90, maxRaiseTo: 90 }))).toEqual(
      [{ id: "allIn", label: "All in", amount: 90 }],
    );
  });

  it("offers nothing when there is no legal raise at all", () => {
    expect(
      sizingPresets(decision({ minRaiseTo: 200, maxRaiseTo: 120 })),
    ).toEqual([]);
  });
});

describe("trayChips", () => {
  it("lays the table's own chips out smallest first", () => {
    expect(trayChips(1000)).toEqual([5, 25, 100, 500]);
  });

  it("leaves out chips a short stack cannot push", () => {
    expect(trayChips(60)).toEqual([5, 25]);
  });

  it("keeps the 1 chip out of the tray", () => {
    // It exists to pay the odd chip of a split pot, not to be tapped forty
    // times.
    expect(trayChips(1000)).not.toContain(1);
    expect(trayChips(3)).toEqual([]);
  });
});

describe("withChip", () => {
  it("counts chips out one tap at a time", () => {
    let amount = 0;
    for (let i = 0; i < 5; i++) amount = withChip(amount, 100, 1000);
    expect(amount).toBe(500);
  });

  it("does not push past all-in", () => {
    expect(withChip(900, 500, 1000)).toBe(1000);
  });

  it("does not lift a part-built amount up to the minimum", () => {
    // The first hundred of five is allowed to be an illegal raise: the field
    // says so and the button stays dead until the count is finished.
    expect(withChip(0, 100, 1000)).toBe(100);
  });
});

describe("snapChips", () => {
  it("lands the slider on whole big blinds", () => {
    expect(snapChips(137, decision())).toBe(140);
    expect(snapChips(134, decision())).toBe(130);
  });

  it("still reaches both ends of the range", () => {
    const odd = decision({ minRaiseTo: 23, maxRaiseTo: 617 });
    expect(snapChips(617, odd)).toBe(617);
    expect(snapChips(23, odd)).toBe(23);
  });
});

describe("chipFace", () => {
  it("prints a denomination the way it is stamped on a chip", () => {
    expect(chipFace(5)).toBe("5");
    expect(chipFace(500)).toBe("500");
    expect(chipFace(1000)).toBe("1K");
    expect(chipFace(2500)).toBe("2.5K");
  });
});
