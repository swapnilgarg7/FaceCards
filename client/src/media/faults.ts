/**
 * What went wrong with the camera or the microphone, and what to do about it.
 *
 * Spec section 16 asks that camera and mic stay explicitly reversible, and the
 * phase-6 exit criterion is stronger than that: **every permission denial path
 * is recoverable without a page reload.** That is a claim about a state
 * machine, so this file is the state machine, kept pure and separate from both
 * the browser and the SDK so it can be tested against every failure a device
 * can produce rather than against the two that are easy to trigger by hand.
 *
 * The hard part is not the classification, it is the *recovery verb*. There
 * are only four honest answers a browser can give a person here, and picking
 * the wrong one is worse than saying nothing:
 *
 *  - **retry** - the app can fix this itself. Plugging a webcam back in, or a
 *    conferencing app letting go of the device. A button that calls
 *    `getUserMedia` again genuinely works.
 *  - **browser-settings** - only the browser can fix it. Nothing the page does
 *    can turn a denied permission into a granted one, and a "Try again" button
 *    that silently fails is how a person concludes the app is broken. Chrome
 *    will not even re-prompt after a hard denial. So this says where the
 *    control actually is.
 *  - **connect-a-device** - there is no camera. No amount of permission helps.
 *  - **none** - it is not recoverable in this browser at all. An insecure
 *    context is the real case: `getUserMedia` does not exist on a bare LAN
 *    address, and no click will conjure it.
 *
 * The two-track split matters as much as the verb. A denied *camera* and a
 * denied *microphone* are not the same event to this product - voice is the
 * thing that makes a table a table, and a face is the thing that makes it this
 * product - so the fault carries which tracks it is about, and the copy is
 * different for each. Somebody with no camera can still play a full evening;
 * somebody with no mic is watching one.
 *
 * Nothing here imports a vendor SDK, and nothing here touches `navigator`. It
 * takes an error and returns a sentence.
 */

export type TrackKind = "audio" | "video";

export type FaultKind =
  /** Refused, or the prompt was dismissed. Only the browser can undo it. */
  | "denied"
  /** Nothing to open: no camera, no microphone, or none that fits. */
  | "no-devices"
  /** There was a device and it went away. Unplugged, or the lid closed. */
  | "device-lost"
  /** Something else has it open: another tab, another app, a virtual camera. */
  | "in-use"
  /** Not a secure context, so the API is simply absent. */
  | "insecure"
  /** The device is there and refuses to start. Driver-level, usually. */
  | "hardware"
  /** Classified as nothing more specific. */
  | "unknown";

export type Recovery =
  | "retry"
  | "browser-settings"
  | "connect-a-device"
  | "none";

export interface MediaFault {
  kind: FaultKind;
  /** Which tracks this is about. Both, when the failure covers both. */
  tracks: readonly TrackKind[];
  /** One short line, safe to show. Never the raw exception. */
  message: string;
  /** What the person can do. Drives which button, if any, is offered. */
  recovery: Recovery;
  /**
   * Whether a "Try again" button would actually accomplish something.
   *
   * Derived rather than stored, so it can never disagree with `recovery`. A
   * retry button on a `browser-settings` fault is the specific bug this field
   * exists to make impossible.
   */
  retryable: boolean;
}

function fault(
  kind: FaultKind,
  tracks: readonly TrackKind[],
  message: string,
  recovery: Recovery,
): MediaFault {
  return { kind, tracks, message, recovery, retryable: recovery === "retry" };
}

const BOTH: readonly TrackKind[] = ["audio", "video"];

/** "camera", "microphone", or "camera and microphone". */
export function tracksLabel(tracks: readonly TrackKind[]): string {
  const camera = tracks.includes("video");
  const mic = tracks.includes("audio");
  if (camera && mic) return "camera and microphone";
  if (camera) return "camera";
  if (mic) return "microphone";
  return "media";
}

/**
 * The exception a browser throws, reduced to its name.
 *
 * `DOMException` is the documented shape, but it is not the only thing that
 * reaches here: LiveKit wraps `getUserMedia` failures in its own error types
 * on some paths, and those carry the original name through as a plain
 * property. Reading the property rather than instance-checking the class is
 * what makes this work for both, and the reason it is not simply
 * `err instanceof DOMException`.
 */
export function errorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * Turn whatever `getUserMedia` threw into a fault.
 *
 * The names are the ones in the Media Capture spec, plus the legacy aliases
 * that Safari and older Firefox still emit. They are matched by name and never
 * by message text, because the message is localised and is the one part of an
 * exception that is allowed to change without notice.
 */
export function classifyMediaError(
  err: unknown,
  tracks: readonly TrackKind[] = BOTH,
): MediaFault {
  const label = tracksLabel(tracks);
  switch (errorName(err)) {
    // Refused, dismissed, or blocked by policy. Every one of these needs the
    // browser's own UI, and none of them can be re-prompted from script.
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return fault(
        "denied",
        tracks,
        `Your ${label} is blocked for this site. You can still sit down and` +
          ` play; allow it in the browser's site settings, then use Retry` +
          ` below.`,
        "browser-settings",
      );

    // There is no such device. `OverconstrainedError` lands here on purpose:
    // it means nothing on this machine satisfies the capture constraints, and
    // from the player's side that is indistinguishable from not having one.
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return fault(
        "no-devices",
        tracks,
        `No ${label} was found. You can sit down and watch, and everyone can` +
          ` still see and hear each other.`,
        "connect-a-device",
      );

    // Something else has the device open. Overwhelmingly the most common real
    // failure in a room full of people who were on a video call ten minutes
    // ago, and the one where a retry button genuinely works.
    case "NotReadableError":
    case "TrackStartError":
      return fault(
        "in-use",
        tracks,
        `Your ${label} is in use by another app or tab. Close the other one,` +
          ` then try again.`,
        "retry",
      );

    case "AbortError":
      return fault(
        "hardware",
        tracks,
        `Your ${label} did not start. Try again, or reconnect the device.`,
        "retry",
      );

    case "TypeError":
      // `getUserMedia` throws TypeError when asked for neither audio nor
      // video, which is a bug in this app rather than anything the player did.
      return fault(
        "unknown",
        tracks,
        `Could not open your ${label}.`,
        "retry",
      );

    default:
      return fault(
        "unknown",
        tracks,
        `Could not open your ${label}. Try again.`,
        "retry",
      );
  }
}

/**
 * The API is not there at all.
 *
 * Its own function rather than a branch of the classifier because there is no
 * exception to classify: on an insecure origin `navigator.mediaDevices` is
 * `undefined` and there is nothing to call. Overwhelmingly the cause in
 * development, where a bare LAN address is not a secure context even though
 * `localhost` is.
 */
export function insecureContextFault(): MediaFault {
  return fault(
    "insecure",
    BOTH,
    "This browser will not share a camera or microphone here. A secure" +
      " context (https, or localhost) is required.",
    "none",
  );
}

/**
 * A track that was working and stopped: the webcam was unplugged, the lid was
 * closed on an external camera, the OS handed the device to something else.
 *
 * Distinct from `no-devices` because the recovery is different and so is the
 * tone. Nothing was refused and nothing is missing on principle - a device
 * that was there a second ago very often comes back, and the retry that picks
 * it up again is one button.
 */
export function deviceLostFault(kind: TrackKind): MediaFault {
  const label = tracksLabel([kind]);
  return fault(
    "device-lost",
    [kind],
    `Your ${label} stopped. It may have been unplugged or taken by another` +
      ` app. Reconnect it and try again.`,
    "retry",
  );
}

/**
 * Permission was granted and has since been revoked, mid-session, from the
 * browser's own UI.
 *
 * This is the case the phase-6 plan calls out by name and the one nothing else
 * covers: no call failed, no track ended with an error, the `PermissionStatus`
 * simply flipped to `denied` underneath a session that is still running. Left
 * unhandled it looks like a frozen face with no explanation at all, because
 * the last decoded frame stays on the plane.
 */
export function revokedFault(tracks: readonly TrackKind[] = BOTH): MediaFault {
  return fault(
    "denied",
    tracks,
    `Access to your ${tracksLabel(tracks)} was turned off for this site.` +
      ` Allow it again in the browser's site settings, then use Retry.`,
    "browser-settings",
  );
}

/**
 * Which of two faults to show, when both are live.
 *
 * Only one line fits over a poker table, so this is a real decision rather
 * than a convenience. The ordering is by *how much the person can do about
 * it*, worst first: an insecure context cannot be fixed at all and is the only
 * thing worth interrupting anybody for, and at the other end a device that is
 * merely busy is one click from working. A fault that a button fixes must
 * never hide one that it cannot.
 */
const SEVERITY: Record<FaultKind, number> = {
  insecure: 5,
  denied: 4,
  "no-devices": 3,
  "device-lost": 2,
  hardware: 1,
  "in-use": 1,
  unknown: 0,
};

export function worseFault(
  a: MediaFault | null,
  b: MediaFault | null,
): MediaFault | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b.kind] > SEVERITY[a.kind] ? b : a;
}
