import { PokerAction, type PokerActionType } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";

/**
 * The rungs a chip push can stop on.
 *
 * This is the file that makes "push chips towards the pot" safe. The phase-4
 * exit criterion is that **no interaction can produce an illegal action**, and
 * the way that is guaranteed here is not by validating a gesture: it is by
 * making every reachable value one the server already published as legal.
 * There is nothing to validate, because there is nothing else to land on.
 *
 * Every rung is built from `canCheck`, `canRaise`, `callAmount`, `minRaiseTo`
 * and `maxRaiseTo` - server-decided flags, all of them. This module does not
 * know the min-raise rule, does not know that an all-in for less caps what you
 * owe, and does not know whether betting was reopened. It reads the answers.
 * The server still checks the intent when it arrives, as it does for the
 * buttons; this only means a drag cannot *aim* at something it would refuse.
 *
 * Pure, and no React or three.js import, so the ladder can be tested against
 * whatever the server might say without a scene or a socket.
 */

export interface BetRung {
  type: PokerActionType;
  /** Raise-to amount. Absent for a check or a call, which have no size. */
  amount?: number;
  /** What the player is about to do, in the words the HUD uses. */
  label: string;
  /**
   * How many chips end up in front of this seat if the push lands here.
   *
   * A picture, not an amount: it is what `ChipField` draws in the preview
   * pile, so the push looks like the bet it is about to make. The intent that
   * goes to the server carries `type` and `amount` and nothing else.
   */
  chipsForward: number;
}

/**
 * How many raise sizes the drag offers between the minimum and all-in.
 *
 * Detents, not a continuum. A drag that can land on any of two thousand values
 * is a drag you cannot land a value with; eight stops you can feel your way
 * between is how a physical control works. Anything finer stays on the slider
 * and the arrow keys, which are still there.
 */
export const RAISE_RUNGS: number = 8;

/**
 * Everything the seat on the clock could commit to by pushing chips, cheapest
 * first, ending at all-in.
 *
 * Empty when it is not this seat's decision, which is what stops a drag from
 * meaning anything at all out of turn.
 */
export function betLadder(
  snapshot: RoomSnapshot,
  me: SeatSnapshot | undefined,
): BetRung[] {
  if (!me || snapshot.actingSeat !== me.seat) return [];

  const rungs: BetRung[] = [];

  // The free or owed action first: it is the bottom of the drag, and the thing
  // a short push means.
  if (snapshot.canCheck) {
    rungs.push({ type: PokerAction.Check, label: "Check", chipsForward: me.bet });
  } else {
    rungs.push({
      type: PokerAction.Call,
      label: `Call ${snapshot.callAmount}`,
      chipsForward: me.bet + snapshot.callAmount,
    });
  }

  if (!snapshot.canRaise) return rungs;

  const min = snapshot.minRaiseTo;
  const max = snapshot.maxRaiseTo;
  if (max < min) return rungs;

  const seen = new Set<number>();
  const step = Math.max(1, snapshot.bigBlind);

  const push = (raw: number) => {
    // Clamp first, then round to a whole big blind, then clamp again: rounding
    // an already-legal value must never carry it outside the legal range.
    const clamped = Math.min(max, Math.max(min, raw));
    const rounded = Math.min(max, Math.max(min, Math.round(clamped / step) * step));
    if (seen.has(rounded)) return;
    seen.add(rounded);
    rungs.push({
      type: PokerAction.Raise,
      amount: rounded,
      label: rounded >= max ? `All in ${rounded}` : `${verb(snapshot)} ${rounded}`,
      // A raise-to *is* the chips in front of the seat once it lands, which is
      // exactly what the preview pile has to draw.
      chipsForward: rounded,
    });
  };

  const spread = Math.max(1, RAISE_RUNGS - 1);
  for (let i = 0; i < RAISE_RUNGS; i++) {
    push(min + ((max - min) * i) / spread);
  }
  // All-in is always reachable, whatever the rounding did to the top rung.
  push(max);

  return rungs;
}

function verb(snapshot: RoomSnapshot): string {
  return snapshot.currentBet === 0 ? "Bet" : "Raise to";
}

/**
 * Which rung a drag of `fraction` (0 at rest, 1 at full extension) selects.
 *
 * Floor rather than round, with the top of the range folded back onto the last
 * rung, so every rung owns an equal slice of the travel. Rounding would give
 * the two ends half-width slices, and the two ends are check-or-call and
 * all-in: the two you least want to hit by accident.
 */
export function ladderIndex(fraction: number, rungs: number): number {
  if (rungs <= 0) return -1;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(rungs - 1, Math.floor(clamped * rungs));
}
