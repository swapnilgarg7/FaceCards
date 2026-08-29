import type { FaceDetector, Detection } from "@mediapipe/tasks-vision";
import { sanitiseFaceBox, type FaceBox } from "../scene/faceBox.js";

/**
 * MediaPipe face detection on the local camera.
 *
 * Runs on exactly one video element per client: your own. Everyone else's
 * framing arrives over the wire already measured, for the reasons in
 * `scene/faceBox.ts`.
 *
 * The model is BlazeFace short-range, the same family Meet and every other
 * browser video app uses, chosen over the full face landmarker because a
 * quarter-megabyte detector that returns six keypoints is enough to frame a
 * head, and the landmarker is fifteen times the download for 478 points we
 * would throw away. The six include both eyes, which is what actually matters:
 * framing on the eye line looks composed, framing on the box centre looks like
 * a security camera.
 *
 * Everything here is best-effort. A machine where the model will not load, or
 * the GPU delegate will not initialise, or detection throws, is a machine that
 * quietly goes back to the fixed crop. Tracking is an improvement to framing,
 * never a requirement for seeing a face.
 */

/** Served from `client/public/mediapipe`; see `scripts/copy-mediapipe-wasm.mjs`. */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const WASM_PATH = `${base}/mediapipe/wasm`;
const MODEL_PATH = `${base}/mediapipe/blaze_face_short_range.tflite`;

/**
 * Detections per second.
 *
 * Not 60. A face does not move meaningfully between two frames at 60 Hz, the
 * smoothing interpolates the gaps anyway, and the whole point of the exercise
 * is to spend a fraction of a millisecond per frame rather than three. Twelve
 * is comfortably faster than anyone turns their head.
 */
const DETECT_HZ = 12;
const DETECT_INTERVAL_MS = 1000 / DETECT_HZ;

/**
 * Slack on the interval check, because the two clocks driving it are not the
 * one it is measured against. A timer that fires a millisecond early, or a
 * video frame that lands just short of the boundary, would otherwise fail the
 * test and wait a whole interval more, halving the real detection rate.
 */
const DETECT_INTERVAL_SLACK_MS = 4;

/**
 * Consecutive failures before giving up for the session. A detector that
 * throws once is a hiccup; one that throws ten times in a row is a machine
 * that is not going to run this model today, and retrying forever at 12 Hz is
 * a battery drain nobody asked for.
 */
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * Vertical offset from the eye line to the centre of the crop window, as a
 * fraction of face height. Positive pushes the window down, which puts the
 * eyes above the middle of the oval - the framing every portrait uses, and the
 * difference between someone looking at you and someone floating.
 */
const EYE_LINE_BIAS = 0.22;

/** BlazeFace keypoint order: right eye, left eye, nose, mouth, two tragions. */
const KEYPOINT_RIGHT_EYE = 0;
const KEYPOINT_LEFT_EYE = 1;

/** Where the tracker is in its life. Reported so a dev readout can say so. */
export type FaceTrackerState = "loading" | "running" | "unavailable";

export interface FaceTrackerOptions {
  /**
   * Called at roughly `DETECT_HZ`, with `null` when no face is in frame. It is
   * called on the heartbeat either way: silence is how a receiver detects a
   * dead tracker, so it must not also mean "looked away".
   */
  onBox(box: FaceBox | null): void;
  /** Called once if tracking cannot run at all, so the caller can stop trying. */
  onUnavailable?(reason: string): void;
  /** Lifecycle, for diagnostics. Never fires more than a handful of times. */
  onState?(state: FaceTrackerState, reason?: string): void;
}

export interface FaceTrackerHandle {
  stop(): void;
}

/**
 * How long to wait for a quiet frame before loading the detector, before
 * giving up and loading it anyway. A room that never goes idle - someone
 * talking with five avatars breathing - would otherwise never start tracking.
 */
const IDLE_DEADLINE_MS = 2000;

/** Resolves on the first idle period, or at the deadline, whichever is first. */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: IDLE_DEADLINE_MS });
      return;
    }
    // Safari has no requestIdleCallback. A plain delay is a poorer signal but
    // still moves the stall off the moment the room appears.
    setTimeout(resolve, IDLE_DEADLINE_MS);
  });
}

/**
 * `requestVideoFrameCallback` is the right clock here: it fires when the
 * decoder produces a frame, so a camera delivering 30 fps is not polled 60
 * times a second, and a hidden tab stops on its own. It is not in every
 * browser we target, hence the interval fallback.
 */
type FrameScheduler = {
  schedule(fn: () => void): void;
  cancel(): void;
};

function frameScheduler(video: HTMLVideoElement): FrameScheduler {
  if (typeof video.requestVideoFrameCallback === "function") {
    let handle: number | null = null;
    return {
      schedule(fn) {
        handle = video.requestVideoFrameCallback(() => {
          handle = null;
          fn();
        });
      },
      cancel() {
        if (handle !== null) video.cancelVideoFrameCallback(handle);
        handle = null;
      },
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn) {
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, DETECT_INTERVAL_MS);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Pick which face is *the* face.
 *
 * Nearest to the last accepted centre, because the alternative - largest, or
 * first - hands the crop to whoever walks through the room behind you, and an
 * avatar that suddenly wears a flatmate's face is the kind of bug people
 * remember. With no history yet, largest is the best guess: the person at the
 * desk is nearer the camera than anyone behind them.
 */
function pickFace(
  detections: Detection[],
  previous: FaceBox | null,
  frameWidth: number,
  frameHeight: number,
): Detection | null {
  let best: Detection | null = null;
  let bestScore = Infinity;

  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box || box.height <= 0 || box.width <= 0) continue;

    if (!previous) {
      // Negated so that "smallest score wins" still holds for both branches.
      const score = -box.height;
      if (score < bestScore) {
        bestScore = score;
        best = detection;
      }
      continue;
    }

    const cx = (box.originX + box.width / 2) / frameWidth;
    const cy = (box.originY + box.height / 2) / frameHeight;
    const score = Math.hypot(cx - previous.cx, cy - previous.cy);
    if (score < bestScore) {
      bestScore = score;
      best = detection;
    }
  }

  return best;
}

/**
 * Detection -> framing target, in normalised source-frame coordinates.
 *
 * Note the two coordinate systems MediaPipe hands back: `boundingBox` is in
 * pixels, `keypoints` are already normalised. Mixing them up puts the crop in
 * the top-left corner of the frame, which is a very fast bug to introduce and
 * a slow one to see.
 */
function toFaceBox(
  detection: Detection,
  frameWidth: number,
  frameHeight: number,
): FaceBox | null {
  const box = detection.boundingBox;
  if (!box) return null;

  const height = box.height / frameHeight;

  const rightEye = detection.keypoints[KEYPOINT_RIGHT_EYE];
  const leftEye = detection.keypoints[KEYPOINT_LEFT_EYE];

  let cx: number;
  let cy: number;
  if (rightEye && leftEye) {
    cx = (rightEye.x + leftEye.x) / 2;
    cy = (rightEye.y + leftEye.y) / 2 + height * EYE_LINE_BIAS;
  } else {
    // No keypoints is not a documented outcome, but the field is typed as a
    // list and an empty list costs one branch to survive.
    cx = (box.originX + box.width / 2) / frameWidth;
    cy = (box.originY + box.height / 2) / frameHeight;
  }

  return sanitiseFaceBox({ cx, cy, h: height });
}

/**
 * Start tracking `video`. The element belongs to the media provider; this
 * never attaches, moves or removes it, it only reads frames from it.
 */
export function startFaceTracker(
  video: HTMLVideoElement,
  { onBox, onUnavailable, onState }: FaceTrackerOptions,
): FaceTrackerHandle {
  let stopped = false;
  let detector: FaceDetector | null = null;
  const scheduler = frameScheduler(video);

  let previous: FaceBox | null = null;
  let running = false;
  let lastDetectAt = 0;
  // MediaPipe's video mode requires strictly increasing timestamps and throws
  // if it gets the same millisecond twice, which two frames inside one tick
  // will happily do.
  let lastTimestamp = 0;
  let consecutiveErrors = 0;

  const giveUp = (reason: string) => {
    if (stopped) return;
    stopped = true;
    scheduler.cancel();
    detector?.close();
    detector = null;
    onState?.("unavailable", reason);
    onUnavailable?.(reason);
  };

  const tick = () => {
    if (stopped || !detector) return;

    const now = performance.now();
    const width = video.videoWidth;
    const height = video.videoHeight;

    // Skip rather than stop: a paused or not-yet-sized element is a normal
    // moment during a camera switch, not a reason to end the session.
    const ready = width > 0 && height > 0 && !video.paused && !video.ended;

    if (
      ready &&
      now - lastDetectAt >= DETECT_INTERVAL_MS - DETECT_INTERVAL_SLACK_MS
    ) {
      lastDetectAt = now;
      const timestamp = Math.max(now, lastTimestamp + 1);
      lastTimestamp = timestamp;

      try {
        const result = detector.detectForVideo(video, timestamp);
        consecutiveErrors = 0;
        if (!running) {
          // "Running" means a frame actually went through the graph, not that
          // the detector was constructed. Those are different, and the gap
          // between them is where a broken camera hides.
          running = true;
          onState?.("running");
        }

        const chosen = pickFace(result.detections, previous, width, height);
        const box = chosen ? toFaceBox(chosen, width, height) : null;
        if (box) previous = box;
        onBox(box);
      } catch (err) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          giveUp(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    }

    scheduler.schedule(tick);
  };

  onState?.("loading");

  void (async () => {
    try {
      // Deferred to an idle moment. Instantiating the wasm runtime and, more
      // expensively, creating the GPU delegate are synchronous work on the
      // same thread as the render loop, and this hook mounts alongside a
      // Canvas that is already animating. Doing it eagerly puts a stall
      // exactly when someone sits down, which is the worst moment this app
      // has. A second or two of fixed crop first is not a cost anyone notices.
      await whenIdle();
      if (stopped) return;

      // Dynamic, so the wasm runtime and its ~9 MB binary are not in the
      // bundle everyone downloads before they can see the lobby.
      const { FaceDetector, FilesetResolver } = await import(
        "@mediapipe/tasks-vision"
      );
      if (stopped) return;

      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      if (stopped) return;

      const create = (delegate: "GPU" | "CPU") =>
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });

      // GPU is several times cheaper, and unavailable often enough - remote
      // desktops, blocklisted drivers, a browser that has run out of WebGL
      // contexts - that falling back is not a hypothetical.
      let created: FaceDetector;
      try {
        created = await create("GPU");
      } catch {
        created = await create("CPU");
      }

      if (stopped) {
        created.close();
        return;
      }

      detector = created;
      scheduler.schedule(tick);
    } catch (err) {
      giveUp(err instanceof Error ? err.message : String(err));
    }
  })();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      scheduler.cancel();
      detector?.close();
      detector = null;
    },
  };
}
