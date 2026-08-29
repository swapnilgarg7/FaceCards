import { schema } from "@colyseus/schema";

/**
 * Authoritative room state, and therefore protocol: both ends import this one
 * definition so the shape can never drift between them.
 *
 * Sharing the *shape* of a private field is not the same as sharing its value.
 * `{ view: true }` fields are delivered only to clients whose `StateView`
 * includes that instance (see `server/src/state/view.ts`), and the server is
 * the only side that ever assigns one.
 *
 * `@filter()` / `@filterChildren()` were removed in Colyseus 0.16. If you find
 * a tutorial using them, it predates this.
 *
 * What is deliberately *not* here, and must never be added: the undealt deck,
 * the burn cards, the shuffle seed, and any other player's hole cards. Those
 * live in `server/src/poker/` for the duration of a hand and reach a client
 * only as the two private strings below, or as a `Reveal` the server chose to
 * publish at a showdown.
 */

/** Values of `Player.status`. Mirrors the engine's own seat status. */
export const SeatStatus = {
  /** Seated, but not in the current hand: joined mid-hand, or out of chips. */
  Waiting: "waiting",
  /** In the hand and able to act. */
  Active: "active",
  Folded: "folded",
  AllIn: "allin",
} as const;

export type SeatStatusValue = (typeof SeatStatus)[keyof typeof SeatStatus];

/** Values of `PokerState.phase`. */
export const TablePhase = {
  /** Not enough players with chips. Nothing is dealt. */
  Waiting: "waiting",
  Preflop: "preflop",
  Flop: "flop",
  Turn: "turn",
  River: "river",
  /** Hand decided, chips paid, results on screen before the next deal. */
  Payout: "payout",
} as const;

export type TablePhaseValue = (typeof TablePhase)[keyof typeof TablePhase];

export const Player = schema(
  {
    /** Server-assigned session id. Doubles as the media identity. */
    sessionId: "string",
    /** Sanitised server-side. Never rendered straight from client input. */
    displayName: "string",
    /** Ordered seat index. Fixed for the session (spec section 2). */
    seat: "uint8",
    /** True between a drop and the end of the reconnection window. */
    connected: "boolean",
    /**
     * Chosen archetype id, validated against `AVATARS` server-side. Every
     * client renders this seat's body from it, so an id nobody ships would be
     * a lookup miss on six machines rather than a cosmetic problem.
     */
    avatar: "string",
    /**
     * Asked to be dealt out. Public, because at a real table everyone can see
     * the seat is not in the hand, and because the alternative is six people
     * waiting on a player who already told the server they were away.
     */
    sittingOut: "boolean",

    /** Chips behind. Server-owned; a client-supplied balance is never read. */
    stack: "uint32",
    /** Chips in front of this seat for the current betting round. */
    bet: "uint32",
    /** One of `SeatStatus`. */
    status: "string",
    /**
     * How many face-down cards sit in front of this seat. Everyone can see
     * that you were dealt in; nobody but you can see what.
     */
    cardCount: "uint8",

    /**
     * This player's own two cards, as "As" / "Td" strings, or empty.
     *
     * Two `{ view: true }` scalars rather than one viewed array, because the
     * scalar form is the one the phase-0 spike verified end to end: another
     * client's payload does not contain the field at all. Hold'em deals two
     * cards, so the shape costs nothing.
     *
     * Widening the view that carries these is the single most dangerous edit
     * anyone can make to this project.
     */
    holeCard0: { type: "string", view: true },
    holeCard1: { type: "string", view: true },
  },
  "Player",
);

/**
 * One player's cards, published because they reached a showdown.
 *
 * This is the *only* path by which a card can become public, and it is an
 * explicit server decision taken after the hand is decided. A hand that ends
 * on a fold produces no reveals at all: the winner never has to show.
 */
export const Reveal = schema(
  {
    sessionId: "string",
    seat: "uint8",
    /** The two hole cards. */
    cards: { array: "string" },
    /** The best five of the seven, for highlighting. */
    best: { array: "string" },
    /** "Two Pair, Kings and Fives". */
    description: "string",
    /** Chips this seat won across all pots. Zero for a loser who had to show. */
    won: "uint32",
  },
  "Reveal",
);

/** One pot and who can win it. Side pots appear here in ladder order. */
export const PotEntry = schema(
  {
    amount: "uint32",
    /** Session ids eligible for this pot. */
    eligible: { array: "string" },
  },
  "PotEntry",
);

export const PokerState = schema(
  {
    /** Human-facing room code. Server-generated, never client-chosen. */
    code: "string",
    /** Seated players, keyed by session id. */
    players: { map: Player },

    /** One of `TablePhase`. */
    phase: "string",
    /** Community cards as "As" strings. Never more than the street allows. */
    board: { array: "string" },
    /** Every chip committed this hand, including the current round's bets. */
    pot: "uint32",
    /** Pot ladder. Only populated once a hand is decided. */
    pots: { array: PotEntry },

    /** Highest committed this round. What a caller is matching. */
    currentBet: "uint32",

    /**
     * What the seat on the clock may do, decided by the server.
     *
     * These are public at a real table too: everyone can see what the player
     * in the hot seat owes and how deep they are. Publishing them is what
     * stops the client from re-deriving the min-raise, the effective call
     * against a short all-in, or the reopening rule, none of which it is
     * allowed to own. The action bar renders these and nothing else.
     */
    canCheck: "boolean",
    canRaise: "boolean",
    /** Chips a call costs the seat on the clock, capped at what it can pay. */
    callAmount: "uint32",
    /** Smallest legal raise-to for whoever is on the clock. */
    minRaiseTo: "uint32",
    /** Largest legal raise-to: the acting seat all-in. */
    maxRaiseTo: "uint32",
    /** Seat on the clock, or -1. */
    actingSeat: "int8",
    /**
     * How long the seat on the clock has to decide, in milliseconds, or 0 when
     * nobody is on the clock.
     *
     * A *duration*, not a deadline, and deliberately so: an absolute server
     * timestamp would need the two clocks to agree, and they do not. The
     * client starts its countdown when `turn` changes, which is the moment it
     * learned about this decision, so the worst case is that its bar is a
     * network hop behind rather than wrong by whatever the machine's clock
     * drifted to. The bar is a picture of the server's clock; the server's
     * clock is the one that acts.
     */
    actingMs: "uint32",
    /**
     * Opaque token for the decision currently on the clock.
     *
     * Bumped by the server every time an action is accepted. A client echoes
     * it back with its intent, which is what lets the server tell "fold this
     * hand" from "fold, sent two streets ago and only just arrived". Compare
     * it, never interpret it.
     */
    turn: "uint32",
    /** Seat holding the button, or -1 before the first hand. */
    buttonSeat: "int8",

    smallBlind: "uint32",
    bigBlind: "uint32",
    handNumber: "uint32",

    /** Populated at a showdown, cleared when the next hand is dealt. */
    reveals: { array: Reveal },
    /** One line summarising how the last hand ended. Display only. */
    lastResult: "string",
  },
  "PokerState",
);

export type PlayerInstance = InstanceType<typeof Player>;
export type RevealInstance = InstanceType<typeof Reveal>;
export type PotEntryInstance = InstanceType<typeof PotEntry>;
export type PokerStateInstance = InstanceType<typeof PokerState>;
