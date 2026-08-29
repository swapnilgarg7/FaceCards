/**
 * What shape of screen this is, and therefore how much HUD it can carry.
 *
 * Two questions, kept apart on purpose, because they have different answers on
 * real machines and each one drives different decisions:
 *
 * - **compact** is about *room*. A phone has none, and neither does a laptop
 *   with the window dragged to a third of the screen. The standings column,
 *   the self-view and the action bar all have to be laid out differently, and
 *   that is a question about pixels only.
 * - **touch** is about *what the player has in their hands*. No hover, no
 *   keyboard, and a finger instead of a cursor. It is what decides whether the
 *   view follows the pointer or is dragged, whether a key chip is printed on a
 *   button that nobody can press, and whether press-and-hold gestures on the
 *   felt are offered at all.
 *
 * Splitting them matters: a narrow desktop window is compact but not touch, so
 * it keeps every shortcut and keeps hover-look. A tablet is touch but often
 * not compact, so it keeps the standings column and still loses the key chips.
 *
 * `handheld` is the intersection: a small screen with a finger on it, which is
 * the only case where the renderer itself steps down.
 */

/**
 * Below this in *either* dimension there is not enough room for the full HUD.
 * Both are checked because a phone held sideways is wide and very short, and
 * a layout that only asked about width would keep a full-height standings
 * column over a 390px-tall room.
 */
export const COMPACT_MAX_WIDTH = 820;
export const COMPACT_MAX_HEIGHT = 540;

export interface ViewportProfile {
  /** Not enough room for the desktop HUD. Lay it out again, smaller. */
  compact: boolean;
  /** Coarse pointer: no hover, no keyboard, gestures instead of shortcuts. */
  touch: boolean;
  /** Small *and* touched. A phone, and the only case the renderer lightens. */
  handheld: boolean;
}

export interface ViewportInput {
  width: number;
  height: number;
  /** `(pointer: coarse)`. The primary pointing device is a finger. */
  coarsePointer: boolean;
}

export function deviceProfile(input: ViewportInput): ViewportProfile {
  const compact =
    input.width <= COMPACT_MAX_WIDTH || input.height <= COMPACT_MAX_HEIGHT;
  const touch = input.coarsePointer;
  return { compact, touch, handheld: compact && touch };
}

/** Whether two profiles say the same thing, so a resize can be a no-op. */
export function sameProfile(a: ViewportProfile, b: ViewportProfile): boolean {
  return (
    a.compact === b.compact && a.touch === b.touch && a.handheld === b.handheld
  );
}
