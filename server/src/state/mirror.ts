import {
  PotEntry,
  Reveal,
  SeatStatus,
  TablePhase,
  type PlayerInstance,
  type PokerStateInstance,
} from "@facecards/shared";
import {
  cardToString,
  legalActions,
  totalPot,
  type HandState,
} from "../poker/index.js";

/**
 * Engine state to wire state, in one direction only.
 *
 * The poker engine is the sole owner of a hand in flight; the schema is a
 * projection of it. Nothing reads a game value back out of the schema, which
 * is what makes "the server is authoritative" a structural property rather
 * than a habit.
 *
 * The list of fields written here is also the list of things a client can
 * possibly learn. `HandState.deck`, `HandState.burned` and every seat's `hole`
 * except the viewer's own are absent by construction: there is no line below
 * that could put them on the wire.
 */

/** Seat index used for "nobody", since `uint8` has no room for null. */
export const NO_SEAT = -1;

export type PlayersBySeat = ReadonlyMap<number, PlayerInstance>;

/**
 * The player sitting in this engine seat, *if it is still the same person*.
 *
 * A seat index alone is not an identity. A player can leave mid-hand and a new
 * one can take the freed index while the old `HandSeat` is still contesting
 * the pot, at which point `players.get(seat)` returns a stranger. Writing
 * through that lookup would pay the departed player's stack, status and - once
 * phase 3 restores cards on reconnect - their hole cards to whoever sat down
 * after them.
 *
 * `PokerRoom.handleAction` already checks `playerId` on the read side. This is
 * the same check on the write side, which is the side that can hand out chips.
 */
function seatedPlayer(
  players: PlayersBySeat,
  seat: { seat: number; playerId: string },
): PlayerInstance | undefined {
  const player = players.get(seat.seat);
  return player && player.sessionId === seat.playerId ? player : undefined;
}

/** Everything a hand writes, reset to its between-hands value. */
export function clearHand(state: PokerStateInstance, players: PlayersBySeat) {
  state.phase = TablePhase.Waiting;
  state.board.clear();
  state.pots.clear();
  state.pot = 0;
  state.currentBet = 0;
  state.canCheck = false;
  state.canRaise = false;
  state.callAmount = 0;
  state.minRaiseTo = 0;
  state.maxRaiseTo = 0;
  state.actingSeat = NO_SEAT;
  state.smallBlindSeat = NO_SEAT;
  state.bigBlindSeat = NO_SEAT;

  for (const player of players.values()) {
    player.bet = 0;
    player.cardCount = 0;
    // A vote about the hand that just finished, not a standing preference.
    player.readyNext = false;
    // Cards go back in the box before the next deal, not when the next deal
    // happens. A stale card surviving into the following hand would be a leak
    // of the previous one.
    player.holeCard0 = "";
    player.holeCard1 = "";
    player.status = SeatStatus.Waiting;
  }
}

/** Drop last hand's showdown once the next one is under way. */
export function clearResult(state: PokerStateInstance) {
  state.reveals.clear();
  state.pots.clear();
  state.lastResult = "";
}

/**
 * Deal this client's own two cards into its private fields.
 *
 * Called once per hand, at the deal. The fields are `{ view: true }`, so the
 * write lands in exactly one client's payload; see `state/view.ts`.
 */
export function mirrorHoleCards(hand: HandState, players: PlayersBySeat) {
  for (const seat of hand.seats.values()) {
    const player = seatedPlayer(players, seat);
    if (!player) continue;
    player.holeCard0 = seat.hole[0] === undefined ? "" : cardToString(seat.hole[0]);
    player.holeCard1 = seat.hole[1] === undefined ? "" : cardToString(seat.hole[1]);
  }
}

export function mirrorHand(
  state: PokerStateInstance,
  hand: HandState,
  players: PlayersBySeat,
) {
  state.phase = hand.phase === "complete" ? TablePhase.Payout : hand.phase;
  state.handNumber = hand.handNumber;
  state.buttonSeat = hand.button;
  state.smallBlind = hand.smallBlind;
  state.bigBlind = hand.bigBlind;
  state.pot = totalPot(hand);
  state.currentBet = hand.currentBet;

  // The board only ever grows within a hand, so a length check is enough to
  // tell whether anything needs re-encoding.
  if (state.board.length !== hand.board.length) {
    state.board.clear();
    for (const card of hand.board) state.board.push(cardToString(card));
  }

  const acting = hand.actingSeat;
  const legal = acting === null ? null : legalActions(hand, acting);
  state.actingSeat = acting ?? NO_SEAT;
  state.canCheck = legal?.canCheck ?? false;
  state.canRaise = legal?.canRaise ?? false;
  state.callAmount = legal?.callAmount ?? 0;
  // Zeroed when raising is not legal, so a client cannot render a raise slider
  // off a range that would be refused. The server would reject the raise
  // anyway; an enabled button that always fails is still a bad table.
  state.minRaiseTo = legal?.canRaise ? legal.minRaiseTo : 0;
  state.maxRaiseTo = legal?.canRaise ? legal.maxRaiseTo : 0;

  for (const [seat, player] of players) {
    const engineSeat = hand.seats.get(seat);
    // Same guard as `seatedPlayer`, from the other direction: a seat this
    // player did not play is not this player's seat.
    const inHand =
      engineSeat && engineSeat.playerId === player.sessionId
        ? engineSeat
        : undefined;
    if (!inHand) {
      player.bet = 0;
      player.cardCount = 0;
      player.status = SeatStatus.Waiting;
      continue;
    }
    player.stack = inHand.stack;
    player.bet = inHand.committed;
    player.status = inHand.status;
    // Everyone can see that a seat is holding cards. Nobody but its owner can
    // see which, and the count is all the scene needs to place a card back.
    player.cardCount = inHand.status === "folded" ? 0 : inHand.hole.length;
  }
}

/**
 * Publish the result of a decided hand.
 *
 * The only path by which a card becomes public, and only for a hand that
 * actually reached a showdown. A hand won on folds produces no reveals: the
 * winner never has to show, so those cards go straight back in the box.
 */
/**
 * @param names Display names of everyone dealt into this hand, captured at the
 * deal. The map, not `players`, is what the summary reads: a player who left
 * mid-hand while all-in still reaches the showdown and can still win, and a
 * pot announced as won by nobody is worse than one announced as won by someone
 * who has gone home.
 */
export function mirrorResult(
  state: PokerStateInstance,
  hand: HandState,
  players: PlayersBySeat,
  names: ReadonlyMap<number, string> = new Map(),
) {
  const result = hand.result;
  if (!result) return;

  const wonBySeat = new Map<number, number>();
  for (const award of result.awards) {
    wonBySeat.set(award.seat, (wonBySeat.get(award.seat) ?? 0) + award.amount);
  }

  state.pots.clear();
  for (const pot of result.pots) {
    const entry = new PotEntry();
    entry.amount = pot.amount;
    for (const seat of pot.eligible) {
      const player = seatedPlayer(players, hand.seats.get(seat)!);
      if (player) entry.eligible.push(player.sessionId);
    }
    state.pots.push(entry);
  }

  state.reveals.clear();
  for (const entry of result.showdown) {
    // A seat that reached a showdown shows, whether or not its player is still
    // here: cards at a showdown are public by definition, and a hand that was
    // played out deserves to be seen. What a departed seat does *not* get is a
    // `Player` written to - `seatedPlayer` returns undefined for it above and
    // below, so no stack, status or card is ever written into whoever took the
    // index next. Their chips still leave with them; see README phase 2.
    const engineSeat = hand.seats.get(entry.seat)!;
    const player = seatedPlayer(players, engineSeat);
    const reveal = new Reveal();
    reveal.sessionId = player?.sessionId ?? "";
    reveal.seat = entry.seat;
    for (const card of entry.hole) reveal.cards.push(cardToString(card));
    for (const card of entry.best) reveal.best.push(cardToString(card));
    reveal.description = entry.description;
    reveal.won = wonBySeat.get(entry.seat) ?? 0;
    state.reveals.push(reveal);
  }

  const named = new Map(names);
  for (const seat of hand.seats.values()) {
    const player = seatedPlayer(players, seat);
    if (player) named.set(seat.seat, player.displayName);
  }
  state.lastResult = summarise(result.awards, result.showdown, named);
}

function summarise(
  awards: { seat: number; amount: number }[],
  showdown: { seat: number; description: string }[],
  names: ReadonlyMap<number, string>,
): string {
  const wonBySeat = new Map<number, number>();
  for (const award of awards) {
    wonBySeat.set(award.seat, (wonBySeat.get(award.seat) ?? 0) + award.amount);
  }

  const describedBySeat = new Map(showdown.map((s) => [s.seat, s.description]));
  const parts: string[] = [];
  for (const [seat, amount] of [...wonBySeat].sort((a, b) => b[1] - a[1])) {
    if (amount === 0) continue;
    const name = names.get(seat) ?? `Seat ${seat + 1}`;
    const hand = describedBySeat.get(seat);
    parts.push(hand ? `${name} wins ${amount} with ${hand}` : `${name} wins ${amount}`);
  }
  return parts.join(" · ");
}
