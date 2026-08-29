/**
 * Avatar body proportions. Pure numbers and pure functions, no three.js
 * import, so the relationships that matter can be unit-tested without a
 * renderer, exactly as the seat layout is.
 *
 * Everything is measured **down from the eye-line**, because that is the one
 * height the whole scene is built around: a seated person's shoulders sit a
 * fixed distance below their eyes, so deriving them keeps a body attached to
 * its face if `EYE_HEIGHT` ever moves.
 *
 * Two of these relationships are load-bearing, and `body.test.ts` asserts
 * both. The face plane hangs half its height below the eyes, so its lower
 * edge crosses the jaw and the top of the neck. If the chest reaches above
 * that line, or forward past `FACE_INSET`, it wins the depth test and crops
 * the chin off every face in the room.
 */

/** Portrait, because faces are. The crop honours this exactly. */
export const FACE_PLANE_WIDTH = 0.26;
export const FACE_PLANE_HEIGHT = 0.34;
export const FACE_PLANE_ASPECT = FACE_PLANE_WIDTH / FACE_PLANE_HEIGHT;

export const HEAD_RADIUS = 0.14;
/** Flattened front to back and stretched a little tall, as skulls are. */
export const HEAD_SCALE = { x: 0.94, y: 1.06, z: 0.9 } as const;
/** How far the face plane floats off the head, so it never z-fights. */
export const FACE_INSET = HEAD_RADIUS * 0.94;

/**
 * Eyes to the top of the shoulder on a seated adult: a head's lower half
 * plus a neck. This is the number that was missing before, when the torso
 * simply ran up to eye height and swallowed everyone's jaw.
 */
export const SHOULDER_DROP = 0.23;

export const TORSO_RADIUS = 0.2;
export const TORSO_LENGTH = 0.34;
/**
 * A chest is about twice as wide as it is deep. Sweeping a plain capsule
 * gave one as deep as it was broad, bulging 0.2 straight forward past a face
 * plane sitting at 0.13, which is the other half of why a body could cover a
 * chin.
 */
export const TORSO_DEPTH = 0.6;
/** Half a capsule: the cylinder plus one hemispherical cap. */
export const TORSO_HALF_HEIGHT = TORSO_LENGTH / 2 + TORSO_RADIUS;

/** Breathing, as applied per frame in `Avatar`. Counted in the clearances. */
export const TORSO_BREATH_SCALE = 0.012;
export const TORSO_BREATH_RISE = 0.004;

export const NECK_RADIUS_TOP = 0.052;
export const NECK_RADIUS_BOTTOM = 0.075;
/** Sunk into the shoulders and the skull, so neither joint shows a seam. */
export const NECK_OVERLAP = 0.06;

export interface BodyGeometry {
  /** Top of the shoulder line. */
  shoulderY: number;
  /** Centre of the torso capsule. */
  torsoY: number;
  /** Highest the shoulder reaches at the top of a breath. */
  shoulderPeakY: number;
  /** How far the chest reaches towards the table. */
  chestFrontZ: number;
  neckY: number;
  neckHeight: number;
  /** Underside of the skull, where the neck has to meet it. */
  headBottomY: number;
  /** Lower edge of the face plane, i.e. the lowest visible chin. */
  facePlaneBottomY: number;
}

/** Every body dimension for a seat, derived from that seat's eye height. */
export function bodyGeometry(eyeY: number): BodyGeometry {
  const shoulderY = eyeY - SHOULDER_DROP;
  const headBottomY = eyeY - HEAD_RADIUS * HEAD_SCALE.y;
  const neckHeight = headBottomY - shoulderY + NECK_OVERLAP;

  return {
    shoulderY,
    torsoY: shoulderY - TORSO_HALF_HEIGHT,
    shoulderPeakY:
      shoulderY + TORSO_HALF_HEIGHT * TORSO_BREATH_SCALE + TORSO_BREATH_RISE,
    chestFrontZ: TORSO_RADIUS * TORSO_DEPTH,
    neckY: (shoulderY + headBottomY) / 2,
    neckHeight,
    headBottomY,
    facePlaneBottomY: eyeY - FACE_PLANE_HEIGHT / 2,
  };
}
