import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
} from "@facecards/shared";
import {
  generateRoomCode,
  generateUniqueRoomCode,
  normaliseRoomCode,
} from "./roomCodes.js";

describe("generateRoomCode", () => {
  it("produces a well-formed code", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(ROOM_CODE_PATTERN);
    }
  });

  it("never emits a character a person could misread aloud", () => {
    // The alphabet exists to survive being read over voice chat. If someone
    // widens it back to A-Z0-9, this is the test that should stop them.
    for (const excluded of ["0", "O", "1", "I", "L", "U"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it("does not collapse to a small set of values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateRoomCode());
    // A broken RNG (a constant seed, or a mis-scaled index) shows up here as
    // a handful of repeated codes rather than ~500 distinct ones.
    expect(seen.size).toBeGreaterThan(490);
  });

  it("uses the whole alphabet", () => {
    const used = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      for (const ch of generateRoomCode()) used.add(ch);
    }
    expect(used.size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

describe("generateUniqueRoomCode", () => {
  it("returns the first code that is not taken", async () => {
    const code = await generateUniqueRoomCode(() => false);
    expect(code).toMatch(ROOM_CODE_PATTERN);
  });

  it("retries past collisions", async () => {
    let calls = 0;
    const code = await generateUniqueRoomCode(() => {
      calls += 1;
      return calls <= 3;
    });
    expect(calls).toBe(4);
    expect(code).toMatch(ROOM_CODE_PATTERN);
  });

  it("supports an async collision check", async () => {
    const code = await generateUniqueRoomCode(async () => false);
    expect(code).toMatch(ROOM_CODE_PATTERN);
  });

  it("gives up loudly rather than returning a taken code", async () => {
    await expect(generateUniqueRoomCode(() => true, 3)).rejects.toThrow(
      /3 attempts/,
    );
  });
});

describe("normaliseRoomCode", () => {
  it("accepts a code however it was typed", () => {
    const code = generateRoomCode();
    expect(normaliseRoomCode(code.toLowerCase())).toBe(code);
    expect(normaliseRoomCode(`  ${code}  `)).toBe(code);
    expect(
      normaliseRoomCode(`${code.slice(0, 3)}-${code.slice(3)}`),
    ).toBe(code);
    expect(normaliseRoomCode(`${code.slice(0, 3)} ${code.slice(3)}`)).toBe(code);
  });

  it("rejects anything that is not a code", () => {
    expect(normaliseRoomCode("")).toBeNull();
    expect(normaliseRoomCode("ABC")).toBeNull();
    expect(normaliseRoomCode("ABCDEFG")).toBeNull();
    // Excluded characters must not sneak in through normalisation.
    expect(normaliseRoomCode("ABCDE0")).toBeNull();
    expect(normaliseRoomCode("ABCDEI")).toBeNull();
    expect(normaliseRoomCode("ABC!EF")).toBeNull();
  });

  it("rejects non-strings rather than coercing them", () => {
    // Room codes arrive from HTTP params and join options, so this is the
    // path a hostile client actually takes.
    for (const value of [null, undefined, 123, {}, [], true]) {
      expect(normaliseRoomCode(value)).toBeNull();
    }
  });
});
