/**
 * Constants shared by client and server. Changing a value here changes both
 * ends at once, which is the point: the protocol has exactly one definition.
 */

/** Colyseus room definition name. */
export const ROOM_NAME = "poker" as const;

/**
 * Room-code alphabet. Deliberately excludes 0/O/1/I/L/U so a code read aloud
 * over voice chat cannot be mistyped, and cannot spell anything unfortunate.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789" as const;
export const ROOM_CODE_LENGTH = 6;

/** Matches a normalised (uppercase) room code. */
export const ROOM_CODE_PATTERN = new RegExp(
  `^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);

/** Spec section 2: 2 to 6 players shipping, architecture ready for 10. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MAX_SEATS_SUPPORTED = 10;

/** Display-name limits, enforced server-side. Clients may not exceed these. */
export const DISPLAY_NAME_MAX_LENGTH = 24;

/**
 * How long an empty room stays alive before it disposes. Long enough that
 * refreshing the only open tab rejoins the same room by the same code
 * (phase 0 exit criterion) rather than 404ing.
 */
export const ROOM_EMPTY_GRACE_MS = 60_000;

/** Default local dev ports. Overridable by env on both ends. */
export const DEFAULT_SERVER_PORT = 2567;
export const DEFAULT_CLIENT_PORT = 5173;
