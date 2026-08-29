import { DISPLAY_NAME_MAX_LENGTH } from "@facecards/shared";

const FALLBACK_NAMES = [
  "Ace",
  "Bluff",
  "Chip",
  "Dealer",
  "Flush",
  "Gambit",
  "Highroller",
  "Joker",
];

/**
 * C0 (0x00-0x1F) and C1 (0x7F-0x9F) control characters.
 *
 * Written as code-point comparisons rather than a regex character class so the
 * source file contains no control bytes of its own, and so the ranges are
 * readable without decoding escapes.
 */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * Characters that render as nothing: zero-width spaces and joiners, bidi
 * overrides and isolates, and the byte-order mark.
 */
function isInvisible(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) || // zero-width space .. RLM
    (code >= 0x202a && code <= 0x202e) || // bidi embedding and overrides
    (code >= 0x2066 && code <= 0x2069) || // bidi isolates
    code === 0xfeff // BOM / zero-width no-break space
  );
}

/**
 * Sanitise a client-supplied display name.
 *
 * A display name is the one string a client controls that every other client
 * will render, so it is treated as hostile input: length capped, whitespace
 * collapsed, and an empty result replaced rather than allowed through as "".
 */
export function sanitiseDisplayName(input: unknown, seat: number): string {
  if (typeof input !== "string") return defaultName(seat);

  let stripped = "";
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    // Invisible characters are dropped outright. They render as nothing by
    // design and appear in a display name only to make it read as another
    // player's; substituting a space would hand the same trick another lever.
    if (isInvisible(code)) continue;
    // Controls become a space rather than vanishing. Dropping them welds words
    // together ("a\n\nb" -> "ab"), altering the name instead of cleaning it.
    // It also keeps escape sequences out of the server console.
    stripped += isControl(code) ? " " : char;
  }

  const cleaned = stripped
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    // Slicing at the cap can strand a trailing space.
    .trim();

  return cleaned.length > 0 ? cleaned : defaultName(seat);
}

function defaultName(seat: number): string {
  const base = FALLBACK_NAMES[seat % FALLBACK_NAMES.length] ?? "Player";
  return `${base} ${seat + 1}`;
}
