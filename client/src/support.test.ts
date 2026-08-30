import { describe, expect, it } from "vitest";
import {
  assessSupport,
  supportHeadline,
  type Capabilities,
} from "./support.js";

/** Everything present: the desktop Chrome, Safari and Edge case. */
const MODERN: Capabilities = {
  secureContext: true,
  webgl2: true,
  getUserMedia: true,
  webrtc: true,
  webSocket: true,
  webAudio: true,
  broadcastChannel: true,
  videoFrameCallback: true,
};

const caps = (overrides: Partial<Capabilities>): Capabilities => ({
  ...MODERN,
  ...overrides,
});

describe("assessSupport", () => {
  it("says nothing about a browser with everything", () => {
    const report = assessSupport(MODERN);
    expect(report.level).toBe("ready");
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(supportHeadline(report)).toBeNull();
  });

  it("does not complain about a missing rVFC", () => {
    // Firefox has never shipped it, and its absence is genuinely harmless:
    // `useFaceTexture` drives uploads off a decoded-frame counter precisely
    // because rVFC could not be relied on even where it exists.
    const report = assessSupport(caps({ videoFrameCallback: false }));
    expect(report.level).toBe("ready");
  });

  it("blocks a page that cannot draw a room", () => {
    const report = assessSupport(caps({ webgl2: false }));
    expect(report.level).toBe("unsupported");
    expect(report.blockers.map((b) => b.id)).toContain("no-webgl2");
  });

  it("blocks a page with no socket and no WebRTC", () => {
    expect(assessSupport(caps({ webSocket: false })).level).toBe("unsupported");
    expect(assessSupport(caps({ webrtc: false })).level).toBe("unsupported");
  });

  it("leads with the insecure origin, because it causes the rest", () => {
    // A LAN address strips getUserMedia and more. Reporting "no camera API"
    // to somebody in that state would be true and useless.
    const lan = assessSupport(
      caps({ secureContext: false, getUserMedia: false, webrtc: false }),
    );
    expect(lan.blockers[0]?.id).toBe("insecure-context");
    expect(supportHeadline(lan)).toContain("https");
  });

  it("seats a player who cannot share a camera rather than turning them away", () => {
    // Being in the room is the product. Someone with no camera API can still
    // sit at the table, watch the hand, and hear everybody.
    const report = assessSupport(caps({ getUserMedia: false }));
    expect(report.level).toBe("degraded");
    expect(report.blockers).toEqual([]);
    expect(report.warnings.map((w) => w.id)).toContain("no-getusermedia");
  });

  it("warns rather than blocks on the things that only cost something", () => {
    for (const missing of [
      { webAudio: false },
      { broadcastChannel: false },
    ] satisfies Partial<Capabilities>[]) {
      expect(assessSupport(caps(missing)).level).toBe("degraded");
    }
  });

  it("names the duplicate-tab echo, which is what a missing channel costs", () => {
    const report = assessSupport(caps({ broadcastChannel: false }));
    expect(report.warnings.map((w) => w.id)).toContain("no-broadcastchannel");
    expect(supportHeadline(report)).toContain("echo");
  });

  it("reports a blocker ahead of a warning when both are live", () => {
    const report = assessSupport(caps({ webgl2: false, webAudio: false }));
    expect(report.level).toBe("unsupported");
    expect(supportHeadline(report)).toBe(report.blockers[0]?.message);
  });

  it("collects every issue rather than stopping at the first", () => {
    const nothing: Capabilities = {
      secureContext: false,
      webgl2: false,
      getUserMedia: false,
      webrtc: false,
      webSocket: false,
      webAudio: false,
      broadcastChannel: false,
      videoFrameCallback: false,
    };
    const report = assessSupport(nothing);
    expect(report.blockers.length).toBe(4);
    expect(report.warnings.length).toBe(3);
  });

  it("gives every issue a distinct id", () => {
    const nothing = assessSupport({
      secureContext: false,
      webgl2: false,
      getUserMedia: false,
      webrtc: false,
      webSocket: false,
      webAudio: false,
      broadcastChannel: false,
      videoFrameCallback: false,
    });
    const ids = [...nothing.blockers, ...nothing.warnings].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never shows an empty sentence", () => {
    const nothing = assessSupport({
      secureContext: false,
      webgl2: false,
      getUserMedia: false,
      webrtc: false,
      webSocket: false,
      webAudio: false,
      broadcastChannel: false,
      videoFrameCallback: false,
    });
    for (const issue of [...nothing.blockers, ...nothing.warnings]) {
      expect(issue.message.length).toBeGreaterThan(20);
    }
  });
});
