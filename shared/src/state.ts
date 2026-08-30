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
     * This player has said they are ready to play.
     *
     * False from the moment a seat is taken, and the reason a table with two
     * people in it does not immediately deal. Sitting down is not the same
     * act as being ready: somebody who has just arrived is finding their
     * camera, waiting on a friend, or reading the room code out loud, and
     * posting a blind for them is the rudest possible way to say hello.
     *
     * Public, because "who are we still waiting for" is a question the whole
     * table is asking and the only honest answer is the list. Never cleared
     * once set - the gate is on starting, not on every hand - so a running
     * table keeps dealing itself with no round trip. Being dealt out again is
     * `sittingOut`, which is a different thing and says so.
     */
    ready: "boolean",
    /**
     * This player has seen the last hand's showdown and wants the next one.
     *
     * Public, because "who are we waiting for" is the same question the ready
     * gate answers before the first hand, and the only honest answer is the
     * list of names. Cleared at every deal, so it is a statement about one
     * result rather than a standing preference.
     */
    readyNext: "boolean",
    /**
     * Asked to be dealt out. Public, because at a real table everyone can see
     * the seat is not in the hand, and because the alternative is six people
     * waiting on a player who already told the server they were away.
     */
    sittingOut: "boolean",

    /** Chips behind. Server-owned; a client-supplied balance is never read. */
    stack: "uint32",
    /**
     * Every chip this seat has brought to the table, the opening stake
     * included.
     *
     * Public, and deliberately so: at a real table everyone watches everyone
     * else reach for their wallet, and a leaderboard that showed only the
     * stack in front of a seat would call the player who has rebought four
     * times the one who is winning. Stack minus this is the only honest score.
     */
    totalBuyIn: "uint32",
    /**
     * Chips bought while this seat was in a hand, waiting to be pushed across
     * at the end of it.
     *
     * Table stakes: you play a hand with the chips you had when it was dealt,
     * so a buy-in taken mid-hand is held here and applied before the next
     * deal. Public, because everyone can see the chips arrive.
     */
    pendingBuyIn: "uint32",
    /** Hands this seat has been dealt into. Display only. */
    handsPlayed: "uint32",
    /** Hands this seat took at least one chip out of. Display only. */
    handsWon: "uint32",
    /**
     * This seat has to wait for the big blind before it is dealt in again.
     *
     * Set when someone takes a seat at a table already running, comes back
     * from sitting out, or rebuys after busting. Cleared the moment the blind
     * reaches them. It is what stops a seat from stepping in just past the
     * blinds, folding round, and stepping out again before paying any.
     */
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

/**
 * What `HandNote.category` means on the wire.
 *
 * A restatement of the engine's own `HandCategory`, and deliberately a
 * restatement rather than an import: `server/src/poker/` is pure by
 * construction and imports nothing outside itself, which is the property that
 * makes its tests sufficient. So the numbering lives here, where both ends can
 * see it, and `evaluate.test.ts` asserts the two agree - a drift is a failing
 * test rather than a client that quietly starts calling flushes bluffs.
 *
 * -1 is not in the set. It is the "this seat never showed" sentinel, and the
 * distinction is carried by `HandNote.showed` rather than by reading a
 * negative number as a category.
 */
export const HandStrength = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;

export type HandStrengthValue =
  (typeof HandStrength)[keyof typeof HandStrength];

/** `HandNote.category` for a seat that never showed. */
export const NO_HAND_STRENGTH = -1;

/**
 * What happened to one seat in the hand that just ended.
 *
 * The *facts* behind a Poker Moment, and deliberately only the facts: whether
 * a hand was a bluff, a suckout or a cooler is a question about poker, and
 * poker is decided in `server/src/poker/`. The client picks a caption and a
 * treatment from these; it never re-derives one of them from cards.
 *
 * Written only at a payout, cleared at the next deal, and subject to the same
 * rule as everything else here: **nothing in this schema may say anything
 * about a card that is not already public in `reveals`.** `category` and
 * `rivered` are therefore populated only for a seat that actually showed -
 * for everyone else they are -1 and false, which is why `showed` exists as
 * its own field rather than being inferred from a sentinel. A hand won on
 * folds carries no hand-strength signal at all, because "he was bluffing"
 * about cards nobody saw is a leak with a joke on top of it.
 */
export const HandNote = schema(
  {
    seat: "uint8",
    /** Chips this seat won across every pot. Zero for a loser. */
    won: "uint32",
    /** Chips this seat put in across the whole hand. */
    committed: "uint32",
    /** Finished the hand with every chip in the middle. */
    allIn: "boolean",
    /** Finished the hand with nothing behind. */
    busted: "boolean",
    /** Made the last bet or raise of the hand. Public: everyone saw it. */
    aggressor: "boolean",
    /** The largest single call this seat made. Public for the same reason. */
    biggestCall: "uint32",
    /** This seat reached a showdown, so its cards are in `reveals`. */
    showed: "boolean",
    /**
     * `HandCategory` of the hand it showed, or -1 if it never showed.
     *
     * Redundant with `reveals` - the cards are already there - and published
     * anyway, because classifying seven cards into "that was a bluff" is a
     * poker rule and the client is not allowed to own one.
     */
    category: "int8",
    /** Was ahead after the turn and lost on the river. Showdown seats only. */
    rivered: "boolean",
  },
  "HandNote",
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
     * How long the seat on the clock has *left*, in milliseconds, or 0 when
     * nobody is on the clock.
     *
     * A remaining duration, not an absolute deadline, and deliberately so: a
     * server timestamp would need the two machines' clocks to agree, and they
     * do not. The client restarts its countdown whenever this value changes,
     * so the worst case is that its bar runs a network hop behind rather than
     * being wrong by whatever the local clock has drifted to.
     *
     * The server recomputes it from the moment the decision was put on the
     * clock, so it only ever falls. That is what stops a player cycling their
     * connection to buy the acting seat more time - see `turnDeadline` in
     * `server/src/rooms/PokerRoom.ts`. The bar is a picture of the server's
     * clock; the server's clock is the one that acts.
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
    /**
     * Seat that posted the small blind, or -1 for a *dead* small blind.
     *
     * A dead small blind is a real outcome, not an error: when the player who
     * owed it left the table between hands, the blind moves on without them
     * and nobody posts it. Published so the table can say so rather than
     * leaving the pot looking five chips light.
     */
    smallBlindSeat: "int8",
    /** Seat that posted the big blind, or -1 between hands. */
    bigBlindSeat: "int8",

    smallBlind: "uint32",
    bigBlind: "uint32",
    handNumber: "uint32",

    /** Populated at a showdown, cleared when the next hand is dealt. */
    reveals: { array: Reveal },
    /** One line summarising how the last hand ended. Display only. */
    lastResult: "string",
    /**
     * Per-seat facts about the hand that just ended, for Poker Moments.
     *
     * Populated with `reveals` and cleared with them. Display only in the
     * sense that no decision hangs off it - but it is still server-derived,
     * because every question it answers ("was that a bluff", "did the river
     * do it") is a question about poker.
     */
    handNotes: { array: HandNote },
    /**
     * The seat whose bluff got called, or -1.
     *
     * Only ever set for a hand that reached a showdown, so it names a player
     * whose cards the whole table has already seen. On a hand won by everyone
     * folding this stays -1 even when the winner was stone cold bluffing:
     * saying so would publish the strength of two cards nobody paid to see.
     */
    bluffCaughtSeat: "int8",
  },
  "PokerState",
);

export type PlayerInstance = InstanceType<typeof Player>;
export type HandNoteInstance = InstanceType<typeof HandNote>;
export type RevealInstance = InstanceType<typeof Reveal>;
export type PotEntryInstance = InstanceType<typeof PotEntry>;
export type PokerStateInstance = InstanceType<typeof PokerState>;
