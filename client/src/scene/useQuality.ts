import { useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  isQualitySetting,
  newMonitor,
  probeTier,
  resolveProfile,
  sampleFrame,
  type DeviceCaps,
  type QualityMonitor,
  type QualityProfile,
  type QualitySetting,
  type QualityTier,
} from "./quality.js";

/**
 * The quality tier, bound to a real renderer.
 *
 * Everything that can be decided without a browser is in `quality.ts` and is
 * tested there. This file is the three things that cannot be: asking the
 * platform what it is, remembering what the player chose, and feeding the
 * frame clock in.
 *
 * The division of labour with `Room3D` is deliberate. The monitor is fed from
 * inside `useFrame`, sixty times a second, and the scene may not set React
 * state per frame - so the samples land in a ref and React only hears about it
 * on the rare frame where the tier actually changes. That is the whole reason
 * `sampleFrame` returns the same object when nothing moved.
 */

const QUALITY_KEY = "facecards.quality";

/**
 * A setting that forgets itself on every reload is a bug with extra steps.
 * Storage can throw outright in a private window or with site data blocked, so
 * every access is guarded and the default is always usable - the same rule the
 * look sensitivity and the standings column follow.
 */
export function loadQualitySetting(): QualitySetting {
  try {
    const raw = window.localStorage.getItem(QUALITY_KEY);
    // A value written by an older build is not a value this one ships.
    return isQualitySetting(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function saveQualitySetting(setting: QualitySetting): void {
  try {
    window.localStorage.setItem(QUALITY_KEY, setting);
  } catch {
    // Not worth surfacing: the setting still applies for this session.
  }
}

/**
 * What the platform will admit to, before a frame has been drawn.
 *
 * The renderer string is the one genuinely valuable signal here - it is what
 * separates a real GPU from SwiftShader, which is what hardware acceleration
 * being switched off looks like from inside the page - and it is also the one
 * being removed from the platform for fingerprinting reasons. So it is read
 * defensively and every field is optional; `probeTier` is built to answer with
 * whatever survives.
 *
 * The context is created and immediately lost. Browsers cap live WebGL
 * contexts at around sixteen, and a probe that leaked one per mount would
 * eventually break the thing it exists to protect.
 */
function probeDeviceCaps(handheld: boolean): DeviceCaps {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let renderer: string | undefined;
  let webgl2 = false;

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webgl2 = gl !== null;
    if (gl) {
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (debug) {
        const value = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
        if (typeof value === "string") renderer = value;
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // A browser that will not create a context has answered the question.
    webgl2 = false;
  }

  return {
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    handheld,
    renderer,
    webgl2,
  };
}

export interface UseQuality {
  setting: QualitySetting;
  choose(setting: QualitySetting): void;
  /** What is actually in force. Follows the monitor only on `auto`. */
  profile: QualityProfile;
  /** What the automatic fallback currently believes, whatever the setting. */
  autoTier: QualityTier;
  /**
   * Feed one frame in. Stable across renders, because it is called from inside
   * `useFrame`: a new identity every render would re-subscribe the frame loop.
   */
  sample(dtMs: number): void;
}

export function useQuality(handheld: boolean): UseQuality {
  const [setting, setSetting] = useState<QualitySetting>(loadQualitySetting);
  // Probed once per table, not per render: it creates a WebGL context.
  const start = useMemo(() => probeTier(probeDeviceCaps(handheld)), [handheld]);
  const monitorRef = useRef<QualityMonitor>(newMonitor(start));
  const [autoTier, setAutoTier] = useState<QualityTier>(start);

  const sample = useCallback((dtMs: number) => {
    const before = monitorRef.current;
    const after = sampleFrame(before, dtMs);
    monitorRef.current = after;
    // Identity, not a field comparison. `sampleFrame` returns the same object
    // on every ordinary frame and a new one only when the tier moved, which is
    // what keeps this out of React's way sixty times a second.
    if (after !== before) setAutoTier(after.tier);
  }, []);

  const choose = useCallback((next: QualitySetting) => {
    setSetting(next);
    saveQualitySetting(next);
  }, []);

  const profile = useMemo(
    () => resolveProfile(setting, monitorRef.current),
    // `autoTier` is the dependency that matters even though it is not read:
    // the monitor is a ref, so this is the only thing that says it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setting, autoTier],
  );

  return { setting, choose, profile, autoTier, sample };
}

/**
 * The frame clock, as a component, because `useFrame` only works inside the
 * Canvas and the quality state has to live outside it.
 *
 * Renders nothing and never re-renders: `sample` is stable and the work it
 * does is a couple of additions against a ref.
 */
export function FrameSampler({ sample }: { sample(dtMs: number): void }) {
  useFrame((_, delta) => sample(delta * 1000));
  return null;
}
