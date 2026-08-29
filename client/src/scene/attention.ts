/**
 * Who you are looking at, and therefore whose video is worth paying for.
 *
 * Spec sections 6 and 12. `adaptiveStream: true` is the baseline and it is
 * already on: LiveKit watches each attached element's size and visibility and
 * picks a simulcast layer by itself. What it cannot know is that all six of
 * our elements are the same size in a hidden sink, because the thing that
 * actually varies is *where the player's head is pointing*. Six equal-sized
 * elements look identical to an intersection observer and completely different
 * to a person.
 *
 * So this layer sits on top: the face you have turned towards gets the top
 * layer, faces in your peripheral vision get the middle one, and faces behind
 * you get the bottom one. Six high-resolution decodes is where the frame
 * budget first bites, and at any moment at most one or two of them are being
 * looked at.
 *
 * Pure and unit-tested: no three.js, no SDK, no element. The scene supplies
 * angles, this decides levels, and `MediaProvider.setQuality` applies them.
 */

export type StreamQuality = "high" | "medium" | "low";

/**
 * Inside this arc of the look direction, you are looking *at* someone.
 *
 * Sized against the ring the seats actually form. Six players evenly spaced
 * put the seat opposite you at 0 degrees, the two beside them at 30, and the
 * two nearest you at 60 (`layout.ts` derives the general case). A cone wide
 * enough to swallow 30 degrees would put three faces on the top layer while
 * you sat perfectly still, which is most of the way back to paying for all
 * six. `attention.test.ts` asserts the resting profile over a real six-ring,
 * so widening this fails a test rather than quietly costing frames.
 */
export const HIGH_ANGLE = (20 * Math.PI) / 180;

/**
 * Inside this, they are in your field of view but not your attention. Set
 * wide enough that turning your head does not visibly re-resolve the room,
 * and narrow enough that the seats behind you cost nothing.
 */
export const MEDIUM_ANGLE = (46 * Math.PI) / 180;

/**
 * How far past a boundary a face has to travel before it loses the level it
 * already has.
 *
 * Without this, a head resting exactly on a threshold - which is precisely
 * where a head rests, because that is what looking at someone's shoulder is -
 * would renegotiate the layer several times a second. Each renegotiation is a
 * keyframe request and a visible re-resolve, so flapping looks far worse than
 * simply being one level too generous.
 */
export const HYSTERESIS = (6 * Math.PI) / 180;

/**
 * The level for a face at `angle` radians off the look direction.
 *
 * `current` is what that peer is on right now; passing it applies the
 * hysteresis. Omit it for the first decision, where there is nothing to keep.
 */
export function qualityForAngle(
  angle: number,
  current?: StreamQuality,
): StreamQuality {
  const off = Math.abs(angle);

  // The band you are in is stretched, never the band you are entering, so
  // leaving a level always costs more than arriving at it.
  const highEdge = HIGH_ANGLE + (current === "high" ? HYSTERESIS : 0);
  if (off <= highEdge) return "high";

  const mediumEdge =
    MEDIUM_ANGLE + (current === "medium" || current === "high" ? HYSTERESIS : 0);
  if (off <= mediumEdge) return "medium";

  return "low";
}

export interface Point2 {
  x: number;
  z: number;
}

/**
 * Absolute horizontal angle between where a viewer is looking and where
 * someone's head is.
 *
 * Horizontal only, on purpose: pitch is clamped to a narrow arc by the seated
 * rig, everyone's head is at the same eye height, and adding the vertical
 * component would mean looking down at your cards downgraded the whole table.
 */
export function lookOffset(
  eye: Point2,
  forward: Point2,
  target: Point2,
): number {
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const length = Math.hypot(dx, dz);
  // Standing exactly on top of someone has no meaningful bearing. Zero reads
  // as "directly in front", which is the generous answer and the safe one.
  if (length === 0) return 0;

  const forwardLength = Math.hypot(forward.x, forward.z);
  if (forwardLength === 0) return 0;

  const cross = forward.x * dz - forward.z * dx;
  const dot = forward.x * dx + forward.z * dz;
  // atan2 of the cross and dot products, which stays well-conditioned near
  // both zero and pi where a plain acos does not.
  return Math.abs(Math.atan2(cross, dot));
}
