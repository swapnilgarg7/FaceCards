import { useEffect, useState } from "react";
import { ensureAwake, subscribeWake, wakeStatus, type WakeStatus } from "./wake.js";

/**
 * Subscribe to the wake, and start one on mount.
 *
 * Mounting the lobby is the earliest honest signal that somebody wants to
 * play, which makes it the right moment to start a server that takes a minute
 * to start. See the note at the top of `wake.ts`.
 */
export function useServerWake(): WakeStatus {
  const [status, setStatus] = useState<WakeStatus>(wakeStatus);

  useEffect(() => subscribeWake(setStatus), []);

  useEffect(() => {
    // A failure is already reported through the subscription above, and the
    // click that follows will surface it again with somewhere to go. Nothing
    // to do here but not become an unhandled rejection.
    void ensureAwake().catch(() => {});
  }, []);

  return status;
}
