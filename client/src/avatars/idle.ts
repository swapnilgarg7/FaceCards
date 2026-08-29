/**
 * Idle motion, as a pure function of time.
 *
 * `plan.md` phase 5 asks for "avatar idle animations, per-archetype
 * personality" and points at Mixamo. Mixamo is not the answer for these
 * bodies: its clips are authored for a rigged, skinned humanoid, and these are
 * a capsule, a cylinder and a sphere with a video plane bolted to the front.
 * Retargeting a mocap idle onto that is a lot of download for a body that has
 * no joints to drive.
 *
 * What an idle actually has to do here is narrower and, done this way, better:
 * make six people who are sitting still look like six *different* people who
 * are sitting still. That is a handful of out-of-phase sines, and expressing
 * it as `f(t) -> pose` buys three things a clip would not. It is the same on
 * every client without syncing anything, because time is the only input. It
 * costs no licence row, no fetch and no skinned-mesh update. And - the reason
 * it is a separate pure module rather than four lines in `useFrame` - its
 * amplitude is a *number that can be asserted*.
 *
 * That last one is the whole point. The face plane is the product. A body that
 * sways two degrees is alive; a body that sways ten has taken the face with it
 * and broken the eye-line the entire seat layout exists to protect. `MAX_*`
 * below are the bounds, `idle.test.ts` sweeps a long stretch of time against
 * every personality and checks that none of them is ever exceeded, and nothing
 * here is allowed to grow past them without a test going red.
 */

import { AVATARS, type AvatarId } from "@facecards/shared";

/** How one archetype fidgets. Every field is an amplitude, never a position. */
export interface Personality {
  /** Base cycle, in radians per second. A breath, and everything hangs off it. */
  rate: number;
  /** Peak torso roll, radians. Weight shifting from one hip to the other. */
  sway: number;
  /** Peak forward lean, radians. Positive leans towards the table. */
  lean: number;
  /** Peak head yaw away from the seat's forward, radians. */
  glance: number;
  /** Peak head pitch, radians. Positive tips the chin down at the felt. */
  nod: number;
  /**
   * How much faster the head moves than the body. Above about 3 the head
   * stops reading as attached to the shoulders.
   */
  restlessness: number;
}

/** What a personality is at a moment. Offsets, applied on top of the seat. */
export interface IdlePose {
  /** Roll about the seat's forward axis, radians. */
  roll: number;
  /** Pitch about the seat's right axis, radians. Positive leans in. */
  pitch: number;
  /** Head yaw offset, radians. */
  headYaw: number;
  /** Head pitch offset, radians. */
  headPitch: number;
  /** Vertical shift of the whole body, metres. */
  rise: number;
}

/**
 * Ceilings. Every one of these is a limit on how far the *face* may travel,
 * expressed in whatever quantity moves it.
 *
 * `MAX_HEAD_YAW` is the tightest and the most important. A face plane is a
 * flat quad; turn it far enough off the seat's forward and it foreshortens
 * into a sliver from the seat opposite. Eight degrees is a person shifting
 * their attention. Twenty is a person looking away, which is a thing the
 * *camera* should convey when a player turns their head, not something an
 * idle loop should be doing on their behalf.
 */
export const MAX_ROLL = 0.05;
export const MAX_PITCH = 0.055;
export const MAX_HEAD_YAW = 0.14;
export const MAX_HEAD_PITCH = 0.08;
export const MAX_RISE = 0.012;

/**
 * One personality per archetype.
 *
 * Written as characters rather than as numbers: the cowboy is the one leaning
 * back in his chair, the businessman cannot sit still, the gentleman is
 * carved out of wood, the wizard is somewhere else entirely, the alien is
 * scanning the room, and the shark barely moves until it does. Six people
 * sitting quietly should still be six recognisable silhouettes at a glance
 * from across a table, and this is the cheapest place that can happen.
 */
export const PERSONALITIES: Record<AvatarId, Personality> = {
  cowboy: {
    rate: 0.72,
    sway: 0.042,
    lean: -0.03,
    glance: 0.055,
    nod: 0.02,
    restlessness: 0.7,
  },
  businessman: {
    rate: 1.15,
    sway: 0.016,
    lean: 0.04,
    glance: 0.085,
    nod: 0.05,
    restlessness: 2.6,
  },
  gentleman: {
    rate: 0.62,
    sway: 0.009,
    lean: 0.012,
    glance: 0.03,
    nod: 0.014,
    restlessness: 0.9,
  },
  wizard: {
    rate: 0.55,
    sway: 0.038,
    lean: -0.018,
    glance: 0.105,
    nod: 0.045,
    restlessness: 1.3,
  },
  alien: {
    rate: 0.95,
    sway: 0.012,
    lean: 0.022,
    glance: 0.12,
    nod: 0.035,
    restlessness: 2.9,
  },
  shark: {
    rate: 0.48,
    sway: 0.03,
    lean: 0.03,
    glance: 0.07,
    nod: 0.018,
    restlessness: 0.55,
  },
};

/**
 * The personality for an archetype id.
 *
 * Falls back rather than throwing, exactly as `avatarLook` does and for the
 * same reason: an unknown id is a peer on a different build, and they still
 * get to breathe.
 */
export function personalityFor(id: string): Personality {
  return PERSONALITIES[id as AvatarId] ?? PERSONALITIES[AVATARS[0].id];
}

/**
 * Three periods that share no common multiple inside a session.
 *
 * Same trick, and the same reason, as the three bands of the room murmur: a
 * body driven by one sine has a period, and a period is the thing that makes a
 * loop legible as a loop. These beat against each other for hours.
 */
const HARMONIC_A = 1;
const HARMONIC_B = 0.37;
const HARMONIC_C = 0.173;

/**
 * The pose for one body at one instant.
 *
 * `phase` is the seat's own offset, so that six people on the same clock are
 * not six people breathing in unison, which reads as a chorus line rather than
 * as a table.
 *
 * Every output is clamped. The clamp is not defensive tidying: it is the
 * contract. A personality tuned past a bound gets flattened at the bound
 * rather than taking a face with it, and the test that sweeps this is checking
 * the clamp as much as the sines.
 */
export function idlePose(
  seconds: number,
  personality: Personality,
  phase = 0,
): IdlePose {
  const t = seconds * personality.rate + phase;
  const head = t * personality.restlessness;

  const roll =
    personality.sway *
    (Math.sin(t * HARMONIC_A) * 0.7 + Math.sin(t * HARMONIC_B + 1.3) * 0.3);

  const pitch =
    personality.lean *
    (0.5 + 0.5 * Math.sin(t * HARMONIC_B + 0.7)) *
    (0.8 + 0.2 * Math.sin(t * HARMONIC_C));

  const headYaw =
    personality.glance *
    (Math.sin(head * HARMONIC_C + 2.1) * 0.65 +
      Math.sin(head * HARMONIC_B + 0.4) * 0.35);

  const headPitch =
    personality.nod *
    (Math.sin(head * HARMONIC_B + 1.9) * 0.6 +
      Math.sin(head * HARMONIC_A * 0.5) * 0.4);

  // A breath lifts the shoulders, so it lifts the head with them. Tied to the
  // same clock the torso scale in `Avatar` uses, half a cycle behind, so the
  // rise peaks as the chest fills rather than after it.
  const rise = MAX_RISE * 0.55 * Math.sin(t * HARMONIC_A - Math.PI / 2);

  return {
    roll: clamp(roll, MAX_ROLL),
    pitch: clamp(pitch, MAX_PITCH),
    headYaw: clamp(headYaw, MAX_HEAD_YAW),
    headPitch: clamp(headPitch, MAX_HEAD_PITCH),
    rise: clamp(rise, MAX_RISE),
  };
}

/**
 * A body that has stopped: a seat held open through a reconnection window.
 *
 * Not "the pose at t = 0" but flat zero, because a dropped player who is still
 * breathing is the exact wrong signal - the seat is theirs, but nobody is in
 * it. The rest of the avatar already drains to one grey; this is the half of
 * that which is motion rather than colour.
 */
export const AT_REST: IdlePose = {
  roll: 0,
  pitch: 0,
  headYaw: 0,
  headPitch: 0,
  rise: 0,
};

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}
