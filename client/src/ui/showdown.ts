import { TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";

/**
 * The showdown, as a running order.
 *
 * A hand ends in one server patch. Everything about it - the last three
 * community cards of a run-out, both players' hole cards, who won and with
 * what - arrives in the same frame, and the naive rendering of that is a line
 * of text at the bottom of the screen saying somebody won with a flush. That
 * is the single worst moment in the product: the most dramatic thing that
 * happens at a poker table, delivered as a log line.
 *
 * So the client *plays it out*. This file turns one decided snapshot into an
 * ordered list of beats - one card of the run-out, then one card of the
 * run-out, then this player's hand turns over, then that one's, then the
 * winner is named - and `ShowdownOverlay.tsx` walks the list on a timer.
 *
 * Two things worth stating plainly:
 *
 *  - **Nothing here is a poker rule.** The cards, the best five, the
 *    descriptions and the amounts are all the server's, published in
 *    `Reveal`s. This decides only the order they are *shown* in.
 *  - **Nothing here can invent a card.** A hand that ends on a fold produces
 *    no reveals, so there is nothing to turn over and the plan is one beat
 *    long. The overlay cannot show a card the server did not publish, because
 *    there is no card in this client to show.
 *
 * Pure, and no React import, so every ordering and every edge of the pacing is
 * testable without a DOM.
 */

/** One thing that happens, in order. */
export type ShowdownBeat =
  | { kind: "board"; index: number }
  | { kind: "hand"; seat: number }
  | { kind: "result" };

export interface ShowdownHand {
  seat: number;
  displayName: string;
  /** The two hole cards, as the server published them. */
  cards: string[];
  /** The best five of the seven, for picking out what actually won. */
  best: string[];
  /** "Two Pair, Kings and Fives". */
  description: string;
  /** Chips this seat took, across every pot. Zero for a loser who had to show. */
  won: number;
}

export interface ShowdownPlan {
  /** Every community card, in board order. */
  board: string[];
  /**
   * How many of them were already on the table before the hand was decided.
   *
   * The rest are a run-out: two players got all in, the server dealt the
   * remaining streets in one go, and those are the cards that have to come out
   * one at a time or the whole moment is lost.
   */
  boardShown: number;
  /** Hands that had to show, in the order they are turned over. */
  hands: ShowdownHand[];
  /** Whether anybody had to show at all. A fold ends a hand privately. */
  showdown: boolean;
  /** One line, the server's own wording. */
  summary: string;
  beats: ShowdownBeat[];
}

/** A run-out card, turning face up. Slow: this is the beat people shout at. */
export const BOARD_BEAT_MS = 780;
/** One player's hand coming face up. */
export const HAND_BEAT_MS = 900;
/** The pause before the winner is named. */
export const RESULT_BEAT_MS = 720;
/** Before anything at all, so the table has landed before it starts talking. */
export const LEAD_IN_MS = 420;

/** How long to wait before playing `beat`. */
export function beatDelayMs(beat: ShowdownBeat): number {
  switch (beat.kind) {
    case "board":
      return BOARD_BEAT_MS;
    case "hand":
      return HAND_BEAT_MS;
    case "result":
      return RESULT_BEAT_MS;
  }
}

/** How long the whole ceremony takes, for anything that needs to budget it. */
export function planDurationMs(plan: ShowdownPlan): number {
  return plan.beats.reduce((total, beat) => total + beatDelayMs(beat), LEAD_IN_MS);
}

/**
 * Who a seat is, by the same rule the server's own summary uses.
 *
 * A player can be all-in, leave, reach the showdown and win it with nobody
 * left at the table to name - so a missing row is a seat number rather than a
 * blank or a crash.
 */
function nameOf(players: readonly SeatSnapshot[], seat: number): string {
  return players.find((p) => p.seat === seat)?.displayName ?? `Seat ${seat + 1}`;
}

/**
 * Turn a decided snapshot into a running order.
 *
 * `boardShown` is how many community cards this client had already watched
 * land. Anything past it is dealt out one beat at a time.
 *
 * Losing hands are turned over before winning ones. That is a *presentation*
 * order and deliberately not the server's - the engine publishes the order the
 * hands were scored in, which is the right order for an audit and the wrong
 * one for a reveal, because it can name the winner before anybody has seen
 * why. Relative order is otherwise preserved, so a table of six that chopped
 * still reads left to right the way the server listed it.
 */
export function showdownPlan(
  snapshot: RoomSnapshot,
  boardShown: number,
): ShowdownPlan {
  const board = snapshot.board;
  const shown = Math.max(0, Math.min(board.length, boardShown));

  const hands: ShowdownHand[] = snapshot.reveals.map((reveal) => ({
    seat: reveal.seat,
    displayName: nameOf(snapshot.players, reveal.seat),
    cards: reveal.cards,
    best: reveal.best,
    description: reveal.description,
    won: reveal.won,
  }));

  // Stable: losers first in their published order, then winners in theirs.
  const ordered = [
    ...hands.filter((hand) => hand.won === 0),
    ...hands.filter((hand) => hand.won > 0),
  ];

  const beats: ShowdownBeat[] = [];
  for (let i = shown; i < board.length; i++) {
    beats.push({ kind: "board", index: i });
  }
  for (const hand of ordered) beats.push({ kind: "hand", seat: hand.seat });
  beats.push({ kind: "result" });

  return {
    board,
    boardShown: shown,
    hands: ordered,
    showdown: ordered.length > 0,
    summary: snapshot.lastResult,
    beats,
  };
}

/** Is the `index`-th community card face up yet? */
export function boardUp(plan: ShowdownPlan, played: number, index: number): boolean {
  if (index < plan.boardShown) return true;
  const beat = plan.beats.findIndex(
    (b) => b.kind === "board" && b.index === index,
  );
  return beat >= 0 && played > beat;
}

/** Has this seat's hand been turned over yet? */
export function handUp(plan: ShowdownPlan, played: number, seat: number): boolean {
  const beat = plan.beats.findIndex((b) => b.kind === "hand" && b.seat === seat);
  return beat >= 0 && played > beat;
}

/** Has the winner been named yet? Also when the whole ceremony is done. */
export function resultUp(plan: ShowdownPlan, played: number): boolean {
  return played >= plan.beats.length;
}

/**
 * Who the table is still waiting on before the next hand.
 *
 * Display only, and a *copy* of the server's `eligiblePlayers` rule rather
 * than a second opinion about it: the server decides when to deal and this
 * only says who it is likely waiting for, so a disagreement is a wrong caption
 * for a moment rather than a wrong game. Names, because "waiting for 2 players"
 * is the version of this sentence nobody can act on.
 */
export function waitingOn(snapshot: RoomSnapshot): string[] {
  if (snapshot.phase !== TablePhase.Payout) return [];
  return snapshot.players
    .filter(
      (player) =>
        player.ready &&
        player.connected &&
        !player.sittingOut &&
        player.stack + player.pendingBuyIn > 0 &&
        !player.readyNext,
    )
    .map((player) => player.displayName);
}
