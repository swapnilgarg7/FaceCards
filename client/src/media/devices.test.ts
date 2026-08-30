import { describe, expect, it } from "vitest";
import {
  NO_DEVICES,
  canAttempt,
  diffDevices,
  summariseDevices,
} from "./devices.js";

/**
 * A device as the browser reports it *before* permission is granted: real
 * kind, empty id, empty label. This is the shape the lobby sees, and the
 * reason nothing in this module keys on identity.
 */
function anonymous(kind: MediaDeviceKind): MediaDeviceInfo {
  return {
    deviceId: "",
    groupId: "",
    kind,
    label: "",
    toJSON: () => ({}),
  } as MediaDeviceInfo;
}

describe("summariseDevices", () => {
  it("counts inputs and ignores outputs", () => {
    const summary = summariseDevices([
      anonymous("videoinput"),
      anonymous("audioinput"),
      anonymous("audioinput"),
      // Which speaker the browser routes to is not this product's business.
      anonymous("audiooutput"),
    ]);
    expect(summary).toEqual({ cameras: 1, mics: 2 });
  });

  it("counts an empty machine as empty rather than throwing", () => {
    expect(summariseDevices([])).toEqual(NO_DEVICES);
  });

  it("counts devices with no id, which is every device before permission", () => {
    expect(summariseDevices([anonymous("videoinput")]).cameras).toBe(1);
  });
});

describe("diffDevices", () => {
  it("reports nothing for a change that did not move an input", () => {
    // Headphones. `devicechange` fires; there is nothing to say about it, and
    // re-acquiring the camera here would flash the capture light mid-sentence.
    const same = { cameras: 1, mics: 1 };
    const delta = diffDevices(same, { ...same });
    expect(delta.changed).toBe(false);
    expect(delta.lost).toEqual([]);
    expect(delta.gained).toEqual([]);
  });

  it("reports the last camera going away", () => {
    const delta = diffDevices({ cameras: 1, mics: 1 }, { cameras: 0, mics: 1 });
    expect(delta.lost).toEqual(["video"]);
    expect(delta.gained).toEqual([]);
    expect(delta.changed).toBe(true);
  });

  it("does not report a loss while another camera is still there", () => {
    // Unplugging one of two webcams is not an event a player needs told about:
    // the capture simply carries on, or moves.
    const delta = diffDevices({ cameras: 2, mics: 1 }, { cameras: 1, mics: 1 });
    expect(delta.lost).toEqual([]);
    expect(delta.changed).toBe(true);
  });

  it("reports both going at once, which is a docking station being pulled", () => {
    const delta = diffDevices({ cameras: 1, mics: 1 }, NO_DEVICES);
    expect(delta.lost).toEqual(["video", "audio"]);
  });

  it("reports a device arriving, including a second one", () => {
    expect(diffDevices(NO_DEVICES, { cameras: 1, mics: 0 }).gained).toEqual([
      "video",
    ]);
    // A second camera on a machine whose first one is failing is exactly when
    // a retry is worth attempting.
    expect(
      diffDevices({ cameras: 1, mics: 1 }, { cameras: 2, mics: 1 }).gained,
    ).toEqual(["video"]);
  });

  it("never reports the same kind as both lost and gained", () => {
    const delta = diffDevices({ cameras: 1, mics: 0 }, { cameras: 0, mics: 1 });
    expect(delta.lost).toEqual(["video"]);
    expect(delta.gained).toEqual(["audio"]);
  });
});

describe("canAttempt", () => {
  it("refuses an attempt that could only produce a worse message", () => {
    // Asking for a camera on a machine with none returns NotFoundError, which
    // would then overwrite the accurate message already on screen.
    expect(canAttempt({ cameras: 0, mics: 1 }, ["video"])).toBe(false);
    expect(canAttempt({ cameras: 0, mics: 1 }, ["video", "audio"])).toBe(false);
  });

  it("allows one that could succeed", () => {
    expect(canAttempt({ cameras: 1, mics: 1 }, ["video", "audio"])).toBe(true);
    expect(canAttempt({ cameras: 0, mics: 1 }, ["audio"])).toBe(true);
  });

  it("is vacuously true for no tracks", () => {
    expect(canAttempt(NO_DEVICES, [])).toBe(true);
  });
});
