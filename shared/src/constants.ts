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

/** Chips every player is staked when they sit down. Fake chips, always. */
export const STARTING_STACK = 1000;

/** Table stakes. Fixed for V1; no blind levels, no tournament structure. */
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;

/**
 * How long the result of a hand stays on screen before the next deal.
 *
 * Long enough to read a showdown and say something about it, which is the
 * whole product. The spec's exit criterion is that the next hand starts with
 * no lobby round-trip, not that it starts instantly.
 */
export const PAYOUT_DISPLAY_MS = 6_000;

/** Pause before dealing once a table first has enough players with chips. */
export const HAND_START_DELAY_MS = 2_000;
