import { useEffect, useRef } from "react";
import type { FaceBox } from "../scene/faceBox.js";
import { startFaceTracker, type FaceTrackerState } from "./faceTracker.js";

/**
 * Track the local camera and broadcast the framing.
 *
 * One of these per client. It is mounted next to the room rather than inside
 * `useMedia` on purpose: pulling in a nine-megabyte wasm runtime is not
 * something that should happen as a side effect of connecting to a call, and
 * keeping it out here means the media boundary stays free of vendor SDKs other
 * than the one it exists to hide.
 *
 * The real output of this hook is a stream of datagrams; every avatar that
 * matters is on someone else's screen. The status it returns is for the dev
 * readout only, and is a mutable object rather than React state, because a
 * dozen state updates a second here would re-render the whole scene.
 */

export interface FaceTrackingStatus {
  state: "idle" | FaceTrackerState;
  /** Why it is unavailable, when it is. */
  reason: string | null;
  /** Last box handed to the transport. Null means no face in frame. */
  lastBox: FaceBox | null;
  /** Measured detections in the last second. */
  rate: number;
}

const RATE_WINDOW_MS = 1000;

export function useFaceTracking(
  localVideo: HTMLVideoElement | null,
  sendFaceBox: (box: FaceBox | null) => void,
): FaceTrackingStatus {
  // Held in a ref so a re-render with a new function identity does not tear
  // down the tracker and re-download the model.
  const sendRef = useRef(sendFaceBox);
  sendRef.current = sendFaceBox;

  const statusRef = useRef<FaceTrackingStatus>({
    state: "idle",
    reason: null,
    lastBox: null,
    rate: 0,
  });

  /**
   * A machine that could not start the detector will not start it on the next
   * camera toggle either, and each attempt costs a failed wasm fetch. One
   * refusal is enough for the session.
   */
  const unavailable = useRef(false);

  useEffect(() => {
    const status = statusRef.current;

    // Null while the camera is off or before publishing. Turning the camera
    // back on remounts the tracker with the new element, which is correct: the
    // old one is detached and produces no frames.
    if (!localVideo || unavailable.current) {
      if (!unavailable.current) status.state = "idle";
      return;
    }

    const recent: number[] = [];

    const tracker = startFaceTracker(localVideo, {
      onBox: (box) => {
        const now = performance.now();
        recent.push(now);
        while (recent.length > 0 && now - recent[0]! > RATE_WINDOW_MS) {
          recent.shift();
        }
        status.rate = recent.length;
        status.lastBox = box;
        sendRef.current(box);
      },
      onState: (state, reason) => {
        status.state = state;
        status.reason = reason ?? null;
      },
      onUnavailable: (reason) => {
        unavailable.current = true;
        // Worth one line in the console: it is the difference between "face
        // tracking is off because this browser cannot run it" and "face
        // tracking is on and is choosing this framing".
        console.warn(
          `[face] tracking unavailable, falling back to a fixed crop: ${reason}`,
        );
      },
    });

    return () => {
      tracker.stop();
      status.rate = 0;
      if (status.state === "running" || status.state === "loading") {
        status.state = "idle";
      }
    };
  }, [localVideo]);

  return statusRef.current;
}
