import { randomInt } from "node:crypto";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
} from "@facecards/shared";

/**
 * Room-code generation. Server-only, and deliberately not `Math.random()`:
 * a room code is the only thing standing between a private table and a
 * stranger, so it is drawn from the CSPRNG like every other secret here.
 *
 * `randomInt(max)` is rejection-sampled inside Node, so the distribution over
 * the alphabet is uniform. A hand-rolled `% alphabet.length` would not be.
 */

/** Draw one uniformly random room code. */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Draw a code that is not already in use.
 *
 * `isTaken` is injected so this stays pure enough to unit-test without a
 * matchmaker. The attempt cap is a guard, not an expectation: with a 30-symbol
 * alphabet over 6 places the space is ~7.3e8, so a collision at our scale is
 * a curiosity rather than a design concern.
 */
export async function generateUniqueRoomCode(
  isTaken: (code: string) => boolean | Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateRoomCode();
    if (!(await isTaken(code))) return code;
  }
  throw new Error(
    `Could not find an unused room code in ${maxAttempts} attempts`,
  );
}

/**
 * Normalise a user-typed code: trim, uppercase, drop separators people add
 * when reading a code aloud ("abc-123" and "ABC 123" are the same table).
 * Returns null if the result is not a well-formed code, so callers get one
 * unambiguous "this is not a code" answer instead of a near-miss string.
 */
export function normaliseRoomCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return ROOM_CODE_PATTERN.test(cleaned) ? cleaned : null;
}
