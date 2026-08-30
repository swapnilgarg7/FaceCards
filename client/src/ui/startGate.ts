import { MIN_PLAYERS } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";

/**
 * Whether the table is still waiting to begin, and who it is waiting on.
 *
 * A poker night does not start because two browsers finished connecting. It
 * starts when the people in the room say they are ready, which is a sentence
 * somebody says out loud - so the software should wait for it rather than
 * dealing a blind to a player who is still pointing their webcam at the
 * ceiling. `Player.ready` is the server's record of that sentence; this is
 * what the client says about it.
 *
 * The gate is on *starting*, never on the hand after. Once a seat is ready it
 * stays ready and the table deals itself, exactly as it did before. Being
 * dealt out again is sitting out, which is a different thing with different
 * rules attached.
 *
 * Pure and snapshot-only, so every combination of "who is here, who is ready,
 * has it started" can be tested without a socket.
 */

export interface GateState {
  /** Show the gate rather than the action bar. */
  show: boolean;
  /** This player still has to press Play. */
  canPlay: boolean;
  /** True once a hand has been dealt: joining, not starting. */
  started: boolean;
  /** Seats that have pressed Play. */
  ready: number;
  /** Seats at the table. */
  seated: number;
  /** Ready players still needed before anything can be dealt. */
  needed: number;
  /**
   * Who else the table is still waiting on. Only seats that could actually
   * press Play: a dropped laptop or a seat sitting out is not somebody about
   * to click, and naming them would read as the table being stuck on a person
   * who is not coming. Empty when it is only this player.
   */
  waitingOn: string[];
}

export function startGate(
  snapshot: RoomSnapshot,
  me: SeatSnapshot | undefined,
): GateState {
  const seated = snapshot.players.length;
  const ready = snapshot.players.filter((p) => p.ready).length;
  const needed = Math.max(0, MIN_PLAYERS - ready);
  const started = snapshot.handNumber > 0;
  const canPlay = !!me && !me.ready;

  const waitingOn = snapshot.players
    .filter((p) => !p.ready && p.sessionId !== me?.sessionId && canStillPlay(p))
    .map((p) => p.displayName);

  return {
    // Three reasons to hold the table. This player has not said they are ready
    // - in which case nothing else matters, because they are not in the game -
    // or everyone here has and there are still not enough of them, or the
    // table is only waiting on the friends who have not clicked yet.
    //
    // That third one has to be here, not just `needed > 0`. The server holds
    // the *first* deal open for the whole room rather than firing two seconds
    // after the second Play, so a player who is ready early can now be waiting
    // twenty seconds for the rest of the table. Without this they would spend
    // it looking at empty felt with nothing on screen saying why, and the
    // honest answer - "Waiting for Bea, Cal and Dev" - is already computed.
    //
    // Deliberately not shown once the table can deal: the two seconds between
    // the last "ready" and the first card belong to the action bar saying
    // "Dealing", not to a gate that has already been satisfied.
    show:
      !!me &&
      (canPlay || (!started && (needed > 0 || waitingOn.length > 0))),
    canPlay,
    started,
    ready,
    seated,
    needed,
    waitingOn,
  };
}

/**
 * Whether this seat could still press Play if it wanted to.
 *
 * Mirrors the server's own rule for whom the first deal waits on. A seat that
 * is dropped, sitting out, or out of chips is settled either way, so the table
 * is not waiting on it and should not say that it is.
 */
function canStillPlay(seat: SeatSnapshot): boolean {
  if (!seat.connected) return false;
  if (seat.sittingOut) return false;
  return seat.stack + seat.pendingBuyIn > 0;
}
