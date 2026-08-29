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
  /** One line, safe to show. Never the raw exception. */
  message?: string;
}

/**
 * What the browser already knows, without prompting.
 *
 * The Permissions API is the only way to distinguish "will prompt" from
 * "already granted" without side effects, and it is not everywhere: Firefox
 * has never supported the `camera` descriptor. An unsupported query is
 * "unknown", which is also the honest answer.
 */
export async function queryMediaPermission(): Promise<MediaPermission> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";

  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";

  try {
    const states = await Promise.all(
      (["camera", "microphone"] as const).map((name) =>
        // The descriptor names are not in every lib.dom, and querying an
        // unsupported one throws rather than resolving.
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
    return {
      state: "unavailable",
      // Overwhelmingly the cause in development: `getUserMedia` needs a secure
      // context, and a bare LAN IP is not one even though localhost is.
      message:
        "This browser will not share a camera here. A secure context (https, or localhost) is required.",
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    for (const track of stream.getTracks()) track.stop();
    return { state: "granted" };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return {
        state: "denied",
        message:
          "Camera and microphone were blocked. You can still sit down, but nobody will see or hear you until you allow them in the browser's site settings.",
      };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return {
        state: "unavailable",
        message:
          "No camera or microphone found. You can still sit down and watch.",
      };
    }
    return {
      state: "denied",
      message: "Could not open the camera or microphone.",
    };
  }
}
