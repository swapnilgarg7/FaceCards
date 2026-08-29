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

/**
 * How long a peer's last box stays usable without a refresh.
 *
 * A sender who is tracking transmits on a heartbeat whether or not it can see
 * a face, so silence for this long means the tracker itself is gone: the model
 * failed to load, the tab was throttled into the ground, or they are running a
 * build without tracking at all. Falling back to the fixed crop is right, and
 * holding a stale box forever is not.
 *
 * Comfortably more than the publish interval, because a lossy datagram channel
 * is allowed to drop a few in a row and that must not read as a failure.
 */
const STALE_MS = 2500;

interface Entry {
  box: FaceBox | null;
  at: number;
  /** Recent arrival times, for the dev readout's rate figure. */
  recent: number[];
}

/** Enough to measure a rate over a second at the intended ~12 Hz. */
const RATE_WINDOW_MS = 1000;
const RATE_SAMPLES = 24;

export function createFaceBoxStore(
  now: () => number = () => performance.now(),
): FaceBoxStore {
  const entries = new Map<string, Entry>();

  return {
    get(peerId) {
      const entry = entries.get(peerId);
      if (!entry) return null;
      if (now() - entry.at > STALE_MS) {
        // Dropped rather than just reported stale. `forget` already covers the
        // peer who left; this covers the one still in the room whose tracker
        // died, so the map holds live trackers rather than every identity that
        // has ever published.
        entries.delete(peerId);
        return null;
      }
      return entry.box;
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
