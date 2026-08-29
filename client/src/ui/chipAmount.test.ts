import { describe, expect, it } from "vitest";
import {
  buyInProblemText,
  clampChips,
  formatChips,
  parseChipAmount,
  raiseProblemText,
} from "./chipAmount.js";

const bounds = { min: 200, max: 1480 };

describe("parsing a typed amount", () => {
  it("accepts a whole amount inside the range", () => {
    expect(parseChipAmount("400", bounds)).toEqual({ value: 400, problem: null });
    // Both ends are legal: the minimum raise and the shove are the two amounts
    // most likely to be typed on purpose.
    expect(parseChipAmount("200", bounds).problem).toBeNull();
    expect(parseChipAmount("1480", bounds).problem).toBeNull();
  });

  it("ignores the separators a person types without thinking", () => {
    expect(parseChipAmount("1,480", bounds)).toEqual({ value: 1480, problem: null });
    expect(parseChipAmount(" 400 ", bounds).value).toBe(400);
  });

  it("refuses an amount below the minimum raise", () => {
    // The rule the whole field exists for: the last raise was 100, so 102 is
    // not a raise, and the player is told so before the server has to say it.
    const parsed = parseChipAmount("102", bounds);
    expect(parsed).toEqual({ value: 102, problem: "below-min" });
    expect(raiseProblemText(parsed.problem!, bounds, 100)).toBe(
      "The last raise was 100, so the smallest raise is to 200.",
    );
  });

  it("refuses more chips than the player has", () => {
    expect(parseChipAmount("2000", bounds).problem).toBe("above-max");
  });

  it("keeps the number it read even when it is illegal", () => {
    // The slider beside the field has to stay somewhere sensible while a bad
    // amount is being corrected.
    expect(parseChipAmount("2000", bounds).value).toBe(2000);
    expect(parseChipAmount("1", bounds).value).toBe(1);
  });

  it("calls a fraction a fraction rather than out of range", () => {
    // "Whole chips only" is the useful thing to say about 102.5, even though
    // 102.5 is also below the minimum.
    expect(parseChipAmount("102.5", bounds).problem).toBe("fractional");
    expect(parseChipAmount("400.5", bounds).problem).toBe("fractional");
  });

  it("refuses anything that is not a number at all", () => {
    for (const text of ["abc", "-400", "4e2", "40 0x", "+400", "."]) {
      expect(parseChipAmount(text, bounds).problem, text).toBe("not-a-number");
    }
  });

  it("treats an empty field as unfinished rather than wrong", () => {
    expect(parseChipAmount("", bounds)).toEqual({ value: null, problem: "empty" });
    expect(parseChipAmount("   ", bounds).problem).toBe("empty");
  });
});

describe("clamping", () => {
  it("holds a value inside the bounds", () => {
    expect(clampChips(0, bounds)).toBe(200);
    expect(clampChips(9999, bounds)).toBe(1480);
    expect(clampChips(400, bounds)).toBe(400);
  });

  it("lands on a whole chip", () => {
    expect(clampChips(400.4, bounds)).toBe(400);
  });
});

describe("wording", () => {
  it("names the minimum when there is no previous raise to name", () => {
    expect(raiseProblemText("below-min", bounds)).toBe(
      "The smallest raise is to 200.",
    );
  });

  it("says the same fact about a buy-in in buy-in words", () => {
    expect(buyInProblemText("below-min", { min: 200, max: 4000 })).toBe(
      "The smallest buy-in from here is 200.",
    );
    expect(buyInProblemText("above-max", { min: 200, max: 4000 })).toBe(
      "The most you can add right now is 4,000.",
    );
  });

  it("has something to say about every problem", () => {
    const problems = [
      "empty",
      "not-a-number",
      "fractional",
      "below-min",
      "above-max",
    ] as const;
    for (const problem of problems) {
      expect(raiseProblemText(problem, bounds).length).toBeGreaterThan(0);
      expect(buyInProblemText(problem, bounds).length).toBeGreaterThan(0);
    }
  });

  it("groups every chip count the same way", () => {
    expect(formatChips(1480)).toBe((1480).toLocaleString());
  });
});
