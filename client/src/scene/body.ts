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

/**
 * Square, so the face reads as a circle on a round head rather than an oval
 * pasted on one. The crop honours this exactly: `faceCrop.ts` samples a window
 * of the webcam frame with the plane's aspect in *source pixels*, so a square
 * plane takes a square crop and nobody is stretched to fit it.
 *
 * The oval this replaced was a portrait rectangle masked down to an ellipse,
 * which meant the framing had to be tall and narrow to match, and a webcam
 * frame is neither. Round takes less from the sides of the frame and none of
 * the vertical, and it is the shape a head already is.
 */
export const FACE_PLANE_WIDTH = 0.29;
export const FACE_PLANE_HEIGHT = 0.29;
export const FACE_PLANE_ASPECT = FACE_PLANE_WIDTH / FACE_PLANE_HEIGHT;

export const HEAD_RADIUS = 0.15;
/**
 * Round from the front, flattened front to back.
 *
 * The skull used to be narrowed and stretched into an egg, from back when the
 * face on it was an oval. A circular face inside an oval skull leaves a rim
 * that is thick at the temples and thin at the crown, which reads as a badly
 * cut sticker. Equal x and y keeps that rim even the whole way round; z stays
 * shallow because a head is not a ball, and because the face plane floats in
 * front of it and has to clear it.
 */
export const HEAD_SCALE = { x: 1, y: 1, z: 0.9 } as const;
/** How far the face plane floats off the head, so it never z-fights. */
export const FACE_INSET = HEAD_RADIUS * 0.94;

/**
 * Eyes to the top of the shoulder on a seated adult: a head's lower half
 * plus a neck. This is the number that was missing before, when the torso
 * simply ran up to eye height and swallowed everyone's jaw.
 */
/**
 * The turn marker: how far above the eye-line it floats, and how big it is.
 *
 * Both numbers are clearances rather than tastes.
 *
 * **The rise** has to clear the tallest thing anybody wears. A head reaches
 * `HEAD_RADIUS * HEAD_SCALE.y` above the eye-line, and the most stretched
 * skull in `archetypes.ts` scales that by 1.16, which is 0.174m. The tallest
 * head piece is the 0.32m cone, drawn from `headTopY + height/2 - 0.03`, so it
 * reaches a further 0.29m. No single archetype is both, but taking the worst
 * of each puts a ceiling of 0.464m over the eye-line on anything anybody can
 * be wearing, and the bottom edge of the marker clears that even at the bottom
 * of its float: close enough to belong to that head, never inside the hat.
 *
 * **The size** then has to keep the marker's *bottom* clear of the face band
 * (`decor.ts`), because a lit quad at eye height on the far side of the room
 * is a halo on somebody's face no matter what it is a marker for. Asserted in
 * `decor.test.ts`, which is the one place that can see both halves.
 */
export const TURN_MARKER_SIZE = 0.19;
export const TURN_MARKER_RISE = 0.62;
/** How far it drifts up and down. Enough to catch the eye, not enough to bob. */
export const TURN_MARKER_FLOAT = 0.018;

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
