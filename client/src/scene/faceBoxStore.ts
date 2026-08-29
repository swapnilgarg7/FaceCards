/**
 * Latest framing per peer, readable from inside `useFrame`.
 *
 * Deliberately not React state. Boxes arrive around ten times a second per
 * peer, so a six-handed table would re-render the whole tree sixty times a
 * second to move a texture offset. The scene mutates refs inside `useFrame`
 * and does not set state per frame; this is the same rule applied to data
 * coming off the wire rather than out of a clock.
 */

import type { FaceBox } from "./faceBox.js";

/** One row of the dev readout. Not used by rendering. */
export interface FaceBoxStat {
  peerId: string;
  box: FaceBox | null;
  /** Since the last datagram from this peer. */
  ageMs: number;
  /** Datagrams accepted from them in the last second. */
  rate: number;
}

export interface FaceBoxStore {
  /** The framing to use for a peer, or null to fall back to a fixed crop. */
  get(peerId: string): FaceBox | null;
  /**
   * A snapshot for the dev overlay. Allocates, so it is called a couple of
   * times a second from a debug component and never from `useFrame`.
   */
  stats(): FaceBoxStat[];
  /**
   * A datagram arrived. `null` means the sender is tracking but sees no face,
   * which refreshes liveness without replacing the last known framing.
   */
  receive(peerId: string, box: FaceBox | null): void;
  forget(peerId: string): void;
  clear(): void;
}

interface Entry {
  box: FaceBox | null;
  at: number;
  /** Recent arrival times, for the dev readout's rate figure. */
  recent: number[];
}

/** Enough to measure a rate over a second at the intended ~12 Hz. */
const RATE_WINDOW_MS = 1000;
const RATE_SAMPLES = 24;

/**
 * A peer's last framing is held for as long as they are in the room, and is
 * deliberately never expired.
 *
 * There was a timeout here once, on the reasoning that silence means the
 * sender's tracker is gone and the fixed crop should take over. That reasoning
 * is wrong, and it caused the bug it was meant to handle. Falling back is a
 * *downgrade*: the held box was measured against a real face and was correct
 * when it was sent, while the fixed crop is a guess that was never correct for
 * anybody. Swapping a stale truth for a fresh guess makes the picture worse,
 * and it does it as a visible jump.
 *
 * Silence is also completely ordinary. A browser throttles `requestAnimationFrame`
 * and `requestVideoFrameCallback` to nothing in a tab that is not visible, so
 * any player who switches tabs stops publishing within a frame or two. With a
 * timeout, everyone else watched their face snap off-centre a couple of seconds
 * after they looked away, and snap back when they returned. Holding means their
 * avatar simply keeps the framing they left, which is also what it does when
 * they lean out of shot.
 *
 * A peer who actually leaves is removed by `forget`, so nothing accumulates.
 */
export function createFaceBoxStore(
  now: () => number = () => performance.now(),
): FaceBoxStore {
  const entries = new Map<string, Entry>();

  return {
    get(peerId) {
      // Null only when this peer has never sent a box at all, which is the one
      // case where there is nothing better than the fixed crop to fall back to.
      return entries.get(peerId)?.box ?? null;
    },

    stats() {
      const at = now();
      return [...entries].map(([peerId, entry]) => ({
        peerId,
        box: entry.box,
        ageMs: at - entry.at,
        rate: entry.recent.filter((t) => at - t <= RATE_WINDOW_MS).length,
      }));
    },

    receive(peerId, box) {
      const at = now();
      const previous = entries.get(peerId);
      const recent = previous ? previous.recent : [];
      recent.push(at);
      if (recent.length > RATE_SAMPLES) recent.shift();

      entries.set(peerId, {
        // Hold the last real framing through a gap in detection. Someone who
        // leans out of shot and back should return to the framing they left,
        // not watch their face slide across the plane and back.
        box: box ?? previous?.box ?? null,
        at,
        recent,
      });
    },

    forget(peerId) {
      entries.delete(peerId);
    },

    clear() {
      entries.clear();
    },
  };
}
