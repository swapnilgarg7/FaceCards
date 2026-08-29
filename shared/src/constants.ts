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

/**
 * Spec section 2 ships 2 to 6 with the architecture ready for 10. The cap was
 * raised to 8 on request: `seatLayout` is parametric and its tests already
 * walked 2..MAX_SEATS_SUPPORTED, so the ring, the camera clamp and the seat
 * spacing all held. What the ring does not decide is the media budget - see
 * `client/src/scene/attention.ts`, where an 8-ring puts two more faces inside
 * the medium cone at rest than a 6-ring does.
 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
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
 * Buy-in bounds, in chips. A cash game, so a seat may re-stake at any time and
 * may top up between hands - but only inside a band, because a table where one
 * seat can put a hundred times the others behind it is not the same game.
 *
 * Twenty big blinds is the shortest stack that can still play back at a raise;
 * two hundred is the deepest anyone at a friendly table wants to be covered
 * for. `MAX_STACK` is the ceiling a top-up may take a seat to, so a winning
 * player cannot keep reloading to stay the biggest stack.
 */
export const MIN_BUY_IN = 20 * BIG_BLIND;
export const MAX_BUY_IN = 200 * BIG_BLIND;
export const MAX_STACK = 400 * BIG_BLIND;

/** What the buy-in dialog offers first. */
export const DEFAULT_BUY_IN = STARTING_STACK;

/**
 * Consecutive timed-out turns before the server sits a seat out.
 *
 * The clock already answers for an absent player, but answering forever is not
 * the same as being at the table: after this many in a row the seat is dealt
 * out until its player says otherwise. Reset by any action the player takes
 * themselves, so thinking slowly three times in a row costs nothing.
 */
export const AUTO_SIT_OUT_TIMEOUTS = 3;

/**
 * The *shortest* time a decided hand's result stays on screen.
 *
 * A floor rather than a duration. The showdown is played out on the client -
 * the run-out flips one card at a time, then each hand that has to show turns
 * over, then the winner is named - and that ceremony is the part of the
 * evening people actually talk over. Nothing may deal on top of it, so even a
 * table where everybody hammers Next round waits this long.
 */
export const PAYOUT_DISPLAY_MS = 6_000;

/**
 * The *longest* a result stays up when nobody asks to move on.
 *
 * The next hand is dealt when every seat still in the game has pressed Next
 * round, which is what makes the showdown last as long as the conversation
 * about it rather than as long as a timer. This is only the backstop for a
 * table that walked away from its laptops: long enough that reading a
 * seven-card showdown out loud never gets cut off, short enough that a
 * forgotten tab does not park the game forever.
 */
export const PAYOUT_MAX_MS = 60_000;

/**
 * Beat between the last player asking for the next round and the deal.
 *
 * Not zero: the button they pressed has to be seen to have done something
 * before the table clears underneath it.
 */
export const NEXT_HAND_BEAT_MS = 450;

/** Pause before dealing once a table first has enough players with chips. */
export const HAND_START_DELAY_MS = 2_000;

/**
 * How long a dropped player keeps their seat, their stack and their own cards.
 *
 * This is the window `allowReconnection()` opens in `PokerRoom.onDrop`, and it
 * is the difference between closing a laptop and being knocked out of the
 * game. Long enough to carry a lid closed on the way to another room, short
 * enough that a table of six is not held hostage by a seat nobody is in.
 *
 * The client SDK reconnects on its own with an exponential backoff, so this
 * also has to outlast that retry ladder or the window would close while the
 * browser was still politely waiting to try again.
 */
export const RECONNECT_GRACE_MS = 60_000;

/**
 * How long a connected player has to act before the server acts for them.
 *
 * The action clock is server-side and authoritative, like everything else that
 * decides anything. The client renders a countdown off `PokerState.actingMs`,
 * but it is a picture of the server's clock, never the clock itself.
 */
export const TURN_TIMEOUT_MS = 30_000;

/**
 * The same clock for a seat whose player is mid-reconnect.
 *
 * Deliberately short. A player who is not there cannot be thinking, and the
 * exit criterion for this phase is that a closed laptop does not stall the
 * table. They keep their seat and their stack for `RECONNECT_GRACE_MS`; what
 * they do not keep is everyone else's evening.
 */
export const DISCONNECTED_TURN_TIMEOUT_MS = 5_000;
