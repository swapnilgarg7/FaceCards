/**
 * Phase 6 exit-criteria check.
 *
 * Phase 6 is the reliability phase, and reliability is mostly a claim about
 * what happens on somebody *else's* machine - a denied camera, an unplugged
 * webcam, a GPU that cannot keep up, a second tab, a plaintext deploy. None of
 * those can be reproduced on demand here, so the strategy is the one
 * `verify:phase5` established: check the *properties* that make the handling
 * correct, against the real modules, plus the structural facts on disk that a
 * later edit would break silently.
 *
 * The three exit criteria and how they are covered:
 *
 *  1. **Every permission denial path is recoverable without a page reload.**
 *     Mechanically: every failure a device can produce classifies to a fault,
 *     every fault carries a recovery verb, and a "Retry" is offered if and
 *     only if retrying could work. The last one is the load-bearing property -
 *     a Retry button on a hard denial fails silently every time it is pressed,
 *     which is how a person concludes the app is broken.
 *  2. **Verified 60 FPS, and the fallback verified on a throttled GPU.** The
 *     frame-rate half needs a laptop. The *fallback* half does not: the ladder
 *     is a pure function, so a throttled GPU can be simulated exactly by
 *     feeding it slow frames, and the thing that actually needed proving is
 *     that it settles rather than oscillating.
 *  3. **A one-hour six-player session with no crash, no desync, no stuck
 *     hand.** Needs six people. What is checked here is the socket-level
 *     precondition phase 6 added for it: every client message has a budget,
 *     and nothing reaches the poker engine before that budget is checked.
 *
 * Plus the standing rules this phase touched: hole cards stay private, no A/V
 * is persisted, and production is TLS on both ends.
 *
 * Nothing here needs the dev stack running.
 *
 *   npm run verify:phase6
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ClientMessage } from "@facecards/shared";
import {
  MESSAGE_LIMITS,
  MessageLimiter,
} from "../server/src/rooms/messageLimits.ts";
import { checkOrigins } from "../server/src/tls.ts";
import { checkEndpoints } from "../client/src/net/endpoints.ts";
import {
  classifyMediaError,
  deviceLostFault,
  insecureContextFault,
  revokedFault,
  worseFault,
} from "../client/src/media/faults.ts";
import {
  canAttempt,
  diffDevices,
  summariseDevices,
} from "../client/src/media/devices.ts";
import { assessSupport, supportHeadline } from "../client/src/support.ts";
import {
  DEMOTE_MS,
  DEMOTE_WINDOW_MS,
  PROMOTE_MS,
  PROMOTE_WINDOW_MS,
  QUALITY_PROFILES,
  SETTLE_MS,
  TIER_ORDER,
  capStream,
  newMonitor,
  probeTier,
  sampleFrame,
} from "../client/src/scene/quality.ts";
import { claimTable } from "../client/src/net/tabLock.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (title) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

// ------------------------------------------------- 1. permission recovery

section("Permissions and devices are recoverable");

/**
 * Every error name a browser can produce from `getUserMedia`, across the
 * current spec and the legacy aliases Safari and older Firefox still emit.
 * This list is the point of the check: it is easy to handle the two failures
 * that are easy to trigger by hand and to leave the other seven falling
 * through to a default nobody has read.
 */
const GUM_ERRORS = [
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
  "NotReadableError",
  "TrackStartError",
  "AbortError",
  "TypeError",
];

const named = (name) => Object.assign(new Error("localised"), { name });
const allFaults = [
  ...GUM_ERRORS.map((name) => classifyMediaError(named(name))),
  insecureContextFault(),
  revokedFault(),
  deviceLostFault("video"),
  deviceLostFault("audio"),
  classifyMediaError(null),
];

check(
  "every device failure classifies to a fault with a sentence",
  allFaults.every((f) => typeof f.message === "string" && f.message.length > 20),
);

check(
  "every fault states a recovery verb",
  allFaults.every((f) =>
    ["retry", "browser-settings", "connect-a-device", "none"].includes(
      f.recovery,
    ),
  ),
);

// The load-bearing one. Nothing a page does can turn a denied permission into
// a granted one - Chrome will not even re-prompt after a hard denial - so a
// Retry offered there is a button that fails silently every time.
check(
  "a Retry is offered if and only if retrying could work",
  allFaults.every((f) => f.retryable === (f.recovery === "retry")),
);

check(
  "a refusal never offers a Retry",
  ["NotAllowedError", "PermissionDeniedError", "SecurityError"].every(
    (name) => classifyMediaError(named(name)).retryable === false,
  ),
);

check(
  "revocation mid-session is treated as a refusal, not as a retry",
  revokedFault().retryable === false && revokedFault().kind === "denied",
);

// Unplugging and plugging back in is the one path that has to be a button,
// because it is the one the app can genuinely fix by asking again.
check(
  "an unplugged device offers a Retry",
  deviceLostFault("video").retryable && deviceLostFault("audio").retryable,
);

check(
  "a busy device offers a Retry",
  classifyMediaError(named("NotReadableError")).retryable,
);

check(
  "an insecure origin offers nothing, because nothing would help",
  insecureContextFault().recovery === "none",
);

// Only one line fits over a poker table, so which fault wins is a real
// decision: the one the player can do least about.
check(
  "a fixable fault never hides an unfixable one",
  worseFault(
    classifyMediaError(named("NotReadableError")),
    revokedFault(),
  ).kind === "denied" &&
    worseFault(revokedFault(), insecureContextFault()).kind === "insecure",
);

// An automatic retry against a machine with no camera would replace an
// accurate message with a worse one.
check(
  "a retry is not attempted where it could only produce a worse message",
  canAttempt({ cameras: 0, mics: 1 }, ["video"]) === false &&
    canAttempt({ cameras: 1, mics: 1 }, ["video", "audio"]) === true,
);

check(
  "losing the last camera is reported, and losing one of two is not",
  diffDevices({ cameras: 1, mics: 1 }, { cameras: 0, mics: 1 }).lost.includes(
    "video",
  ) &&
    diffDevices({ cameras: 2, mics: 1 }, { cameras: 1, mics: 1 }).lost.length ===
      0,
);

check(
  "a headphone plug is not treated as a change",
  diffDevices(
    summariseDevices([{ kind: "videoinput" }, { kind: "audioinput" }]),
    summariseDevices([
      { kind: "videoinput" },
      { kind: "audioinput" },
      { kind: "audiooutput" },
    ]),
  ).changed === false,
);

// The UI half: the banner has to be reachable from the table *and* from the
// menu, because the menu is where somebody arrives after fixing a permission
// in the browser's own settings.
const table = read("client", "src", "ui", "Table.tsx");
const settings = read("client", "src", "ui", "SettingsPanel.tsx");
check(
  "the fault banner is reachable from both the table and the menu",
  table.includes("MediaFaultBanner") && settings.includes("MediaFaultBanner"),
);

check(
  "camera and mic stay explicitly reversible (spec section 16)",
  settings.includes("toggleMic") &&
    settings.includes("toggleCamera") &&
    table.includes("toggleMic") &&
    table.includes("toggleCamera"),
);

// ------------------------------------------------------ 2. quality ladder

section("The GPU fallback steps down, and settles");

check(
  "every tier is cheaper than the one above it",
  QUALITY_PROFILES.low.dpr[1] < QUALITY_PROFILES.medium.dpr[1] &&
    QUALITY_PROFILES.medium.dpr[1] < QUALITY_PROFILES.high.dpr[1] &&
    QUALITY_PROFILES.low.shadows === false &&
    QUALITY_PROFILES.medium.shadowMapSize <=
      QUALITY_PROFILES.high.shadowMapSize,
);

// The one thing the fallback may never do is stop showing people. A room with
// no faces in it is not a cheaper version of this product, it is a different
// and much worse one.
check(
  "no tier turns a face off",
  TIER_ORDER.every((tier) => QUALITY_PROFILES[tier].videoCeiling !== "low"),
);

check(
  "the video ceiling caps a request and never raises one",
  capStream("high", QUALITY_PROFILES.low) === "medium" &&
    capStream("low", QUALITY_PROFILES.low) === "low" &&
    capStream("low", QUALITY_PROFILES.high) === "low",
);

check(
  "a software rasteriser starts on the floor",
  probeTier({ cores: 16, memoryGb: 32, renderer: "Google SwiftShader" }) ===
    "low" && probeTier({ cores: 16, webgl2: false }) === "low",
);

check(
  "a machine that says nothing about itself is not punished for it",
  // Safari reports neither `deviceMemory` nor a renderer string.
  probeTier({}) === "high",
);

/** Feed `ms` of frames at `dtMs` each. */
const run = (monitor, dtMs, ms) => {
  let m = monitor;
  for (let t = 0; t < ms; t += dtMs) m = sampleFrame(m, dtMs);
  return m;
};
const settled = (tier) => run(newMonitor(tier), 16, SETTLE_MS + 100);

// A deliberately throttled GPU: every frame well past the target.
const throttled = run(settled("high"), DEMOTE_MS + 6, DEMOTE_WINDOW_MS * 4);
check(
  "a throttled GPU is demoted to the floor",
  throttled.tier === "low",
  `after ${throttled.demotions} steps`,
);

// The property that makes the fallback usable rather than a stutter generator.
// A machine sitting between the thresholds is doing fine and has no headroom
// for the next tier; it must rest there rather than alternating.
const borderline = run(
  run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100),
  (DEMOTE_MS + PROMOTE_MS) / 2,
  PROMOTE_WINDOW_MS * 4,
);
check(
  "a borderline machine settles instead of oscillating",
  borderline.tier === "medium",
);

// A tab behind another window hands back a delta of several seconds on its
// first frame back. One of those must not cost a tier.
check(
  "a backgrounded tab does not cost a tier on its way back",
  sampleFrame(settled("high"), 8_000).tier === "high",
);

// Recovery, so a laptop that was hot and is now cool gets its shadows back.
const recovered = run(
  run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100),
  PROMOTE_MS - 3,
  SETTLE_MS + PROMOTE_WINDOW_MS + 200,
);
check("a machine that recovers is promoted back", recovered.tier === "high");

// The scene has to actually read the profile, or all of the above is a
// simulation of a setting nothing applies.
const room3d = read("client", "src", "scene", "Room3D.tsx");
check(
  "the scene reads every knob the profile declares",
  ["quality.dpr", "quality.shadows", "quality.shadowMapSize", "quality.antialias", "capStream"].every(
    (needle) => room3d.includes(needle),
  ),
);

check(
  "the phase-5 `lite` flag is gone rather than shadowing the tier",
  !/\blite\s*[=:}]/.test(room3d),
);

check(
  "the player can override the automatic tier (spec section 12)",
  settings.includes("quality.choose") && settings.includes("QUALITY_SETTINGS"),
);

// ------------------------------------------------------ 3. socket budgets

section("The socket has a budget for every message");

const messageTypes = Object.values(ClientMessage);
check(
  "every client message has a budget",
  messageTypes.every((type) => MESSAGE_LIMITS[type]?.limit > 0),
  messageTypes.filter((t) => !MESSAGE_LIMITS[t]).join(", "),
);

check(
  "no budget is tight enough to refuse a fast human",
  messageTypes
    .filter((t) => t !== ClientMessage.RequestMediaToken)
    .every((t) => MESSAGE_LIMITS[t].limit / (MESSAGE_LIMITS[t].windowMs / 1000) >= 1),
);

const limiter = new MessageLimiter();
for (let i = 0; i < MESSAGE_LIMITS[ClientMessage.Action].limit + 5; i++) {
  limiter.allow(ClientMessage.Action, "flooder");
}
check(
  "a flood is refused",
  limiter.allow(ClientMessage.Action, "flooder") === false,
);
check(
  "and refuses only the flooder, on only the message they flooded",
  limiter.allow(ClientMessage.Action, "somebody-else") === true &&
    limiter.allow(ClientMessage.BuyIn, "flooder") === true,
);
check(
  "a flood is logged once rather than once a frame",
  limiter.shouldLog("flooder") === true && limiter.shouldLog("flooder") === false,
);

// The structural half, and the one an edit would break silently: a budget
// checked *inside* a handler has already paid for the frame it is refusing.
const room = read("server", "src", "rooms", "PokerRoom.ts");
const rawHandlers = [...room.matchAll(/this\.onMessage[<(]/g)].length;
check(
  "every inbound message goes through the budget, not around it",
  rawHandlers === 1,
  `${rawHandlers} raw onMessage call(s); exactly one is expected, inside onIntent`,
);
check(
  "a departing session's budget is forgotten with it",
  room.includes("this.messageLimits.forget(client.sessionId)"),
);

// The HTTP half, from phase 3, re-asserted here because the phase-6 list names
// rate-limited room creation explicitly.
const index = read("server", "src", "index.ts");
check(
  "room creation and lookup are still rate-limited per address",
  index.includes("limited(createLimiter") && index.includes("limited(lookupLimiter"),
);
// Parsed rather than string-matched: `!index.includes('"create"')` passes just
// as happily if the whole assignment is deleted, which is the edit that would
// actually reopen the hole.
const exposed = index.match(
  /matchMaker\.controller\.exposedMethods\s*=\s*\[([^\]]*)\]/,
);
const exposedMethods = (exposed?.[1] ?? "")
  .split(",")
  .map((m) => m.trim().replace(/^["']|["']$/g, ""))
  .filter(Boolean);
check(
  "matchmaking still cannot be used to squat on a chosen room code",
  exposedMethods.length > 0 &&
    !exposedMethods.includes("create") &&
    !exposedMethods.includes("joinOrCreate"),
  exposedMethods.join(", ") || "exposedMethods is not assigned at all",
);

// -------------------------------------------------------------- 4. TLS

section("Production is encrypted on both ends");

check(
  "a plaintext production origin is refused",
  checkOrigins(["http://facecards.pages.dev"]).length === 1 &&
    checkOrigins(["https://facecards.pages.dev"]).length === 0,
);
check(
  "a wildcard origin is refused",
  checkOrigins(["*"]).length === 1,
);
check(
  "loopback still works, so a production build can be run locally",
  checkOrigins(["http://localhost:5173"]).length === 0,
);
check(
  "a production client pointed at a plaintext server refuses to load",
  checkEndpoints("http://x.example", "ws://x.example", true) !== null &&
    checkEndpoints("https://x.example", "wss://x.example", true) === null,
);
check(
  "and development is left alone",
  checkEndpoints("http://localhost:2567", "ws://localhost:2567", false) === null,
);
check(
  "the server asserts it at startup rather than documenting it",
  read("server", "src", "config.ts").includes("assertSecureOrigins("),
);

// ------------------------------------------------- 5. standing invariants

section("Standing rules this phase touched");

// Hole cards. Re-audited now that every message exists, which is what the
// phase-6 list asks for.
//
// The audit is a *closed set*, not a spot check: every file on the wire side
// that names `holeCard` is enumerated and compared against the four that are
// allowed to. A fifth one is the shape this bug would actually take - somebody
// adding a debug payload, a log line, or a convenience getter - and none of
// those would fail any other test in the repo.
//
// Scoped to `server` and `shared` deliberately, and the exclusion is the
// interesting half. The client has several legitimate readers (`useRoom`
// copies them out of its own payload, `TableCards` and `HandHud` draw them),
// and that is *fine by construction*: a client can only render what the server
// sent it, and the server sends these to exactly one view. Auditing the client
// here would be auditing the wrong end - the question is never "who reads a
// card", it is "who could put one somewhere a second client can see it", and
// every such place is on the wire side or is the datagram channel, which is
// checked separately below.
const HOLE_CARD_ALLOWED = new Set([
  // The only writer: engine state into the schema.
  "server/src/state/mirror.ts",
  // The only place a view is granted. Names them in a comment only.
  "server/src/state/view.ts",
  // Clears them on join, and comments on the view.
  "server/src/rooms/PokerRoom.ts",
  // The schema itself, where `{ view: true }` lives.
  "shared/src/state.ts",
]);
const holeCardFiles = execSync(
  'git grep -l -i "holecard" -- server shared',
  { cwd: root, encoding: "utf8" },
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.endsWith(".test.ts"));
const unexpected = holeCardFiles.filter((f) => !HOLE_CARD_ALLOWED.has(f));
check(
  "only the four files that own hole cards may name them",
  unexpected.length === 0,
  unexpected.join(", "),
);
check(
  "and there is still exactly one place a view is granted",
  read("server", "src", "state", "view.ts").includes("client.view = view") &&
    [...room.matchAll(/grantOwnPlayerView\(/g)].length === 2,
);

// Every outbound message on the server, and what it may carry. Two sends, both
// addressed to a single client, neither carrying a card.
const sends = [...room.matchAll(/client\.send\(([^,]+),/g)].map((m) => m[1].trim());
check(
  "the server sends exactly two kinds of message, both to one client",
  sends.length === 2 &&
    sends.every((s) => s.startsWith("ServerMessage.")) &&
    !room.includes("this.broadcast("),
  sends.join(", "),
);

// A rejection is a sentence for a human. One that quoted a card would be a
// leak through the one channel nobody thinks of as a channel.
const reasons = [
  ...room.matchAll(/reject\(client,\s*"([^"]+)"/g),
  ...read("server", "src", "poker", "engine.ts").matchAll(/reason: [`"]([^`"]+)/g),
].map((m) => m[1]);
check(
  "no rejection reason can quote a card",
  reasons.every((r) => !/\b(hole|card|deck|suit|rank)\b/i.test(r)),
  reasons.filter((r) => /\b(hole|card|deck|suit|rank)\b/i.test(r)).join(" | "),
);

// The datagram channel bypasses the server entirely, so the closed union is
// the only thing keeping game state off it.
const provider = read("client", "src", "media", "MediaProvider.ts");
check(
  "the client-to-client datagram channel still carries exactly one topic",
  /export type DatagramTopic = "facebox";/.test(provider),
);

// No A/V is recorded or persisted, anywhere (spec section 16).
const clientSources = [
  "client/src/media/LiveKitProvider.ts",
  "client/src/media/useMedia.ts",
  "client/src/media/permissions.ts",
  "client/src/avatars/useFaceTexture.ts",
  "client/src/avatars/faceTracker.ts",
]
  .map((path) => read(...path.split("/")))
  .join("\n");
check(
  "nothing records or stores camera, microphone or voice data",
  !/MediaRecorder|captureStream\(|toDataURL|indexedDB/.test(clientSources),
);

// The duplicate-tab channel is same-origin and reaches every tab of this site.
// What it may carry is therefore worth stating: a room code, which is already
// in that browser's address bar, and never the reconnection token, which is a
// credential that would hand somebody the seat and the hole-card view with it.
const tabLock = read("client", "src", "net", "tabLock.ts");
check(
  "the duplicate-tab channel carries a room code and nothing else",
  /kind: "claim" \| "here" \| "release";/.test(tabLock) &&
    !/token|reconnect|sessionId/i.test(
      tabLock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, ""),
    ),
);

// And it is advisory: a stale claim from a tab that crashed must never be able
// to lock a person out of their own table.
let conflicted = false;
claimTable({
  code: "ABCDEF",
  channel: null,
  onConflict: () => {
    conflicted = true;
  },
});
check(
  "a browser with no BroadcastChannel can still play poker",
  conflicted === false,
);

// ---------------------------------------------------- 6. browser matrix

section("The browser matrix is probed, not guessed");

const MODERN = {
  secureContext: true,
  webgl2: true,
  getUserMedia: true,
  webrtc: true,
  webSocket: true,
  webAudio: true,
  broadcastChannel: true,
  videoFrameCallback: true,
};
check(
  "a complete browser is told nothing",
  supportHeadline(assessSupport(MODERN)) === null,
);
check(
  "Firefox's missing rVFC is not reported as a problem",
  assessSupport({ ...MODERN, videoFrameCallback: false }).level === "ready",
);
check(
  "an insecure origin leads, because it causes the rest",
  assessSupport({
    ...MODERN,
    secureContext: false,
    getUserMedia: false,
    webrtc: false,
  }).blockers[0].id === "insecure-context",
);
check(
  "a player with no camera is seated rather than turned away",
  assessSupport({ ...MODERN, getUserMedia: false }).level === "degraded",
);
check(
  "a browser that cannot draw the room is told so before it tries",
  assessSupport({ ...MODERN, webgl2: false }).level === "unsupported",
);
check(
  "the lobby reports it, and never gates on it",
  read("client", "src", "ui", "Lobby.tsx").includes("supportHeadline"),
);

const browsers = read("docs", "BROWSERS.md");
check(
  "the matrix names every browser the spec targets",
  ["Chrome", "Safari", "Edge", "Firefox"].every((name) =>
    browsers.includes(name),
  ),
);

// ---------------------------------------------------------------- result

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
