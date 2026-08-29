/**
 * Why the socket went away, in words a player can act on.
 *
 * Colyseus reports two different families of number through two different
 * callbacks, and both of them arrive as bare integers with an internal string
 * attached. `onError` carries a *matchmaking* code (520-526) lifted out of a
 * `Protocol.ERROR` frame; `onLeave` carries a *WebSocket close* code (1000,
 * 1006, 4000-4010). "seat reservation expired. (524)" is what a player saw the
 * first time this happened, and it tells them nothing at all: not what broke,
 * not whether it was their fault, and not what to do next.
 *
 * The mapping is here rather than inline in `useRoom` because it is a pure
 * function of two numbers and deserves to be read as a table. It is also the
 * one place that knows the difference between a disconnection that is worth
 * explaining and one that is not: leaving on purpose is not an incident.
 *
 * The codes are duplicated as literals rather than imported. Colyseus exports
 * them from `@colyseus/core`, which is a *server* package - reaching for it
 * from the client would pull the matchmaker into the browser bundle to read
 * seven integers off it.
 */

/** `Protocol.ERROR` payload codes, from `@colyseus/shared-types`. */
const MATCHMAKE_NO_HANDLER = 520;
const MATCHMAKE_INVALID_CRITERIA = 521;
const MATCHMAKE_INVALID_ROOM_ID = 522;
const MATCHMAKE_UNHANDLED = 523;
const MATCHMAKE_EXPIRED = 524;
const AUTH_FAILED = 525;
const APPLICATION_ERROR = 526;

/** WebSocket close codes. */
const NORMAL_CLOSURE = 1000;
const ABNORMAL_CLOSURE = 1006;
const CONSENTED = 4000;
const WITH_ERROR = 4002;
const FAILED_TO_RECONNECT = 4003;

/**
 * The table is gone rather than merely unreachable, so rejoining starts a new
 * seat with a new stack. Saying so is the difference between an explanation
 * and an excuse.
 */
const TABLE_GONE =
  "That table is no longer on the server. It closes if the server restarts or" +
  " if everyone leaves, and the chips go with it - rejoining deals you in" +
  " fresh.";

/**
 * A player-facing sentence, or null when the disconnection needs no
 * explanation because it is what the player asked for.
 *
 * @param code    the matchmaking code from `onError`, or the close code from
 *                `onLeave`. The two spaces do not overlap.
 * @param message Colyseus's own string. Never shown as-is; it is only used to
 *                separate cases the code alone cannot.
 */
export function explainDisconnect(
  code: number,
  message?: string,
): string | null {
  switch (code) {
    // The reconnection arrived and there was nothing left to reconnect to:
    // either the room object is gone from the process, or the reconnection
    // window closed before the retry ladder finished. From the browser these
    // are indistinguishable, and for the player they mean the same thing.
    case MATCHMAKE_EXPIRED:
      return TABLE_GONE;

    // The room was never found to begin with. Reachable from a stale invite
    // link, and from a code typed with a lucky-looking typo.
    case MATCHMAKE_INVALID_ROOM_ID:
    case MATCHMAKE_INVALID_CRITERIA:
      return "No table is open on that code. Ask for a fresh invite link.";

    case MATCHMAKE_NO_HANDLER:
    case MATCHMAKE_UNHANDLED:
      return "The server could not open that table. Try again in a moment.";

    case AUTH_FAILED:
      return "The server would not let this browser take a seat.";

    // Anything `onJoin` threw. "Table is full" is the one a player actually
    // meets, and it is worth passing through: it is already a sentence.
    case APPLICATION_ERROR:
      return message?.trim() ? message : "The server refused the seat.";

    // The retry ladder ran out, or the server closed the reconnection. The
    // seat was held for a minute and that minute is up.
    case FAILED_TO_RECONNECT:
      return TABLE_GONE;

    case WITH_ERROR:
      return "The connection to the table failed.";

    // The socket died before the SDK considered the session established, so it
    // never tried to reconnect. Usually a network that dropped within a few
    // seconds of sitting down.
    case ABNORMAL_CLOSURE:
      return "The connection dropped before the table finished loading.";

    // Asked for. `leave()` closes with CONSENTED; a clean server shutdown
    // closes normally. Neither is an incident.
    case CONSENTED:
    case NORMAL_CLOSURE:
      return null;

    default:
      return "The connection to the table closed unexpectedly.";
  }
}

/**
 * One line of evidence for the console.
 *
 * The first time this failure was reported, the only thing anyone had to go on
 * was a screenshot of a string the client had already thrown the code away
 * from. Whatever else changes, the raw pair should survive in a place a person
 * can read it back off.
 */
export function describeDisconnect(
  source: "error" | "leave",
  code: number,
  message?: string,
): string {
  return `[room] ${source} code=${code} reason=${JSON.stringify(message ?? "")}`;
}
