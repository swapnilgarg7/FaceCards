import { describe, expect, it } from "vitest";
import {
  classifyMediaError,
  deviceLostFault,
  errorName,
  insecureContextFault,
  revokedFault,
  tracksLabel,
  worseFault,
  type FaultKind,
} from "./faults.js";

/** What a browser actually throws. */
function domError(name: string): Error {
  const err = new Error("localised text nobody should be matching on");
  err.name = name;
  return err;
}

/**
 * What LiveKit throws: its own class, carrying the platform name through as a
 * plain property rather than as a `DOMException`.
 */
function wrapped(name: string): object {
  return { name, message: "MediaDeviceFailure" };
}

describe("classifyMediaError", () => {
  it("reads a refusal as needing the browser, not a retry", () => {
    const fault = classifyMediaError(domError("NotAllowedError"));
    expect(fault.kind).toBe("denied");
    expect(fault.recovery).toBe("browser-settings");
    // The load-bearing assertion of this whole file. Nothing a page does can
    // turn a denied permission into a granted one, and a Retry button that
    // silently fails is how somebody decides the app is broken.
    expect(fault.retryable).toBe(false);
  });

  it("treats the legacy names the same as the current ones", () => {
    // Safari and older Firefox still emit these.
    expect(classifyMediaError(domError("PermissionDeniedError")).kind).toBe(
      "denied",
    );
    expect(classifyMediaError(domError("DevicesNotFoundError")).kind).toBe(
      "no-devices",
    );
    expect(classifyMediaError(domError("TrackStartError")).kind).toBe("in-use");
    expect(
      classifyMediaError(domError("ConstraintNotSatisfiedError")).kind,
    ).toBe("no-devices");
  });

  it("classifies an SDK-wrapped error by the same name", () => {
    expect(classifyMediaError(wrapped("NotReadableError")).kind).toBe("in-use");
    expect(classifyMediaError(wrapped("NotAllowedError")).kind).toBe("denied");
  });

  it("says a busy device can be retried, because it genuinely can", () => {
    const fault = classifyMediaError(domError("NotReadableError"));
    expect(fault.kind).toBe("in-use");
    expect(fault.retryable).toBe(true);
  });

  it("folds an over-constrained request into having no device", () => {
    // From the player's side "nothing here satisfies the constraints" and "you
    // have no camera" are the same sentence.
    const fault = classifyMediaError(domError("OverconstrainedError"));
    expect(fault.kind).toBe("no-devices");
    expect(fault.recovery).toBe("connect-a-device");
  });

  it("falls back to something retryable rather than to nothing", () => {
    const fault = classifyMediaError(new Error("who knows"));
    expect(fault.kind).toBe("unknown");
    expect(fault.retryable).toBe(true);
  });

  it("survives being handed something that is not an error at all", () => {
    for (const value of [null, undefined, "boom", 7, {}]) {
      expect(() => classifyMediaError(value)).not.toThrow();
      expect(classifyMediaError(value).kind).toBe("unknown");
    }
  });

  it("never leaks the raw exception text into the message", () => {
    const err = domError("NotAllowedError");
    err.message = "Requested device not found by internal_gum_impl at 0x7f";
    expect(classifyMediaError(err).message).not.toContain("internal_gum_impl");
  });

  it("names only the tracks it is about", () => {
    expect(classifyMediaError(domError("NotFoundError"), ["video"]).message).toContain(
      "camera",
    );
    expect(
      classifyMediaError(domError("NotFoundError"), ["video"]).message,
    ).not.toContain("microphone");
    expect(
      classifyMediaError(domError("NotFoundError"), ["audio"]).message,
    ).toContain("microphone");
  });
});

describe("errorName", () => {
  it("reads the name off anything that has one", () => {
    expect(errorName(domError("NotFoundError"))).toBe("NotFoundError");
    expect(errorName(wrapped("NotFoundError"))).toBe("NotFoundError");
    expect(errorName({ name: 7 })).toBe("");
    expect(errorName(null)).toBe("");
  });
});

describe("tracksLabel", () => {
  it("reads as English for each combination", () => {
    expect(tracksLabel(["video"])).toBe("camera");
    expect(tracksLabel(["audio"])).toBe("microphone");
    expect(tracksLabel(["audio", "video"])).toBe("camera and microphone");
  });
});

describe("the faults that have no exception behind them", () => {
  it("offers nothing to click on an insecure origin", () => {
    const fault = insecureContextFault();
    expect(fault.kind).toBe("insecure");
    expect(fault.recovery).toBe("none");
    expect(fault.retryable).toBe(false);
  });

  it("makes an unplugged device a retry", () => {
    const fault = deviceLostFault("video");
    expect(fault.kind).toBe("device-lost");
    expect(fault.retryable).toBe(true);
    expect(fault.tracks).toEqual(["video"]);
  });

  it("makes a mid-session revocation a trip to site settings", () => {
    const fault = revokedFault(["audio"]);
    expect(fault.kind).toBe("denied");
    expect(fault.retryable).toBe(false);
    expect(fault.message).toContain("microphone");
  });
});

describe("worseFault", () => {
  const of = (kind: FaultKind) => ({
    kind,
    tracks: ["video"] as const,
    message: "",
    recovery: "retry" as const,
    retryable: true,
  });

  it("passes through when there is only one", () => {
    const only = of("denied");
    expect(worseFault(null, only)).toBe(only);
    expect(worseFault(only, null)).toBe(only);
    expect(worseFault(null, null)).toBeNull();
  });

  it("shows the one the player can do least about", () => {
    // A busy camera is one click from working. A denied permission is not, and
    // the fixable one must never hide the unfixable one.
    expect(worseFault(of("in-use"), of("denied"))!.kind).toBe("denied");
    expect(worseFault(of("denied"), of("insecure"))!.kind).toBe("insecure");
    expect(worseFault(of("device-lost"), of("no-devices"))!.kind).toBe(
      "no-devices",
    );
  });

  it("keeps the incumbent on a tie, so an equal fault does not flicker", () => {
    const first = of("in-use");
    expect(worseFault(first, of("hardware"))).toBe(first);
  });
});
