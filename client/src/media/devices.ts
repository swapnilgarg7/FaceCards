import type { TrackKind } from "./faults.js";

/**
 * What is plugged in, and what changed since last time.
 *
 * `devicechange` fires with no payload: the browser tells you *that* the list
 * moved and leaves working out *how* to you. This module is that diff, kept
 * pure so the five interesting transitions can be written down as tests rather
 * than reproduced by unplugging a webcam five times.
 *
 * Two subtleties make this less trivial than a length comparison.
 *
 * **Labels are empty before permission is granted, and ids are empty in
 * Safari.** `MediaDeviceInfo.deviceId` is the empty string for every device
 * until a `getUserMedia` call has succeeded, so identity has to fall back to
 * counting - which is why `summariseDevices` returns counts and not a set of
 * ids. Counting is enough for the question actually being asked: did the last
 * camera in the machine just go away?
 *
 * **`devicechange` also fires when nothing relevant moved.** Plugging in a
 * pair of headphones changes the output list, and on some machines it fires
 * twice for one physical event. So the diff exists mainly to answer "no" very
 * cheaply: a change that leaves both counts where they were is not a change
 * this product has anything to say about, and re-acquiring a camera on it
 * would flash the capture light in the middle of somebody's sentence.
 */

export interface DeviceSummary {
  cameras: number;
  mics: number;
}

export const NO_DEVICES: DeviceSummary = { cameras: 0, mics: 0 };

/**
 * Count the inputs. Outputs are deliberately ignored: this product publishes
 * two tracks and subscribes to everyone else's, and which speaker the browser
 * routes the result to is not something it has an opinion about.
 */
export function summariseDevices(
  devices: readonly MediaDeviceInfo[],
): DeviceSummary {
  let cameras = 0;
  let mics = 0;
  for (const device of devices) {
    if (device.kind === "videoinput") cameras += 1;
    else if (device.kind === "audioinput") mics += 1;
  }
  return { cameras, mics };
}

export interface DeviceDelta {
  /** Kinds that went from "some" to "none". The one worth interrupting for. */
  lost: readonly TrackKind[];
  /**
   * Kinds that went from "none" to "some", or simply gained a device.
   *
   * Both, on purpose. A second camera appearing is not itself interesting -
   * but a machine that had one camera and now has two has just had something
   * plugged in, and if the *first* one is currently failing, that is exactly
   * the moment a retry is worth attempting.
   */
  gained: readonly TrackKind[];
  /** Whether anything at all moved. False for a headphone plug. */
  changed: boolean;
}

export function diffDevices(
  before: DeviceSummary,
  after: DeviceSummary,
): DeviceDelta {
  const lost: TrackKind[] = [];
  const gained: TrackKind[] = [];

  if (after.cameras === 0 && before.cameras > 0) lost.push("video");
  else if (after.cameras > before.cameras) gained.push("video");

  if (after.mics === 0 && before.mics > 0) lost.push("audio");
  else if (after.mics > before.mics) gained.push("audio");

  return {
    lost,
    gained,
    changed:
      before.cameras !== after.cameras || before.mics !== after.mics,
  };
}

/**
 * Whether a fresh attempt at the given tracks could possibly succeed.
 *
 * Guards the automatic retry. Calling `getUserMedia` for a camera on a machine
 * that has none produces a `NotFoundError`, which would then be classified,
 * shown, and overwrite the more accurate message already on screen with a
 * worse one. Asking first costs one enumeration.
 */
export function canAttempt(
  summary: DeviceSummary,
  tracks: readonly TrackKind[],
): boolean {
  return tracks.every((kind) =>
    kind === "video" ? summary.cameras > 0 : summary.mics > 0,
  );
}
