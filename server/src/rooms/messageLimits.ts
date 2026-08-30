import { ClientMessage, type ClientMessageType } from "@facecards/shared";
import { RateLimiter } from "../rateLimit.js";

/**
 * A budget per client, per message type, for the socket.
 *
 * `rateLimit.ts` closed the HTTP half of this: `POST /api/rooms` and
 * `GET /api/rooms/:code` are the unauthenticated endpoints an outsider can
 * reach. The socket half was still open, and it is the more interesting one,
 * because it is reachable only by somebody who has *already taken a seat* -
 * which is to say by one of six friends, or by whoever a link ended up being
 * forwarded to. The threat model here is not a botnet. It is one participant,
 * one open console, and a `for` loop.
 *
 * What that loop can do without this file, in order of how much it costs
 * everyone else:
 *
 *  - **`buy-in` is the amplifier.** It cannot be fixed by an equality check
 *    the way `sit-out` and `sit-in` were, because the minimum top-up for a
 *    seat with any chips at all is 1, so `{"amount":1}` in a loop is *accepted
 *    every time* and each acceptance dirties two public `uint32` fields that
 *    fan out to every client at the table.
 *  - **`action` reaches the poker engine on every frame**, in turn or not:
 *    `applyAction` plus `legalActions`, and an `ActionRejected` sent back for
 *    each. That is the "action spam" the phase-6 list names.
 *  - **`request-media-token` mints an HMAC-signed JWT per message.** Signing
 *    is the single most expensive thing this process does per byte received,
 *    and on 0.1 of a CPU that matters.
 *
 * Three decisions.
 *
 * **Per type, not per socket.** One shared bucket would mean a player who
 * bought in six times could not then act, which turns a limiter into a way of
 * freezing somebody out of their own hand. The budgets differ by two orders of
 * magnitude between `action` and `request-media-token`, and averaging them
 * would be either useless or hostile.
 *
 * **Generous enough to be invisible, and it has to be.** Every number below is
 * far above what a person at a poker table produces and far below what a loop
 * does. That gap is wide - a fast human clicks Call maybe twice a second, a
 * loop sends thousands - so there is no need to be clever, and being clever
 * here means one day refusing a real player's real fold.
 *
 * **Silent refusal.** An over-budget message is dropped and nothing is sent
 * back. Answering would hand the flooder an amplifier: one inbound frame
 * becoming one outbound frame is exactly the trade `action` already makes with
 * `ActionRejected`, and it is the reason `action` is on this list at all. The
 * server logs once per client per window instead, which is where the evidence
 * belongs.
 */

export interface MessageLimit {
  limit: number;
  windowMs: number;
}

/**
 * Every client message, with the budget it gets. Exhaustive by type, so adding
 * a message to the protocol without deciding its budget is a compile error
 * rather than a hole.
 */
export const MESSAGE_LIMITS: Record<ClientMessageType, MessageLimit> = {
  /**
   * Thirty a minute is a table where somebody is being very indecisive with
   * their mouse; the engine sees one accepted action per decision and the
   * clock allows thirty seconds per decision, so nothing legitimate comes
   * close. Deliberately not lower: a double-click on Check is two frames, and
   * the `turn` token already makes the second one harmless.
   */
  [ClientMessage.Action]: { limit: 30, windowMs: 10_000 },

  /** Idempotent and one-way. Nobody presses Play more than a handful of times. */
  [ClientMessage.Ready]: { limit: 10, windowMs: 10_000 },

  /** Once per showdown, plus the impatient pressing it again. */
  [ClientMessage.NextHand]: { limit: 15, windowMs: 10_000 },

  /**
   * Both directions of one toggle. Already no-ops when the value is
   * unchanged, so this is the backstop on somebody alternating them.
   */
  [ClientMessage.SitOut]: { limit: 10, windowMs: 10_000 },
  [ClientMessage.SitIn]: { limit: 10, windowMs: 10_000 },

  /**
   * The amplifier, and therefore the tightest of the game messages. A real
   * top-up is one click in a dialog, and a player who has just busted does it
   * once. Ten in ten seconds is already an implausible amount of buying in.
   */
  [ClientMessage.BuyIn]: { limit: 10, windowMs: 10_000 },

  /**
   * The most expensive message per byte, and the rarest. One is sent on join
   * by the server itself; a client asks again only when a token has expired,
   * which is a thing that happens on the order of hours. Six an hour is
   * generous by a wide margin and still refuses a signing loop outright.
   */
  [ClientMessage.RequestMediaToken]: { limit: 6, windowMs: 60_000 },
};

/**
 * The limiters, one per message type, keyed inside by session id.
 *
 * Built on the same `RateLimiter` the HTTP routes use, for the reason that
 * class exists: a fixed window is trivially auditable. "Thirty in ten seconds"
 * means thirty in ten seconds, and a test can say so without modelling drip
 * rates.
 *
 * `maxKeys` is left at its default. Unlike the HTTP limiter, whose keys are
 * addresses from the open internet, every key here is a session id belonging
 * to a client that has a seat - so the map is bounded by the number of seats
 * this process has ever served, and `forget` empties it as people leave.
 */
export class MessageLimiter {
  private readonly limiters: Record<ClientMessageType, RateLimiter>;
  /**
   * Sessions already logged as over budget in their current window, so a
   * flood produces one line rather than one line per frame. Cleared whenever a
   * message from that session is allowed again, which is the cheapest signal
   * that the window has turned over.
   */
  private readonly reported = new Set<string>();

  constructor(now?: () => number) {
    const entries = Object.entries(MESSAGE_LIMITS) as [
      ClientMessageType,
      MessageLimit,
    ][];
    this.limiters = Object.fromEntries(
      entries.map(([type, spec]) => [
        type,
        new RateLimiter({ ...spec, ...(now ? { now } : {}) }),
      ]),
    ) as Record<ClientMessageType, RateLimiter>;
  }

  /**
   * Count one message and say whether the handler should run.
   *
   * Every branch of the room's `onMessage` starts with this, which is the
   * only way it can be true that nothing expensive runs before the budget is
   * checked. A guard placed after a state lookup is a guard that has already
   * paid for the frame it is refusing.
   */
  allow(type: ClientMessageType, sessionId: string): boolean {
    const allowed = this.limiters[type].check(sessionId).allowed;
    if (allowed) this.reported.delete(sessionId);
    return allowed;
  }

  /**
   * Whether this refusal is the first for `sessionId` in its current window.
   *
   * Separate from `allow` so the caller decides what to do with it. Called
   * only after `allow` returns false.
   */
  shouldLog(sessionId: string): boolean {
    if (this.reported.has(sessionId)) return false;
    this.reported.add(sessionId);
    return true;
  }

  /**
   * Drop everything remembered about a session.
   *
   * Called from `onLeave`. Not an optimisation: without it a room that has
   * been sat at all evening accumulates a window per departed session per
   * message type, and - more to the point - a rejoining client that was handed
   * a recycled session id would inherit somebody else's spent budget.
   */
  forget(sessionId: string): void {
    for (const limiter of Object.values(this.limiters)) {
      limiter.forget(sessionId);
    }
    this.reported.delete(sessionId);
  }
}
