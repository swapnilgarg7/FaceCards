import { describe, expect, it } from "vitest";
import { AVATARS } from "@facecards/shared";
import {
  AT_REST,
  MAX_HEAD_PITCH,
  MAX_HEAD_YAW,
  MAX_PITCH,
  MAX_RISE,
  MAX_ROLL,
  PERSONALITIES,
  idlePose,
  personalityFor,
} from "./idle.js";
import { FACE_PLANE_WIDTH, HEAD_RADIUS } from "../scene/body.js";

const SWEEP_SECONDS = 3600;
const STEP = 0.05;

function sweep(id: string, phase = 0, seconds = SWEEP_SECONDS) {
  const personality = personalityFor(id);
  const poses = [];
  for (let t = 0; t < seconds; t += STEP) {
    poses.push(idlePose(t, personality, phase));
  }
  return poses;
}

/**
 * The furthest each channel ever travelled over a sweep.
 *
 * Reduced to five numbers before anything is asserted, deliberately: an hour
 * at 20Hz is seventy-two thousand poses, and an assertion per channel per pose
 * spends thirty seconds in the matcher to check what one comparison can.
 */
function extremes(poses: readonly ReturnType<typeof idlePose>[]) {
  const worst = { roll: 0, pitch: 0, headYaw: 0, headPitch: 0, rise: 0 };
  for (const pose of poses) {
    worst.roll = Math.max(worst.roll, Math.abs(pose.roll));
    worst.pitch = Math.max(worst.pitch, Math.abs(pose.pitch));
    worst.headYaw = Math.max(worst.headYaw, Math.abs(pose.headYaw));
    worst.headPitch = Math.max(worst.headPitch, Math.abs(pose.headPitch));
    worst.rise = Math.max(worst.rise, Math.abs(pose.rise));
  }
  return worst;
}

describe("an idle never moves a face out of its socket", () => {
  // The bounds are the contract, not tidying. A body that sways two degrees is
  // alive; a body that sways ten has taken the face with it and broken the
  // eye-line the entire seat layout exists to protect.
  for (const archetype of AVATARS) {
    it(`${archetype.id} stays inside every bound for an hour`, () => {
      const worst = extremes(sweep(archetype.id));
      expect(worst.roll).toBeLessThanOrEqual(MAX_ROLL + 1e-9);
      expect(worst.pitch).toBeLessThanOrEqual(MAX_PITCH + 1e-9);
      expect(worst.headYaw).toBeLessThanOrEqual(MAX_HEAD_YAW + 1e-9);
      expect(worst.headPitch).toBeLessThanOrEqual(MAX_HEAD_PITCH + 1e-9);
      expect(worst.rise).toBeLessThanOrEqual(MAX_RISE + 1e-9);
      // And it actually moves: a bound nothing approaches is not a bound.
      expect(worst.headYaw).toBeGreaterThan(0.005);
    });
  }

  it("keeps the face plane nearly square to the seat", () => {
    // A face plane is a flat quad. Turned far enough off the seat's forward it
    // foreshortens into a sliver from the seat opposite, which is the failure
    // this bound exists to prevent. At the widest glance the plane still shows
    // this fraction of its width.
    const foreshortening = Math.cos(MAX_HEAD_YAW);
    expect(foreshortening).toBeGreaterThan(0.98);
    // And the head's own travel stays well inside its own radius, so the face
    // never slides off the skull it is painted on.
    expect(Math.sin(MAX_HEAD_YAW) * (FACE_PLANE_WIDTH / 2)).toBeLessThan(
      HEAD_RADIUS * 0.2,
    );
  });

  it("clamps a personality that was tuned past a bound", () => {
    // The clamp is part of the contract: an over-eager tuning pass gets
    // flattened at the bound rather than taking a face with it.
    const wild = {
      rate: 1,
      sway: 10,
      lean: 10,
      glance: 10,
      nod: 10,
      restlessness: 2,
    };
    const poses = [];
    for (let t = 0; t < 600; t += 0.05) poses.push(idlePose(t, wild));
    const worst = extremes(poses);
    expect(worst.roll).toBeLessThanOrEqual(MAX_ROLL + 1e-9);
    expect(worst.pitch).toBeLessThanOrEqual(MAX_PITCH + 1e-9);
    expect(worst.headYaw).toBeLessThanOrEqual(MAX_HEAD_YAW + 1e-9);
    expect(worst.headPitch).toBeLessThanOrEqual(MAX_HEAD_PITCH + 1e-9);
  });
});

describe("six people sitting still are six different people", () => {
  it("gives every archetype its own personality", () => {
    const seen = new Set(
      AVATARS.map((a) => JSON.stringify(personalityFor(a.id))),
    );
    expect(seen.size).toBe(AVATARS.length);
  });

  it("tells archetypes apart over a minute of motion", () => {
    // Not just different constants: different *motion*. Two archetypes whose
    // poses tracked each other would be one archetype with two hats.
    const traces = AVATARS.map((a) => sweep(a.id, 0, 60));
    for (let i = 0; i < traces.length; i++) {
      for (let j = i + 1; j < traces.length; j++) {
        const worst = traces[i]!.reduce(
          (max, pose, k) =>
            Math.max(max, Math.abs(pose.headYaw - traces[j]![k]!.headYaw)),
          0,
        );
        expect(worst).toBeGreaterThan(0.01);
      }
    }
  });

  it("does not put the whole table on the same breath", () => {
    // Six bodies on one clock and no phase offset is a chorus line, not a
    // table. The seat's own phase is what breaks that up.
    const a = sweep("cowboy", 0, 60);
    const b = sweep("cowboy", 2.4, 60);
    const worst = a.reduce(
      (max, pose, k) => Math.max(max, Math.abs(pose.roll - b[k]!.roll)),
      0,
    );
    expect(worst).toBeGreaterThan(0.01);
  });

  it("is the same on every client, because time is its only input", () => {
    const personality = personalityFor("wizard");
    expect(idlePose(12.5, personality, 1.1)).toEqual(
      idlePose(12.5, personality, 1.1),
    );
  });
});

describe("a dropped player stops", () => {
  it("is flat zero, not a pose", () => {
    // A seat held through a reconnection window is theirs, but nobody is in
    // it. A body that is still breathing is the exact wrong signal.
    expect(AT_REST).toEqual({
      roll: 0,
      pitch: 0,
      headYaw: 0,
      headPitch: 0,
      rise: 0,
    });
  });
});

describe("an unknown archetype still gets a body", () => {
  it("falls back rather than throwing", () => {
    // Same reason `avatarLook` does: an unknown id is a peer on a different
    // build, and they still get to breathe.
    expect(personalityFor("not-an-archetype")).toEqual(
      PERSONALITIES[AVATARS[0].id],
    );
  });
});
