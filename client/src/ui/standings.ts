import { SeatStatus, TablePhase } from "@facecards/shared";
import type {
  RevealSnapshot,
  RoomSnapshot,
  SeatSnapshot,
} from "../net/useRoom.js";

/**
 * The evening, as a table of numbers.
 *
 * Pure, and split out of the component, because the interesting part is not
 * the markup: it is the single arithmetic decision this file makes, which is
 * **what "how am I doing" means when the same chips can be behind a seat, in
 * front of it, or in a pot that is still being contested.**
 *
 * The answer is the one every card room uses: *your stack is your stack*.
 * Profit is the chips behind your seat minus every chip you have bought, and
 * nothing else counts, because nothing else is yours yet. It means the number
 * dips while you have a bet out and jumps when the pot comes back, which is
 * exactly what a real stack of chips does and exactly what the person watching
 * their own chips expects. Any cleverer definition - counting your bet, or
 * your share of the pot - would have to guess at an outcome the hand has not
 * reached, and would disagree with the pile of chips on the table in front of
 * everybody.
 *
 * Chips bought during a hand are the one thing held apart. They are real, they
 * are paid for, and they are not in the stack yet, so they are neither added
 * to the chip count nor charged against the buy-in until they land. Both sides
 * of the sum move together at the next deal and the profit column does not
 * flicker.
 */

/**
 * What this seat is doing, in the words the table uses.
 *
 * One field rather than a handful of booleans, because a row has room for one
 * line and the interesting question is always "what is the *most* important
 * thing to know about this seat right now". The order that answers it is in
 * `noteFor`.
 */
export type SeatNote =
  | "away"
  | "all-in"
  | "folded"
  | "buying-in"
  | "busted"
  | "sitting-out"
  | "waiting-for-blind"
  | "playing";

export interface LeaderboardRow {
  sessionId: string;
  seat: number;
  displayName: string;
  isMe: boolean;
  /** Shared by everyone on the same profit; 1-based. */
  rank: number;
  /** Chips behind the seat. What they can bet with. */
  chips: number;
  /** Chips in front of the seat for this round, or 0 between hands. */
  committed: number;
  /** Bought, paid for, and waiting on the end of the hand in progress. */
  pending: number;
  /** Every chip brought to the table, the opening stake included. */
  buyIn: number;
  /** `chips - buyIn`. Sums across the table to minus the pot on the felt. */
  profit: number;
  handsPlayed: number;
  handsWon: number;
  note: SeatNote;
  /** Holding the button this hand. */
  onButton: boolean;
  /** Posting a blind this hand: "SB", "BB", or empty. */
  blind: "" | "SB" | "BB";
  /** On the clock right now. */
  acting: boolean;
  /** What this seat showed down and what it took, or null. */
  reveal: RevealSnapshot | null;
}

function noteFor(player: SeatSnapshot): SeatNote {
  // Ordered by what someone looking at this seat most needs to know first.
  // Being away outranks everything, because an empty chair explains why the
  // table is waiting. What they are doing *in the hand* comes next, because a
  // hand is being played. Only then the reasons a seat is out of the next one.
  if (!player.connected) return "away";
  if (player.status === SeatStatus.AllIn) return "all-in";
  if (player.status === SeatStatus.Folded) return "folded";
  // A stack of nothing is only "busted" once the hand is done with it: while
  // it is still all-in above, those chips are very much in play.
  if (player.stack === 0 && player.pendingBuyIn > 0) return "buying-in";
  if (player.stack === 0) return "busted";
  if (player.sittingOut) return "sitting-out";
  if (player.owesBlind) return "waiting-for-blind";
  return "playing";
}

export function leaderboard(
  snapshot: RoomSnapshot,
  sessionId: string | null,
): LeaderboardRow[] {
  const revealBySeat = new Map(snapshot.reveals.map((r) => [r.seat, r]));

  const rows: Omit<LeaderboardRow, "rank">[] = snapshot.players.map(
    (player) => ({
      sessionId: player.sessionId,
      seat: player.seat,
      displayName: player.displayName,
      isMe: player.sessionId === sessionId,
      chips: player.stack,
      committed: player.bet,
      pending: player.pendingBuyIn,
      buyIn: player.totalBuyIn,
      profit: player.stack - player.totalBuyIn,
      handsPlayed: player.handsPlayed,
      handsWon: player.handsWon,
      note: noteFor(player),
      onButton: snapshot.buttonSeat === player.seat,
      blind:
        snapshot.smallBlindSeat === player.seat
          ? "SB"
          : snapshot.bigBlindSeat === player.seat
            ? "BB"
            : "",
      acting: snapshot.actingSeat === player.seat,
      reveal: revealBySeat.get(player.seat) ?? null,
    }),
  );

  // Profit first, then the deeper stack, then the seat - so the order is
  // total, and two players who are level do not swap places every patch.
  rows.sort(
    (a, b) => b.profit - a.profit || b.chips - a.chips || a.seat - b.seat,
  );

  // Standard competition ranking: level players share a place, and the next
  // one along skips. Being told you are joint second is information; being
  // told you are third because your seat index is higher is noise.
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row, index) => {
    if (previous === null || row.profit !== previous) rank = index + 1;
    previous = row.profit;
    return { ...row, rank };
  });
}

/** Chips on the felt that belong to nobody yet. Zero between hands. */
export function contestedChips(snapshot: RoomSnapshot): number {
  return snapshot.phase === TablePhase.Waiting ? 0 : snapshot.pot;
}

/**
 * Is this seat in the hand being played right now?
 *
 * The client's read of the same question the server answers before deciding
 * whether a buy-in lands now or at the end of the hand. It is used only to
 * word a button - "add chips" against "add chips after this hand" - because
 * the server decides the timing and this cannot make it wrong, only surprising.
 */
export function isInHand(
  snapshot: RoomSnapshot,
  player: SeatSnapshot | undefined,
): boolean {
  if (!player) return false;
  if (
    snapshot.phase === TablePhase.Waiting ||
    snapshot.phase === TablePhase.Payout
  ) {
    return false;
  }
  return (
    player.status === SeatStatus.Active ||
    player.status === SeatStatus.AllIn ||
    player.status === SeatStatus.Folded
  );
}
