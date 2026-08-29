/**
 * The Texas Hold'em state machine.
 *
 * Pure by construction: no imports outside this directory, no clock, no
 * socket, no randomness of its own. A hand is `startHand()` plus a sequence of
 * `applyAction()` calls, and every intermediate state is inspectable. That is
 * what makes the table-driven tests next door the primary interface to this
 * code rather than a server you have to run.
 *
 * The client never re-implements anything in here. It renders what the room
 * mirrors out of this state and sends intents back.
 *
 * Two rules carry most of the subtlety, and both are load-bearing:
 *
 *  - **What you owe is capped by what an opponent can pay.** `amountToCall`
 *    is computed against the largest stack still live, not against the raw
 *    `currentBet`. This is what makes a big blind who is all-in for less than
 *    the blind work without a special case, and it pairs with the end-of-round
 *    refund so uncalled chips go home.
 *  - **An all-in raise for less than a full raise does not reopen betting.**
 *    That is encoded entirely in `hasActed`: a full raise clears the flag on
 *    everyone else, an under-raise does not. Players who have not acted yet
 *    keep their full rights; players who already acted may only call or fold.
 *    The rule is about *raises*: an opening bet, however small, always reopens,
 *    because nobody has committed to a level there is anything to reopen from.
 */
import { makeDeck, type Card } from "./cards.js";
import { describeHand, evaluate, type HandValue } from "./evaluate.js";
import { buildPots, splitPot, type Contribution, type Pot } from "./pots.js";
import { shuffled, type RandomInt } from "./shuffle.js";

export type Street = "preflop" | "flop" | "turn" | "river";
export type HandPhase = Street | "complete";
export type SeatStatus = "active" | "folded" | "allin";

export interface HandSeat {
  seat: number;
  playerId: string;
  /** Chips behind. Never negative. */
  stack: number;
  /** Chips in front of this seat for the current betting round. */
  committed: number;
  /** Chips this seat has put in across the whole hand. */
  totalCommitted: number;
  hole: Card[];
  status: SeatStatus;
  /**
   * Has this seat acted since the last full bet or raise? The single flag that
   * implements the reopening rule; see the file header.
   */
  hasActed: boolean;
}

export interface ShowdownEntry {
  seat: number;
  hole: Card[];
  /** The best five of the seven. */
  best: Card[];
  description: string;
  score: number;
}

export interface PotAward {
  potIndex: number;
  seat: number;
  amount: number;
}

export interface HandResult {
  pots: Pot[];
  awards: PotAward[];
  /** Empty when the hand ended on a fold: nobody has to show. */
  showdown: ShowdownEntry[];
  /** Payout minus contribution, per seat. Sums to zero. */
  net: Map<number, number>;
}

export interface HandState {
  handNumber: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  /** Keyed by seat index. Only seats dealt into this hand. */
  seats: Map<number, HandSeat>;
  /** Seat indices in clockwise order, ascending. */
  order: number[];
  phase: HandPhase;
  board: Card[];
  /**
   * Undealt cards, plus burns, held here and nowhere else. This never leaves
   * the server in any message, for any reason, including animation.
   */
  deck: Card[];
  burned: Card[];
  /** Highest amount committed this round. What a caller is matching. */
  currentBet: number;
  /** Size of the last full raise. The floor for the next one. */
  lastRaiseSize: number;
  actingSeat: number | null;
  pots: Pot[];
  result: HandResult | null;
}

export interface StartHandOptions {
  players: readonly { seat: number; playerId: string; stack: number }[];
  /** Seat index holding the button. Moved on by `nextButton` between hands. */
  button: number;
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
  randomInt: RandomInt;
}

export type ActionType = "fold" | "check" | "call" | "raise";

export interface Action {
  type: ActionType;
  /**
   * For a raise: the *total* this seat will have committed this round, not
   * the increment. Total-to is what a poker UI shows and what removes the
   * "did they mean raise by or raise to" ambiguity from the wire.
   */
  amount?: number;
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips a call costs. Already clamped to the stack and to opponent reach. */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal raise-to. Equals `maxRaiseTo` when the only raise is all-in. */
  minRaiseTo: number;
  /** All-in. */
  maxRaiseTo: number;
}

export type ActionOutcome = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------- queries

/** Seats that have not folded, in seat order. */
export function contenders(state: HandState): HandSeat[] {
  return state.order
    .map((s) => state.seats.get(s)!)
    .filter((s) => s.status !== "folded");
}

/** Seats that can still put chips in: not folded, not already all-in. */
export function actingSeats(state: HandState): HandSeat[] {
  return state.order
    .map((s) => state.seats.get(s)!)
    .filter((s) => s.status === "active");
}

/** Every chip in the middle, including the current round's bets. */
export function totalPot(state: HandState): number {
  let sum = 0;
  for (const seat of state.seats.values()) sum += seat.totalCommitted;
  return sum;
}

/**
 * What a call costs this seat.
 *
 * Capped by the deepest live opponent, because you cannot be made to call
 * more than anyone is able to pay you. The excess over that cap is refunded
 * when the round closes.
 */
export function amountToCall(state: HandState, seat: number): number {
  const me = state.seats.get(seat);
  if (!me) return 0;

  let reach = 0;
  for (const other of state.seats.values()) {
    if (other.seat === seat || other.status === "folded") continue;
    reach = Math.max(reach, other.committed + other.stack);
  }

  const target = Math.min(state.currentBet, reach);
  return Math.max(0, Math.min(target - me.committed, me.stack));
}

/** Does this seat still owe the table a decision this round? */
function needsToAct(state: HandState, seat: HandSeat): boolean {
  if (seat.status !== "active") return false;
  return amountToCall(state, seat.seat) > 0 || !seat.hasActed;
}

function roundComplete(state: HandState): boolean {
  const active = actingSeats(state);
  // Anyone still owing chips must answer, even if only one player can act:
  // that is the call-or-fold facing an all-in.
  if (active.some((s) => amountToCall(state, s.seat) > 0)) return false;
  // With one player able to act and nothing to call there is no bet to make,
  // so their unexercised option is not a reason to hold the hand open.
  if (active.length >= 2 && active.some((s) => !s.hasActed)) return false;
  return true;
}

export function legalActions(
  state: HandState,
  seat: number,
): LegalActions | null {
  const me = state.seats.get(seat);
  if (!me || state.result || state.actingSeat !== seat) return null;

  const callAmount = amountToCall(state, seat);
  const maxRaiseTo = me.committed + me.stack;
  const someoneCanRespond = actingSeats(state).some((s) => s.seat !== seat);

  const canRaise =
    someoneCanRespond &&
    !me.hasActed &&
    me.stack > callAmount &&
    maxRaiseTo > state.currentBet;

  return {
    seat,
    canFold: true,
    canCheck: callAmount === 0,
    canCall: callAmount > 0,
    callAmount,
    canRaise,
    minRaiseTo: Math.min(state.currentBet + state.lastRaiseSize, maxRaiseTo),
    maxRaiseTo,
  };
}

// ------------------------------------------------------------- transitions

function commitChips(seat: HandSeat, amount: number): void {
  const paid = Math.min(amount, seat.stack);
  seat.stack -= paid;
  seat.committed += paid;
  seat.totalCommitted += paid;
  if (seat.stack === 0 && seat.status === "active") seat.status = "allin";
}

/** Seat indices clockwise from `seat`, exclusive, wrapping once. */
function ringAfter(state: HandState, seat: number): number[] {
  const ring = state.order;
  const at = ring.indexOf(seat);
  const start = at < 0 ? ring.findIndex((s) => s > seat) : at + 1;
  const from = start < 0 ? 0 : start;
  return [...ring.slice(from), ...ring.slice(0, from)];
}

function nextActor(state: HandState, from: number): number | null {
  for (const candidate of ringAfter(state, from)) {
    const seat = state.seats.get(candidate)!;
    if (needsToAct(state, seat)) return candidate;
  }
  return null;
}

/**
 * Return the uncalled portion of a bet to whoever put it in.
 *
 * Run at the close of every betting round, before chips are collected, so pot
 * construction never sees a level only one player reached. Without it a player
 * who bets 100 into a 40-chip stack loses 60 chips into a pot nobody was able
 * to contest.
 *
 * **Only a live seat is ever paid.** A bet cannot be withdrawn by folding: once
 * chips are in front of you they are the pot's, and mucking does not buy them
 * back. The case is not hypothetical - `forfeit()` folds a player who bets and
 * then closes their laptop, and refunding them there would let anyone unbet by
 * leaving, then hand the pot to the next player as if the bet had never
 * happened.
 *
 * The cap is the largest commitment of *any* other seat, folded ones included,
 * because a folded seat's chips still contested the bet up to the point it
 * folded.
 */
function refundUncalled(state: HandState): void {
  const seats = [...state.seats.values()];

  let top: HandSeat | undefined;
  for (const seat of seats) {
    if (seat.status === "folded") continue;
    if (!top || seat.committed > top.committed) top = seat;
  }
  if (!top) return;

  let matched = 0;
  for (const seat of seats) {
    if (seat === top) continue;
    matched = Math.max(matched, seat.committed);
  }
  if (top.committed <= matched) return;

  const excess = top.committed - matched;
  top.stack += excess;
  top.committed -= excess;
  top.totalCommitted -= excess;
  // Getting chips back can un-do an all-in: a player whose over-bet was only
  // partly called still has a stack behind.
  if (top.status === "allin" && top.stack > 0) top.status = "active";
}

function closeRound(state: HandState): void {
  refundUncalled(state);
  for (const seat of state.seats.values()) {
    seat.committed = 0;
    seat.hasActed = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.actingSeat = null;
}

function draw(state: HandState, count: number): Card[] {
  if (state.deck.length < count) throw new Error("deck exhausted");
  return state.deck.splice(0, count);
}

function dealStreet(state: HandState): void {
  // Burn cards change nothing against a cryptographic shuffle, but the deck
  // stub is server-only either way and the rule is the rule.
  state.burned.push(...draw(state, 1));
  if (state.phase === "preflop") {
    state.phase = "flop";
    state.board.push(...draw(state, 3));
  } else if (state.phase === "flop") {
    state.phase = "turn";
    state.board.push(...draw(state, 1));
  } else {
    state.phase = "river";
    state.board.push(...draw(state, 1));
  }
}

function openRound(state: HandState): void {
  // Postflop action starts to the button's left, which for heads-up is the
  // big blind: the same walk gives the correct answer in both cases.
  state.actingSeat = nextActor(state, state.button);
}

function nextStreet(state: HandState): void {
  for (;;) {
    if (state.phase === "river") {
      finish(state);
      return;
    }
    dealStreet(state);
    if (actingSeats(state).length >= 2) {
      openRound(state);
      return;
    }
    // Everyone who can act is all-in or alone. Run the board out; there is
    // no decision left to make on any remaining street.
  }
}

/** Advance the hand after `from` acted (or after the blinds went in). */
function settle(state: HandState, from: number): void {
  if (contenders(state).length <= 1) {
    closeRound(state);
    finish(state);
    return;
  }
  if (roundComplete(state)) {
    closeRound(state);
    nextStreet(state);
    return;
  }
  state.actingSeat = nextActor(state, from);
}

function finish(state: HandState): void {
  const live = contenders(state);
  // Every path here goes through `contenders(state).length <= 1` or a river
  // that still had two live seats, so this cannot fire. It is asserted rather
  // than assumed because the alternative is `Math.max()` of an empty list
  // producing -Infinity and silently paying nobody.
  if (live.length === 0) {
    throw new Error(`hand ${state.handNumber} finished with no live seat`);
  }
  const contributions: Contribution[] = state.order.map((s) => {
    const seat = state.seats.get(s)!;
    return {
      seat: s,
      total: seat.totalCommitted,
      folded: seat.status === "folded",
    };
  });

  // `buildPots` knows who paid, not who is left. A pot whose every contributor
  // folded comes back with nobody eligible for it; the seats still standing
  // contest it, which is also what the fold-out branch below pays out.
  state.pots = buildPots(contributions).map((pot) =>
    pot.eligible.length > 0
      ? pot
      : { amount: pot.amount, eligible: live.map((s) => s.seat) },
  );

  const awards: PotAward[] = [];
  const payouts = new Map<number, number>();
  const add = (seat: number, amount: number) =>
    payouts.set(seat, (payouts.get(seat) ?? 0) + amount);

  const showdown: ShowdownEntry[] = [];

  if (live.length === 1) {
    // Everyone folded. No cards are shown, and none are put on the wire.
    const winner = live[0]!.seat;
    state.pots.forEach((pot, potIndex) => {
      awards.push({ potIndex, seat: winner, amount: pot.amount });
      add(winner, pot.amount);
    });
  } else {
    const values = new Map<number, HandValue>();
    for (const seat of live) {
      values.set(seat.seat, evaluate([...seat.hole, ...state.board]));
    }

    state.pots.forEach((pot, potIndex) => {
      const best = Math.max(...pot.eligible.map((s) => values.get(s)!.score));
      const winners = pot.eligible.filter((s) => values.get(s)!.score === best);
      const split = splitPot(pot.amount, winners, state.button, state.order);
      for (const [seat, amount] of split) {
        awards.push({ potIndex, seat, amount });
        add(seat, amount);
      }
    });

    for (const seat of live) {
      const value = values.get(seat.seat)!;
      showdown.push({
        seat: seat.seat,
        hole: seat.hole.slice(),
        best: value.cards,
        description: describeHand(value),
        score: value.score,
      });
    }
    showdown.sort((a, b) => b.score - a.score);
  }

  const potted = state.pots.reduce((sum, p) => sum + p.amount, 0);
  const paid = [...payouts.values()].reduce((sum, n) => sum + n, 0);
  if (potted !== paid) {
    throw new Error(`payout accounting broken: pots ${potted}, paid ${paid}`);
  }

  const net = new Map<number, number>();
  for (const s of state.order) {
    const seat = state.seats.get(s)!;
    const payout = payouts.get(s) ?? 0;
    seat.stack += payout;
    net.set(s, payout - seat.totalCommitted);
  }

  state.phase = "complete";
  state.actingSeat = null;
  state.result = { pots: state.pots, awards, showdown, net };
}

// ------------------------------------------------------------------ start

/** The next occupied seat clockwise. Called between hands. */
export function nextButton(
  occupiedSeats: readonly number[],
  button: number,
): number {
  const ring = [...occupiedSeats].sort((a, b) => a - b);
  if (ring.length === 0) throw new RangeError("no seats to give the button to");
  return ring.find((s) => s > button) ?? ring[0]!;
}

export function startHand(options: StartHandOptions): HandState {
  const { players, smallBlind, bigBlind, handNumber, randomInt } = options;

  const dealt = [...players]
    .filter((p) => p.stack > 0)
    .sort((a, b) => a.seat - b.seat);

  if (dealt.length < 2) {
    throw new Error("a hand needs at least two players with chips");
  }
  if (new Set(dealt.map((p) => p.seat)).size !== dealt.length) {
    throw new Error("duplicate seat in startHand");
  }
  if (!Number.isInteger(smallBlind) || !Number.isInteger(bigBlind)) {
    throw new RangeError("blinds must be whole chips");
  }
  if (smallBlind <= 0 || bigBlind < smallBlind) {
    throw new RangeError(`nonsensical blinds ${smallBlind}/${bigBlind}`);
  }

  const order = dealt.map((p) => p.seat);
  // A button on a seat that sat out lands on the next live seat rather than
  // wedging the hand.
  const button = order.includes(options.button)
    ? options.button
    : nextButton(order, options.button);

  const state: HandState = {
    handNumber,
    button,
    smallBlind,
    bigBlind,
    seats: new Map(
      dealt.map((p) => [
        p.seat,
        {
          seat: p.seat,
          playerId: p.playerId,
          stack: p.stack,
          committed: 0,
          totalCommitted: 0,
          hole: [],
          status: "active" as SeatStatus,
          hasActed: false,
        },
      ]),
    ),
    order,
    phase: "preflop",
    board: [],
    deck: shuffled(makeDeck(), randomInt),
    burned: [],
    currentBet: 0,
    lastRaiseSize: bigBlind,
    actingSeat: null,
    pots: [],
    result: null,
  };

  // Heads-up inverts the blinds: the button *is* the small blind and acts
  // first preflop, then acts last on every later street. Three-handed and up,
  // the button is neither blind. Getting this backwards is the classic bug,
  // so both arrangements have their own tests.
  const buttonIndex = order.indexOf(button);
  const headsUp = order.length === 2;
  const sbSeat = order[(buttonIndex + (headsUp ? 0 : 1)) % order.length]!;
  const bbSeat = order[(buttonIndex + (headsUp ? 1 : 2)) % order.length]!;

  // One card at a time around the table starting left of the button, as dealt
  // at a real table.
  const dealOrder = ringAfter(state, button);
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) {
      state.seats.get(seat)!.hole.push(...draw(state, 1));
    }
  }

  commitChips(state.seats.get(sbSeat)!, smallBlind);
  commitChips(state.seats.get(bbSeat)!, bigBlind);
  // The amount to match is the full big blind even when the big blind could
  // not cover it. `amountToCall` caps what anyone actually owes.
  state.currentBet = bigBlind;
  state.lastRaiseSize = bigBlind;

  // Preflop action opens to the big blind's left, which heads-up wraps back
  // round to the button. The blinds are live bets, so the big blind still has
  // an option to raise, which falls out of `hasActed` being false.
  settle(state, bbSeat);
  return state;
}

/**
 * Fold a seat because the player abandoned it, not because they chose to.
 *
 * A leaver mid-hand is a state-machine case, not an exception handler: the
 * table has to keep moving whether or not it was their turn. Two rules make it
 * safe to call at any moment:
 *
 *  - A seat that is already all-in is left alone. Its chips are in the pot and
 *    it has no decisions left, so it stays entitled to what it paid for.
 *    "Folding" it would hand its equity to whoever is still typing.
 *  - The clock only moves if the leaver was holding it. Folding out of turn
 *    can end the hand (everyone else is gone) but never skips a player.
 */
export function forfeit(state: HandState, seat: number): void {
  const me = state.seats.get(seat);
  if (!me || state.result || me.status !== "active") return;

  const wasOnTheClock = state.actingSeat === seat;
  me.status = "folded";
  me.hasActed = true;

  if (wasOnTheClock) {
    settle(state, seat);
    return;
  }
  if (contenders(state).length <= 1) {
    closeRound(state);
    finish(state);
  }
}

export function applyAction(
  state: HandState,
  seat: number,
  action: Action,
): ActionOutcome {
  if (state.result) return { ok: false, reason: "hand is over" };
  if (state.actingSeat !== seat) return { ok: false, reason: "not your turn" };

  const me = state.seats.get(seat);
  const legal = legalActions(state, seat);
  if (!me || !legal) return { ok: false, reason: "not in this hand" };

  switch (action.type) {
    case "fold": {
      me.status = "folded";
      me.hasActed = true;
      break;
    }

    case "check": {
      if (!legal.canCheck) {
        return { ok: false, reason: `cannot check facing ${legal.callAmount}` };
      }
      me.hasActed = true;
      break;
    }

    case "call": {
      if (!legal.canCall) return { ok: false, reason: "nothing to call" };
      commitChips(me, legal.callAmount);
      me.hasActed = true;
      break;
    }

    case "raise": {
      const amount = action.amount;
      if (!legal.canRaise) return { ok: false, reason: "cannot raise" };
      if (typeof amount !== "number" || !Number.isInteger(amount)) {
        return { ok: false, reason: "raise needs a whole-chip amount" };
      }
      if (amount < legal.minRaiseTo || amount > legal.maxRaiseTo) {
        return {
          ok: false,
          reason: `raise must be between ${legal.minRaiseTo} and ${legal.maxRaiseTo}`,
        };
      }

      const increment = amount - state.currentBet;
      // Nobody has bet this round yet, so this is an opening bet rather than a
      // raise. There is no level anyone has already committed to, which means
      // there is nothing to reopen: a player who checked behind gets a normal
      // turn when the action comes back, exactly as they would facing a bet of
      // any other size. Without this carve-out an all-in dribble bet of 6 into
      // a 10 big blind would strip the check-raise off everyone who checked,
      // which is not a rule anyone plays by.
      const openingBet = state.currentBet === 0;
      commitChips(me, amount - me.committed);

      if (openingBet || increment >= state.lastRaiseSize) {
        // Everyone else gets their decision back.
        for (const other of state.seats.values()) {
          if (other.seat !== seat && other.status === "active") {
            other.hasActed = false;
          }
        }
      }
      if (increment >= state.lastRaiseSize) {
        // A full bet or raise also sets the floor for the next one. A
        // sub-minimum all-in does not: the next raise is still measured off
        // the last full wager, so an all-in of 6 over a big blind of 10 leaves
        // the minimum raise at 16, not 12.
        state.lastRaiseSize = increment;
      }
      // An all-in raise for less than a full raise falls through both: players
      // who already acted at this level may only call or fold, and the floor
      // is unchanged.

      state.currentBet = amount;
      me.hasActed = true;
      break;
    }

    default:
      return { ok: false, reason: `unknown action ${String(action.type)}` };
  }

  settle(state, seat);
  return { ok: true };
}
