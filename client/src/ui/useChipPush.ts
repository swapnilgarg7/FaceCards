import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PokerActionType } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { betLadder, ladderIndex, type BetRung } from "./betLadder.js";

/**
 * Pushing chips towards the pot.
 *
 * The phase-4 exit criterion is that this should feel better than clicking
 * Call, and the thing that makes it feel like anything at all is that the
 * chips move *while you are deciding*: you drag, the pile in front of your
 * seat grows, the amount changes under your hand, and letting go is simply
 * leaving the chips where you put them.
 *
 * It cannot produce an illegal action, and not because it validates one. Every
 * value the drag can land on is a rung the server already published as legal
 * (see `betLadder.ts`), so there is nothing else to aim at. The intent goes
 * through the same `act()` path the buttons use, carrying the same turn token,
 * and the server still decides.
 *
 * A short push is nothing. Releasing before the gesture has travelled far
 * enough cancels, because the alternative is that a stray click on your own
 * chips calls a bet.
 */

/** Pixels of upward travel that spans the whole ladder. */
const TRAVEL_PX = 260;
/** Below this the gesture was not a push, and letting go commits nothing. */
const COMMIT_PX = 42;

export interface ChipPush {
  /** Mid-drag. The seated look is frozen while this is true. */
  active: boolean;
  /** Where the drag currently sits, or null when there is no drag. */
  rung: BetRung | null;
  /** What the scene draws in front of the seat, or null when not dragging. */
  preview: { seat: number; chipsForward: number } | null;
  /** True once the drag has travelled far enough that letting go acts. */
  armed: boolean;
  /**
   * How many rungs the ladder has right now. Zero means there is nothing this
   * seat may legally do, which is how the scene knows not to offer the grab.
   */
  rungCount: number;
  /** Start a drag from a pointer press on your own chips. */
  begin(clientY: number): void;
}

export interface UseChipPushOptions {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  /** False while an overlay owns the input. */
  enabled: boolean;
  onAct(turn: number, type: PokerActionType, amount?: number): void;
  /** Fired as the drag crosses from one rung to the next. */
  onDetent?(rung: BetRung): void;
}

export function useChipPush({
  snapshot,
  me,
  enabled,
  onAct,
  onDetent,
}: UseChipPushOptions): ChipPush {
  const rungs = useMemo(() => betLadder(snapshot, me), [snapshot, me]);

  const [dragging, setDragging] = useState(false);
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState(false);

  // Everything the window listeners read goes through a ref, so a drag
  // survives the state patches arriving underneath it without the listeners
  // being torn down and rebuilt on every pointer move.
  const live = useRef({ rungs, snapshot, onAct, onDetent, me, index, armed });
  live.current = { rungs, snapshot, onAct, onDetent, me, index, armed };

  const startY = useRef(0);

  const begin = useCallback(
    (clientY: number) => {
      if (!enabled || live.current.rungs.length === 0) return;
      startY.current = clientY;
      setIndex(0);
      setArmed(false);
      setDragging(true);
    },
    [enabled],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      // Up the screen is towards the middle of the table, which is the
      // direction chips are actually pushed.
      const travelled = startY.current - event.clientY;
      const next = ladderIndex(travelled / TRAVEL_PX, live.current.rungs.length);
      if (next !== live.current.index) {
        const rung = live.current.rungs[next];
        // A detent under the hand. This is most of why the gesture feels like
        // a control rather than a slider with extra steps.
        if (rung) live.current.onDetent?.(rung);
        setIndex(next);
      }
      setArmed(travelled >= COMMIT_PX);
    };

    const onUp = () => {
      const current = live.current;
      setDragging(false);
      if (!current.armed) return;

      const rung = current.rungs[current.index];
      if (!rung) return;
      // The decision this answers, copied straight back from server state, so
      // a push that arrives a street late is recognisably stale.
      current.onAct(current.snapshot.turn, rung.type, rung.amount);
    };

    const onCancel = () => setDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    };
  }, [dragging]);

  // The turn moving on, or a menu opening, ends the gesture: holding a push
  // across someone else's decision would be aiming at a ladder that no longer
  // exists.
  useEffect(() => {
    if (!enabled || rungs.length === 0) setDragging(false);
  }, [enabled, rungs.length]);

  const rung = dragging ? (rungs[index] ?? null) : null;

  return {
    active: dragging,
    rung,
    armed: dragging && armed,
    rungCount: rungs.length,
    preview:
      dragging && rung && me
        ? { seat: me.seat, chipsForward: rung.chipsForward }
        : null,
    begin,
  };
}
