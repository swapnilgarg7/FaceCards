import { describe, expect, it } from "vitest";
import {
  DEMOTE_MS,
  DEMOTE_WINDOW_MS,
  MAX_DEMOTIONS_BEFORE_GIVING_UP,
  PROMOTE_MS,
  PROMOTE_WINDOW_MS,
  QUALITY_PROFILES,
  SETTLE_MS,
  TIER_ORDER,
  capStream,
  isBetterTier,
  isQualitySetting,
  isSoftwareRenderer,
  newMonitor,
  probeTier,
  resolveProfile,
  sampleFrame,
  stepTier,
  type QualityMonitor,
  type QualityTier,
} from "./quality.js";

/** Feed `ms` of frames at `dtMs` each and return where the monitor ended up. */
function run(
  monitor: QualityMonitor,
  dtMs: number,
  ms: number,
): QualityMonitor {
  let current = monitor;
  for (let elapsed = 0; elapsed < ms; elapsed += dtMs) {
    current = sampleFrame(current, dtMs);
  }
  return current;
}

/** Past the settle window, so the next frame is actually counted. */
function settled(tier: QualityTier): QualityMonitor {
  return run(newMonitor(tier), 16, SETTLE_MS + 100);
}

describe("profiles", () => {
  it("gets cheaper in every dimension as the tier drops", () => {
    const [low, medium, high] = TIER_ORDER.map((t) => QUALITY_PROFILES[t]!);
    expect(low!.dpr[1]).toBeLessThan(medium!.dpr[1]);
    expect(medium!.dpr[1]).toBeLessThan(high!.dpr[1]);
    // A ladder that goes back up somewhere is not a ladder. Shadows may only
    // ever be turned off going down, and the video ceiling may only fall.
    expect(low!.shadows).toBe(false);
    expect(medium!.shadows).toBe(true);
    expect(high!.shadows).toBe(true);
    expect(medium!.shadowMapSize).toBeLessThanOrEqual(high!.shadowMapSize);
  });

  it("keeps a face on every tier: nothing turns video off", () => {
    // The one thing the fallback may never do is stop showing people. Even the
    // floor keeps a real layer for whoever you are looking at.
    for (const tier of TIER_ORDER) {
      expect(QUALITY_PROFILES[tier].videoCeiling).not.toBe("low");
    }
  });

  it("declares its own tier, so a profile cannot be filed under the wrong one", () => {
    for (const tier of TIER_ORDER) {
      expect(QUALITY_PROFILES[tier].tier).toBe(tier);
    }
  });
});

describe("tier arithmetic", () => {
  it("steps and clamps at both ends", () => {
    expect(stepTier("high", -1)).toBe("medium");
    expect(stepTier("medium", -1)).toBe("low");
    expect(stepTier("low", -1)).toBe("low");
    expect(stepTier("low", 1)).toBe("medium");
    expect(stepTier("high", 1)).toBe("high");
  });

  it("orders tiers worst to best", () => {
    expect(isBetterTier("high", "low")).toBe(true);
    expect(isBetterTier("low", "high")).toBe(false);
    expect(isBetterTier("medium", "medium")).toBe(false);
  });
});

describe("capStream", () => {
  it("caps a request without ever raising one", () => {
    const low = QUALITY_PROFILES.low;
    expect(capStream("high", low)).toBe("medium");
    expect(capStream("medium", low)).toBe("medium");
    // The whole point: a peripheral face stays cheap. A ceiling is not a
    // floor, and a director asking for `low` must never be answered with more.
    expect(capStream("low", low)).toBe("low");
  });

  it("is the identity at the top tier", () => {
    const high = QUALITY_PROFILES.high;
    for (const wanted of ["low", "medium", "high"] as const) {
      expect(capStream(wanted, high)).toBe(wanted);
    }
  });
});

describe("probeTier", () => {
  it("starts a well-equipped desktop at the top", () => {
    expect(probeTier({ cores: 10, memoryGb: 16, webgl2: true })).toBe("high");
  });

  it("does not need any of the fields to answer", () => {
    // Safari reports neither `deviceMemory` nor a renderer string. An absent
    // signal is not evidence of a weak machine.
    expect(probeTier({})).toBe("high");
  });

  it("puts a handset on the floor", () => {
    expect(probeTier({ cores: 8, memoryGb: 8, handheld: true })).toBe("low");
  });

  it("puts a software rasteriser on the floor whatever else it claims", () => {
    expect(
      probeTier({ cores: 16, memoryGb: 32, renderer: "Google SwiftShader" }),
    ).toBe("low");
    expect(probeTier({ cores: 16, renderer: "llvmpipe (LLVM 15.0.7)" })).toBe(
      "low",
    );
  });

  it("puts a thin machine in the middle", () => {
    expect(probeTier({ cores: 4, memoryGb: 8 })).toBe("medium");
    expect(probeTier({ cores: 8, memoryGb: 4 })).toBe("medium");
  });

  it("treats no WebGL 2 as the floor", () => {
    expect(probeTier({ cores: 16, memoryGb: 32, webgl2: false })).toBe("low");
  });
});

describe("isSoftwareRenderer", () => {
  it("matches whatever case the driver felt like", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan, SwiftShader Device)")).toBe(
      true,
    );
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
  });

  it("does not match a real GPU", () => {
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (NVIDIA GeForce RTX 3060)")).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
  });
});

describe("sampleFrame", () => {
  it("ignores everything inside the settle window", () => {
    // Every frame here is catastrophic, and none of them counts: this is the
    // window during which the shadow map is being reallocated.
    const after = run(newMonitor("high"), 50, SETTLE_MS - 100);
    expect(after.tier).toBe("high");
    expect(after.badMs).toBe(0);
  });

  it("demotes after a sustained run of bad frames", () => {
    const after = run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100);
    expect(after.tier).toBe("medium");
    expect(after.demotions).toBe(1);
  });

  it("does not demote on a short burst", () => {
    // Half the window of bad frames, then good ones. A hand being dealt is
    // more expensive than the frames around it and must not cost a tier.
    let m = run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS / 2);
    expect(m.tier).toBe("high");
    m = sampleFrame(m, PROMOTE_MS - 1);
    expect(m.badMs).toBe(0);
    expect(m.tier).toBe("high");
  });

  it("never demotes below the floor", () => {
    const after = run(settled("low"), 60, DEMOTE_WINDOW_MS * 4);
    expect(after.tier).toBe("low");
    expect(after.demotions).toBe(0);
  });

  it("clamps a returning background tab so one stall cannot cost a tier", () => {
    // A tab that has been behind another window hands back a delta of several
    // seconds. Unclamped that is the whole demotion window in one frame.
    const after = sampleFrame(settled("high"), 8_000);
    expect(after.tier).toBe("high");
    expect(after.badMs).toBeLessThan(DEMOTE_WINDOW_MS);
  });

  it("ignores a nonsense delta rather than counting it", () => {
    const before = settled("high");
    expect(sampleFrame(before, 0)).toBe(before);
    expect(sampleFrame(before, -5)).toBe(before);
    expect(sampleFrame(before, Number.NaN)).toBe(before);
  });

  it("promotes only back towards the ceiling it started from", () => {
    // Demoted once, then the machine recovers: it climbs back to where the
    // probe put it.
    let m = run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100);
    expect(m.tier).toBe("medium");
    m = run(m, PROMOTE_MS - 3, SETTLE_MS + PROMOTE_WINDOW_MS + 200);
    expect(m.tier).toBe("high");
    // And no further: the ceiling is the ceiling.
    m = run(m, PROMOTE_MS - 3, SETTLE_MS + PROMOTE_WINDOW_MS * 2);
    expect(m.tier).toBe("high");
  });

  it("will not promote a session that started at the top of its own ceiling", () => {
    const m = run(settled("medium"), 8, PROMOTE_WINDOW_MS * 2);
    // `newMonitor("medium")` means the probe said medium, so medium is the
    // ceiling. Good frames are not evidence the probe was wrong about the GPU.
    expect(m.tier).toBe("medium");
  });

  it("stops climbing after too many demotions", () => {
    let m = settled("high");
    for (let i = 0; i < MAX_DEMOTIONS_BEFORE_GIVING_UP; i++) {
      m = run(m, DEMOTE_MS + 4, SETTLE_MS + DEMOTE_WINDOW_MS + 100);
    }
    expect(m.tier).toBe("low");
    expect(m.demotions).toBe(MAX_DEMOTIONS_BEFORE_GIVING_UP);
    // Now the machine looks fine for a very long time. It stays down anyway:
    // two demotions is a machine, not a bad second.
    m = run(m, 8, PROMOTE_WINDOW_MS * 4);
    expect(m.tier).toBe("low");
  });

  it("does not drift upwards from the band between the thresholds", () => {
    // Comfortably inside the target but with no headroom for the next tier's
    // extra cost. This is the resting place, and it must be stable.
    const between = (DEMOTE_MS + PROMOTE_MS) / 2;
    let m = run(settled("high"), DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100);
    expect(m.tier).toBe("medium");
    m = run(m, between, PROMOTE_WINDOW_MS * 3);
    expect(m.tier).toBe("medium");
  });

  it("returns the same object when nothing changed, and a new one when it did", () => {
    const before = settled("high");
    expect(sampleFrame(before, 8)).toBe(before);
    const changed = run(before, DEMOTE_MS + 4, DEMOTE_WINDOW_MS + 100);
    expect(changed).not.toBe(before);
  });
});

describe("resolveProfile", () => {
  it("follows the monitor on auto", () => {
    const m = newMonitor("medium");
    expect(resolveProfile("auto", m).tier).toBe("medium");
  });

  it("lets an explicit choice override the heuristic in both directions", () => {
    // A setting a heuristic can override is not a setting. Someone who picks
    // High on a machine the probe called weak gets High.
    const weak = newMonitor("low");
    expect(resolveProfile("high", weak).tier).toBe("high");
    const strong = newMonitor("high");
    expect(resolveProfile("low", strong).tier).toBe("low");
  });
});

describe("isQualitySetting", () => {
  it("accepts every setting and nothing else", () => {
    for (const value of ["auto", "high", "medium", "low"]) {
      expect(isQualitySetting(value)).toBe(true);
    }
    // A value read back out of localStorage from an older build.
    expect(isQualitySetting("ultra")).toBe(false);
    expect(isQualitySetting(null)).toBe(false);
    expect(isQualitySetting(2)).toBe(false);
  });
});
