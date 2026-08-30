import type { StreamQuality } from "./attention.js";

/**
 * How much this machine is asked to draw, and who decides.
 *
 * Spec section 12 asks for a quality setting plus an automatic fallback for
 * weak GPUs. Both are here, and the whole module is pure: it takes numbers in
 * and returns a tier, so the ladder can be walked in a test rather than
 * discovered on somebody's laptop halfway through a hand.
 *
 * Three decisions shape it.
 *
 * **The tier is one object, not a scatter of conditionals.** Everything a tier
 * changes is declared in one `QualityProfile`, so "medium" is a thing a person
 * can read rather than five branches spread across the scene. A knob that is
 * not in the profile is not part of the quality system, which is the same rule
 * `decor.ts` applies to fixtures and for the same reason: a rule with two
 * lists is a rule with a hole in it.
 *
 * **The probe is a starting guess and the frame clock is the authority.** No
 * amount of `deviceMemory` and `hardwareConcurrency` tells you what a browser
 * will actually do with eight video decodes and a shadow map, and the one
 * number that does - how long a frame took - is only available after the scene
 * is running. So the probe picks somewhere plausible to start, and the sampler
 * below moves off it within a couple of seconds either way.
 *
 * **Stepping down is cheap and stepping up is expensive.** A tier that
 * oscillates is worse than either of the tiers it alternates between: every
 * step reallocates a shadow map and renegotiates video layers. So the two
 * directions are deliberately asymmetric - a drop needs a short window of
 * clearly bad frames, a promotion needs a much longer window of clearly good
 * ones, and a session that has been demoted twice stops trying to climb back.
 *
 * The one thing that is *not* adaptive is `antialias`. Multisampling belongs
 * to the WebGL context and cannot be changed after it is created (see the note
 * in `Room3D`), so it is read from the profile at first render and then fixed
 * for the life of the canvas.
 */

export type QualityTier = "high" | "medium" | "low";

/** What a player can choose. `auto` hands the decision to this module. */
export type QualitySetting = "auto" | QualityTier;

export const QUALITY_SETTINGS: readonly QualitySetting[] = [
  "auto",
  "high",
  "medium",
  "low",
];

export function isQualitySetting(value: unknown): value is QualitySetting {
  return (
    typeof value === "string" &&
    (QUALITY_SETTINGS as readonly string[]).includes(value)
  );
}

export interface QualityProfile {
  tier: QualityTier;
  /**
   * `[min, max]` device pixel ratio for the canvas. A Retina MacBook Air
   * renders four times the pixels for a difference nobody sees on a stylised
   * scene, so even `high` is capped well below the display's own ratio.
   */
  dpr: [number, number];
  /** The pooled key light casts a real shadow. The most expensive single item. */
  shadows: boolean;
  /** Shadow map edge, in texels. Ignored when `shadows` is false. */
  shadowMapSize: number;
  /**
   * Multisampling. Read once, at context creation, and never again - see the
   * module note above.
   */
  antialias: boolean;
  /**
   * The best simulcast layer any face may be promoted to, whatever the
   * attention director asks for.
   *
   * This is the lever that actually matters on a weak machine. Eight
   * simultaneous video decodes cost more than everything else in the frame put
   * together, and unlike a shadow map that cost is paid on the CPU, where a
   * laptop under thermal pressure has the least left to give.
   */
  videoCeiling: StreamQuality;
}

const HIGH: QualityProfile = {
  tier: "high",
  dpr: [1, 1.75],
  shadows: true,
  shadowMapSize: 1024,
  antialias: true,
  videoCeiling: "high",
};

const MEDIUM: QualityProfile = {
  tier: "medium",
  dpr: [1, 1.35],
  shadows: true,
  // Half the edge is a quarter of the texels, and what this light casts is a
  // soft pool under a table rather than a hard edge anybody inspects.
  shadowMapSize: 512,
  antialias: true,
  videoCeiling: "high",
};

const LOW: QualityProfile = {
  tier: "low",
  // Below 1 on purpose: a machine that has fallen this far is better off
  // drawing fewer pixels and upscaling them than dropping frames, because the
  // thing this product cannot afford to lose is the *motion* of a face.
  dpr: [0.75, 1],
  shadows: false,
  shadowMapSize: 512,
  antialias: false,
  // The faces stay. What goes is the top rung: at `medium` a face you are
  // looking straight at is h180, which is still a face, and it halves the
  // decode for the one seat that was paying capture resolution.
  videoCeiling: "medium",
};

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  high: HIGH,
  medium: MEDIUM,
  low: LOW,
};

/** Worst to best, so a tier can be stepped by index. */
export const TIER_ORDER: readonly QualityTier[] = ["low", "medium", "high"];

/** Step `tier` by `delta` rungs, clamped at both ends. */
export function stepTier(tier: QualityTier, delta: number): QualityTier {
  const index = TIER_ORDER.indexOf(tier);
  const next = Math.min(TIER_ORDER.length - 1, Math.max(0, index + delta));
  return TIER_ORDER[next]!;
}

/** True when `a` is a better tier than `b`. */
export function isBetterTier(a: QualityTier, b: QualityTier): boolean {
  return TIER_ORDER.indexOf(a) > TIER_ORDER.indexOf(b);
}

/**
 * The best video layer allowed, given a profile. A ceiling, never a floor: a
 * face the director wants at `low` stays at `low`.
 */
export function capStream(
  wanted: StreamQuality,
  profile: QualityProfile,
): StreamQuality {
  const order: readonly StreamQuality[] = ["low", "medium", "high"];
  const ceiling = order.indexOf(profile.videoCeiling);
  return order[Math.min(order.indexOf(wanted), ceiling)]!;
}

// ------------------------------------------------------------------ probe

/**
 * What can be asked about a machine before drawing anything.
 *
 * Every field is optional because every one of them is optional in some
 * browser we ship to: Safari reports neither `deviceMemory` nor a renderer
 * string, and `WEBGL_debug_renderer_info` is being removed from the platform
 * for fingerprinting reasons. So this is a guess assembled from whatever
 * happened to be available, which is exactly why it is only a starting point.
 */
export interface DeviceCaps {
  /** `navigator.hardwareConcurrency`. */
  cores?: number | undefined;
  /** `navigator.deviceMemory`, in GB. Chromium only. */
  memoryGb?: number | undefined;
  /** A phone: small screen with a finger on it. From `ui/viewport.ts`. */
  handheld?: boolean | undefined;
  /** `UNMASKED_RENDERER_WEBGL`, where the browser still reports it. */
  renderer?: string | undefined;
  /** False when the context is WebGL 1, or absent entirely. */
  webgl2?: boolean | undefined;
}

/**
 * Renderer substrings that mean "there is no GPU here".
 *
 * A software rasteriser will run this scene at single-digit frames whatever
 * the tier, but starting it at `low` means the first thing a person sees is a
 * room rather than a slideshow, and the sampler does not have to spend two
 * seconds discovering it. Matched case-insensitively, because the renderer
 * string is free-form vendor text.
 */
const SOFTWARE_RENDERERS = [
  "swiftshader",
  "llvmpipe",
  "software",
  "microsoft basic render",
  "generic renderer",
];

export function isSoftwareRenderer(renderer: string | undefined): boolean {
  if (!renderer) return false;
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERERS.some((needle) => lower.includes(needle));
}

/**
 * Where to start, before a single frame has been drawn.
 *
 * Deliberately conservative in one direction only. Starting too low costs a
 * couple of seconds of a slightly softer room before the sampler promotes;
 * starting too high costs a couple of seconds of dropped frames during the
 * exact moment somebody is deciding whether this thing works, which is the
 * more expensive mistake by a distance.
 */
export function probeTier(caps: DeviceCaps): QualityTier {
  if (caps.webgl2 === false) return "low";
  if (isSoftwareRenderer(caps.renderer)) return "low";
  // A handset spends its whole budget on the faces, which are the product,
  // long before it gets to a contact shadow under a chip. This is the same
  // verdict the `lite` flag used to carry on its own.
  if (caps.handheld) return "low";
  if (caps.memoryGb !== undefined && caps.memoryGb <= 4) return "medium";
  if (caps.cores !== undefined && caps.cores <= 4) return "medium";
  return "high";
}

// ---------------------------------------------------------------- sampler

/**
 * Frame time above which the tier steps down, in milliseconds.
 *
 * 60 FPS is 16.7ms and it is the target, but a tier change is disruptive
 * enough that it must not fire on a machine merely *near* the line. 22ms is
 * about 45 FPS: still playable, clearly not the target, and far enough above
 * 16.7 that ordinary jitter never reaches it.
 */
export const DEMOTE_MS = 22;

/**
 * Frame time below which a promotion is considered. Well under the target,
 * because the machine has to have room for the *next* tier's extra cost, not
 * merely for the one it is already on.
 */
export const PROMOTE_MS = 13;

/** How long frames must stay bad before dropping a tier. */
export const DEMOTE_WINDOW_MS = 2_000;

/**
 * How long they must stay good before climbing one.
 *
 * Six times the demotion window, and that ratio is the whole anti-oscillation
 * argument: a machine that is borderline trips the fast rule and never the
 * slow one, so it settles on the lower tier instead of alternating.
 */
export const PROMOTE_WINDOW_MS = 12_000;

/**
 * Frames ignored after any tier change.
 *
 * Changing tier reallocates a shadow map and renegotiates video layers, and
 * the frames during which that happens are the slowest of the session.
 * Judging the new tier by them would demote straight through the floor.
 */
export const SETTLE_MS = 1_500;

/**
 * How many times a session may be demoted before it stops trying to climb.
 *
 * A machine that has been demoted twice is not having a bad second, it is a
 * machine, and re-testing it every twelve seconds for an hour is a stutter on
 * a schedule.
 */
export const MAX_DEMOTIONS_BEFORE_GIVING_UP = 2;

export interface QualityMonitor {
  /** The tier in force. */
  tier: QualityTier;
  /** Best tier this session may return to. The probe's answer. */
  ceiling: QualityTier;
  /** Milliseconds of samples accumulated in each direction. */
  goodMs: number;
  badMs: number;
  /** Time left to ignore after a change. */
  settleMs: number;
  /** How many times this session has stepped down. */
  demotions: number;
}

export function newMonitor(start: QualityTier): QualityMonitor {
  return {
    tier: start,
    ceiling: start,
    goodMs: 0,
    badMs: 0,
    settleMs: SETTLE_MS,
    demotions: 0,
  };
}

/**
 * Feed one frame in and get the monitor back.
 *
 * Returns a *new* object when the tier changed and the identical one
 * otherwise, so a caller can compare by identity to decide whether React needs
 * to hear about it. That is the reason this is a pure function rather than a
 * hook: the sampler runs sixty times a second inside `useFrame`, and the scene
 * may not set React state per frame.
 *
 * `dtMs` is clamped before it is counted. A backgrounded tab hands back a
 * delta of several seconds on its first frame when it returns, and one of
 * those would otherwise fill the demotion window on its own and drop a
 * perfectly healthy machine a tier for having been behind another window.
 */
export function sampleFrame(
  monitor: QualityMonitor,
  dtMs: number,
): QualityMonitor {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return monitor;
  // 100ms is 10 FPS. Anything slower is a stall rather than a frame rate, and
  // the ceiling means one stall counts as one bad frame rather than as two
  // seconds of them.
  const dt = Math.min(dtMs, 100);

  if (monitor.settleMs > 0) {
    monitor.settleMs -= dt;
    return monitor;
  }

  if (dt >= DEMOTE_MS) {
    monitor.badMs += dt;
    monitor.goodMs = 0;
  } else if (dt <= PROMOTE_MS) {
    monitor.goodMs += dt;
    monitor.badMs = 0;
  } else {
    // Between the two thresholds: the machine is doing fine and is not asking
    // for more. Neither counter advances, which is what makes that band a
    // resting place rather than a slow drift towards promotion.
    monitor.badMs = 0;
    monitor.goodMs = 0;
  }

  if (monitor.badMs >= DEMOTE_WINDOW_MS && monitor.tier !== "low") {
    return {
      tier: stepTier(monitor.tier, -1),
      ceiling: monitor.ceiling,
      goodMs: 0,
      badMs: 0,
      settleMs: SETTLE_MS,
      demotions: monitor.demotions + 1,
    };
  }

  const mayClimb =
    monitor.demotions < MAX_DEMOTIONS_BEFORE_GIVING_UP &&
    isBetterTier(monitor.ceiling, monitor.tier);

  if (mayClimb && monitor.goodMs >= PROMOTE_WINDOW_MS) {
    return {
      tier: stepTier(monitor.tier, 1),
      ceiling: monitor.ceiling,
      goodMs: 0,
      badMs: 0,
      settleMs: SETTLE_MS,
      // Not reset. A session that has been demoted keeps that on its record,
      // so the demotion after this one is the one that ends the climbing.
      demotions: monitor.demotions,
    };
  }

  return monitor;
}

/**
 * The profile in force, given what the player chose and what the monitor says.
 *
 * An explicit choice wins outright, including upwards: someone who picks High
 * on a machine the probe called weak gets High and keeps it. This is the
 * "quality setting" half of spec section 12, and a setting a heuristic can
 * override is not a setting.
 */
export function resolveProfile(
  setting: QualitySetting,
  monitor: QualityMonitor,
): QualityProfile {
  return QUALITY_PROFILES[setting === "auto" ? monitor.tier : setting];
}
