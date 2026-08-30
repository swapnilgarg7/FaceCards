/**
 * Whether this browser can run the product, and what it will be missing.
 *
 * Phase 6 asks for a browser matrix. A matrix in a document goes stale the
 * week after it is written, so the part that has to be true at runtime is
 * here instead: a feature probe, run once in the lobby, that answers three
 * questions in the order they matter.
 *
 *  1. **Is anything actually missing?** Not "is this Safari" - a version
 *     check is a guess about a build number, and it is wrong in both
 *     directions the moment a browser ships or removes something. Every entry
 *     below asks the platform directly.
 *  2. **Does it stop the product, or only cost it something?** The split is
 *     load-bearing. Without WebGL 2 there is no room to sit in, and saying so
 *     up front is kinder than a black canvas. Without `BroadcastChannel` the
 *     only thing lost is the warning about a table open in two tabs, which
 *     nobody should be stopped for.
 *  3. **Can the person do anything about it?** An insecure origin is the only
 *     blocker with an action attached, and it is also by far the most common
 *     one in practice - visiting a dev server on a LAN address strips
 *     `getUserMedia`, WebRTC and half of everything else, and the failure that
 *     produces looks nothing like its cause.
 *
 * The report is deliberately *not* a gate. A missing capability that leaves a
 * usable table still lets someone sit at it: this product's whole argument is
 * that being in the room matters more than the features, so the failure mode
 * is a sentence, not a door.
 *
 * `readCapabilities` is the only function here that touches a global, and it
 * is the only one that is not tested.
 */

export interface Capabilities {
  /**
   * `window.isSecureContext`. The gate on `getUserMedia`, and the reason
   * `http://192.168.x.x:5173` behaves nothing like `http://localhost:5173`.
   */
  secureContext: boolean;
  /** A WebGL 2 context could be created. The room needs one. */
  webgl2: boolean;
  /** `navigator.mediaDevices.getUserMedia` exists. */
  getUserMedia: boolean;
  /** `RTCPeerConnection` exists. No voice and no faces without it. */
  webrtc: boolean;
  /** `WebSocket` exists. No game at all without it. */
  webSocket: boolean;
  /** `AudioContext` or the webkit alias. Chips, cards and the room bed. */
  webAudio: boolean;
  /** `BroadcastChannel`. Only the duplicate-tab warning depends on it. */
  broadcastChannel: boolean;
  /**
   * `HTMLVideoElement.requestVideoFrameCallback`.
   *
   * Absent in Firefox. Its absence is genuinely harmless here and the entry
   * exists to say so: `avatars/useFaceTexture.ts` drives every texture upload
   * off a decoded-frame counter precisely because rVFC could not be relied on
   * even where it exists.
   */
  videoFrameCallback: boolean;
}

export type SupportLevel =
  /** Everything is here. */
  | "ready"
  /** Playable, with something named missing. */
  | "degraded"
  /** Not playable in this browser, as configured. */
  | "unsupported";

export interface SupportIssue {
  /** Machine name, for the console and for tests. */
  id: string;
  /** One line, safe to show. */
  message: string;
}

export interface SupportReport {
  level: SupportLevel;
  /** Things that stop the product. Empty unless `level` is "unsupported". */
  blockers: readonly SupportIssue[];
  /** Things that cost the product something it can survive without. */
  warnings: readonly SupportIssue[];
}

/**
 * The failures that stop the product, worst first.
 *
 * Ordered rather than collected into a set, because the lobby has room for one
 * sentence and the first entry is the one it shows. An insecure origin is
 * first for a reason: it *causes* several of the entries below it, so
 * reporting "no camera API" to somebody on a LAN address would be true and
 * useless.
 */
const BLOCKERS: readonly {
  id: string;
  test(caps: Capabilities): boolean;
  message: string;
}[] = [
  {
    id: "insecure-context",
    test: (c) => !c.secureContext,
    message:
      "This page is not on a secure origin, so the browser will not share a" +
      " camera or microphone. Open it over https, or on localhost.",
  },
  {
    id: "no-websocket",
    test: (c) => !c.webSocket,
    message: "This browser cannot open a WebSocket, so it cannot reach a table.",
  },
  {
    id: "no-webgl2",
    test: (c) => !c.webgl2,
    message:
      "This browser cannot open a WebGL 2 context, so the table cannot be" +
      " drawn. Hardware acceleration may be turned off.",
  },
  {
    id: "no-webrtc",
    test: (c) => !c.webrtc,
    message:
      "This browser has no WebRTC, so nobody's face or voice can reach you.",
  },
];

/**
 * The failures that cost something without stopping anything.
 *
 * `getUserMedia` is in here rather than in the blockers on purpose, and it is
 * the one entry worth arguing about. A player with no camera API cannot be
 * seen or heard - which is most of the product - but they can still sit at the
 * table, watch the hand, and hear everyone else. Being in the room is the
 * thing, so this is a warning and the lobby seats them anyway.
 */
const WARNINGS: readonly {
  id: string;
  test(caps: Capabilities): boolean;
  message: string;
}[] = [
  {
    id: "no-getusermedia",
    test: (c) => !c.getUserMedia,
    message:
      "This browser will not share a camera or microphone. You can sit down" +
      " and watch, and you will still see and hear everyone else.",
  },
  {
    id: "no-webaudio",
    test: (c) => !c.webAudio,
    message:
      "This browser has no Web Audio, so the table will be silent. Voices" +
      " are unaffected.",
  },
  {
    id: "no-broadcastchannel",
    test: (c) => !c.broadcastChannel,
    message:
      "This browser cannot tell when you open the same table twice. Two tabs" +
      " at one table will echo your own voice back at everybody.",
  },
];

export function assessSupport(caps: Capabilities): SupportReport {
  const blockers = BLOCKERS.filter((entry) => entry.test(caps)).map(
    ({ id, message }) => ({ id, message }),
  );
  const warnings = WARNINGS.filter((entry) => entry.test(caps)).map(
    ({ id, message }) => ({ id, message }),
  );
  return {
    level:
      blockers.length > 0 ? "unsupported" : warnings.length > 0 ? "degraded" : "ready",
    blockers,
    warnings,
  };
}

/** The single line the lobby shows, or null when there is nothing to say. */
export function supportHeadline(report: SupportReport): string | null {
  return report.blockers[0]?.message ?? report.warnings[0]?.message ?? null;
}

/**
 * Ask the platform.
 *
 * The WebGL probe creates a context and immediately throws it away, which is
 * the only honest way to answer the question: a browser can expose
 * `WebGL2RenderingContext` and still refuse to create a context, which is
 * exactly what happens when hardware acceleration is disabled - and that is
 * the case this check exists for. `loseContext` is called explicitly rather
 * than left to the collector, because browsers cap the number of live contexts
 * at around sixteen and a probe that leaked one would be a probe that
 * eventually broke the thing it was probing.
 */
export function readCapabilities(): Capabilities {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const win = typeof window === "undefined" ? undefined : window;

  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webgl2 = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }

  return {
    secureContext: win?.isSecureContext ?? false,
    webgl2,
    getUserMedia: typeof nav?.mediaDevices?.getUserMedia === "function",
    webrtc: typeof win?.RTCPeerConnection === "function",
    webSocket: typeof win?.WebSocket === "function",
    webAudio:
      typeof win?.AudioContext === "function" ||
      typeof (win as { webkitAudioContext?: unknown } | undefined)
        ?.webkitAudioContext === "function",
    broadcastChannel: typeof win?.BroadcastChannel === "function",
    videoFrameCallback:
      typeof win?.HTMLVideoElement?.prototype?.requestVideoFrameCallback ===
      "function",
  };
}
