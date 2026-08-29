import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX_LENGTH } from "@facecards/shared";
import { sanitiseDisplayName } from "./names.js";

/** Built from char codes so the test file itself stays free of control bytes. */
const ch = (code: number) => String.fromCharCode(code);
const NUL = ch(0x00);
const ESC = ch(0x1b);
const TAB = ch(0x09);
const LF = ch(0x0a);
const ZERO_WIDTH_SPACE = ch(0x200b);
const RTL_OVERRIDE = ch(0x202e);

describe("sanitiseDisplayName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitiseDisplayName("Swapnil", 0)).toBe("Swapnil");
  });

  it("substitutes a name when none was given", () => {
    expect(sanitiseDisplayName("", 0)).toBe("Ace 1");
    expect(sanitiseDisplayName("   ", 2)).toBe("Chip 3");
    expect(sanitiseDisplayName(undefined, 1)).toBe("Bluff 2");
  });

  it("never returns an empty string", () => {
    // Each of these sanitises down to nothing. A player rendered as "" is a
    // seat nobody can refer to out loud.
    for (const input of ["", " ", TAB + LF, NUL, ZERO_WIDTH_SPACE]) {
      expect(sanitiseDisplayName(input, 0).length).toBeGreaterThan(0);
    }
  });

  it("caps length", () => {
    const long = "x".repeat(200);
    expect(sanitiseDisplayName(long, 0)).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
  });

  it("collapses whitespace so a name cannot be padded off screen", () => {
    expect(sanitiseDisplayName("a     b", 0)).toBe("a b");
    expect(sanitiseDisplayName("a" + LF + LF + "b", 0)).toBe("a b");
  });

  it("strips control characters and direction overrides", () => {
    // A right-to-left override lets a name render as another player's, which
    // at a poker table is impersonation rather than a cosmetic bug. The escape
    // byte matters too: names reach the server console.
    const cleaned = sanitiseDisplayName(
      "Ali" + RTL_OVERRIDE + "ce" + ESC + "[31m",
      0,
    );
    expect(cleaned).toBe("Alice [31m");
    expect(cleaned).not.toContain(RTL_OVERRIDE);
    expect(cleaned).not.toContain(ESC);
  });

  it("falls back for non-string input", () => {
    for (const value of [null, 42, {}, []]) {
      expect(sanitiseDisplayName(value, 0)).toBe("Ace 1");
    }
  });

  it("gives every seat a distinct fallback name", () => {
    const names = new Set(
      Array.from({ length: 10 }, (_, seat) => sanitiseDisplayName("", seat)),
    );
    expect(names.size).toBe(10);
  });
});
