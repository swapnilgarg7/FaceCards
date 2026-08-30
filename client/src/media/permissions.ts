import {
  classifyMediaError,
  insecureContextFault,
  revokedFault,
  type MediaFault,
  type TrackKind,
} from "./faults.js";

/**
 * Camera and microphone permission, asked for in the lobby rather than at the
 * table (spec section 3: landing, name, avatar, permission, seated).
 *
 * Why it is a step of its own: the permission prompt is a browser-chrome
 * dialog that appears wherever the browser wants and blocks until answered. If
 * the first time someone sees it is the moment they arrive in a 3D room, they
 * are answering a question about a page they have not looked at yet, and a
 * refused prompt lands them at a table with no face and no obvious way back.
 * Asking here means the answer is known before a seat is taken.
 *
 * This lives in `media/` because it is the media boundary, but it names no
 * vendor: `getUserMedia` and the Permissions API are the platform. Nothing
 * here imports an SDK, and the tracks it opens are closed immediately - the
 * point is the grant, not the stream. LiveKit opens its own tracks a moment
 * later and, because permission is already granted, does so without a second
 * prompt.
 *
 * Phase 6 added the third thing this file does: **watching**. A grant is not a
 * fact, it is a fact *for now* - somebody can revoke camera access from the
 * browser's site settings while sitting at a table, and when they do, nothing
 * fails, nothing throws, and the last decoded frame stays on their avatar's
 * face. `watchMediaPermission` is the only signal that says otherwise.
 */

export type MediaPermission =
  /** Not asked yet, and the browser will not say. */
  | "unknown"
  /** The prompt is up. */
  | "asking"
  | "granted"
  /** Refused, or dismissed. Recoverable only through browser UI. */
  | "denied"
  /** No camera or mic on this machine, or an insecure context. */
  | "unavailable";

export interface PermissionResult {
  state: MediaPermission;
  /**
   * What went wrong, classified. Null on success.
   *
   * Carries the recovery verb as well as the sentence, which is the part the
   * UI cannot work out for itself: a denial and a busy device produce very
   * similar-looking failures and need completely different buttons. See
   * `faults.ts`.
   */
  fault?: MediaFault;
}

/** Both tracks. This product wants a face and a voice, not one of them. */
const BOTH: readonly TrackKind[] = ["audio", "video"];

/** The Permissions API descriptors, which are not in every `lib.dom`. */
const DESCRIPTORS = ["camera", "microphone"] as const;

/**
 * What the browser already knows, without prompting.
 *
 * The Permissions API is the only way to distinguish "will prompt" from
 * "already granted" without side effects, and it is not everywhere: Firefox
 * has never supported the `camera` descriptor, and Safari supports neither.
 * An unsupported query is "unknown", which is also the honest answer.
 */
export async function queryMediaPermission(): Promise<MediaPermission> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";

  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";

  try {
    const states = await Promise.all(
      DESCRIPTORS.map((name) =>
        // Querying an unsupported descriptor throws rather than resolving.
        permissions.query({ name: name as PermissionName }).then((s) => s.state),
      ),
    );
    if (states.every((s) => s === "granted")) return "granted";
    // One denial is a denial: this product needs both, and reporting "prompt"
    // would send someone into a dialog that cannot succeed.
    if (states.some((s) => s === "denied")) return "denied";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Ask for camera and mic, then let them go again.
 *
 * The tracks are stopped as soon as they arrive. Holding them open until
 * LiveKit connects would keep the camera light on through the lobby and, on
 * some machines, leave the device busy when the SDK tries to claim it.
 */
export async function requestMediaPermission(): Promise<PermissionResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Not an exception to classify: on an insecure origin the API is simply
    // absent. Overwhelmingly the cause in development, where a bare LAN
    // address is not a secure context even though `localhost` is.
    return { state: "unavailable", fault: insecureContextFault() };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    for (const track of stream.getTracks()) track.stop();
    return { state: "granted" };
  } catch (err) {
    const fault = classifyMediaError(err, BOTH);
    // "Unavailable" is reserved for the cases where there is nothing to grant.
    // Everything else is a refusal as far as the lobby is concerned, and the
    // fault carries the distinction that actually matters - whether a button
    // would help.
    const state: MediaPermission =
      fault.kind === "no-devices" || fault.kind === "insecure"
        ? "unavailable"
        : "denied";
    return { state, fault };
  }
}

/**
 * Watch for permission being taken away, or given back, mid-session.
 *
 * This is the phase-6 case that has no other symptom. Revoking camera access
 * from the browser's own site settings does not fail a call or end a track in
 * a way anything else here notices - the `PermissionStatus` flips underneath a
 * running session and the avatar's face keeps showing whichever frame was up.
 *
 * `onLost` fires with the tracks that went to `denied`; `onRegained` fires when
 * everything is back to `granted`, which is what lets a warning come down
 * without a reload once somebody has fixed it in another tab.
 *
 * Returns a no-op unsubscribe where the Permissions API is not available,
 * which is Safari and Firefox - so on those browsers a revocation is noticed
 * only when something next fails. That is a real gap and it is the platform's:
 * there is no other way to ask.
 */
export function watchMediaPermission(handlers: {
  onLost(fault: MediaFault): void;
  onRegained(): void;
}): () => void {
  const permissions = navigator.permissions;
  if (!permissions?.query) return () => {};

  let cancelled = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    for (const name of DESCRIPTORS) {
      try {
        const status = await permissions.query({ name: name as PermissionName });
        if (cancelled) return;
        const kind: TrackKind = name === "camera" ? "video" : "audio";
        const onChange = (): void => {
          if (status.state === "denied") handlers.onLost(revokedFault([kind]));
          // Only "granted" stands a warning down. "prompt" means the browser
          // has reset to asking, which is not the same as having access - and
          // treating it as recovery would take the message away from somebody
          // who still has no camera.
          else if (status.state === "granted") handlers.onRegained();
        };
        status.addEventListener("change", onChange);
        cleanups.push(() => status.removeEventListener("change", onChange));
      } catch {
        // An unsupported descriptor. Nothing to watch, and nothing to report:
        // a browser that will not answer the question is not a browser with a
        // problem.
      }
    }
  })();

  return () => {
    cancelled = true;
    for (const cleanup of cleanups) cleanup();
  };
}
