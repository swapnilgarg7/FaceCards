import { AVATARS, avatarById, type AvatarId } from "@facecards/shared";
import { HEAD_SCALE } from "../scene/body.js";

/**
 * How each archetype is built out of primitives, as data.
 *
 * Phase 3 owns the *plumbing*, not the art: an archetype id chosen in the
 * lobby has to survive the join option, the server's validation, the schema,
 * the snapshot and the scene, and six people have to be able to tell each
 * other apart across a table. Boxes and cones do that today; phase 5 swaps in
 * the Quaternius modular bodies (`docs/ASSET-SOURCES.md`) behind exactly this
 * interface.
 *
 * The contract that has to survive that swap is the one thing here that is not
 * cosmetic: **the face-plane socket**. Every archetype puts a plane of
 * `FACE_PLANE_*` dimensions at the seat's eye height facing the seat's
 * forward, so the webcam binding never learns which body it is on. Nothing in
 * this file may move that plane; a hat sits above it, a fin sits behind it.
 *
 * Head proportions are expressed as *multipliers* on `body.ts`'s `HEAD_SCALE`
 * rather than as absolute numbers, so an archetype cannot quietly opt out of
 * the proportions the face plane was tuned against. An alien is a longer
 * version of the same skull, not a different one.
 *
 * No asset, no licence row. `docs/ASSET-CREDITS.md` starts earning its keep
 * when the first mesh lands, not before.
 */

/** What sits on top of the head. One per archetype, and all of them cheap. */
export type HeadPiece =
  /** Cowboy: wide brim, low crown. */
  | {
      kind: "brim";
      brimRadius: number;
      crownRadius: number;
      crownHeight: number;
    }
  /** Gentleman: narrow brim, tall crown. */
  | {
      kind: "topHat";
      brimRadius: number;
      crownRadius: number;
      crownHeight: number;
    }
  /**
   * Wizard: a cone. `tilt` is radians about the seat's own X axis, positive
   * tipping the point backwards, because a cone standing perfectly upright on
   * a head reads as a traffic cone rather than a hat.
   */
  | { kind: "cone"; radius: number; height: number; tilt: number }
  /** Alien: two stalks with bulbs. */
  | { kind: "antennae"; length: number; spread: number; bulb: number }
  /** Shark: a dorsal fin, behind the head so it never crosses the face. */
  | { kind: "fin"; height: number; length: number }
  /** Businessman: nothing on the head; the tie does the work. */
  | { kind: "none" };

export interface AvatarLook {
  id: string;
  label: string;
  /** Torso colour. The same value the lobby swatch showed, so a choice sticks. */
  body: string;
  /** Trim: hat band, antenna bulbs, fin edge, tie. */
  accent: string;
  /** Head and neck colour. */
  headColour: string;
  /** Absolute head scale: `HEAD_SCALE` with this archetype's stretch applied. */
  headScale: [number, number, number];
  headPiece: HeadPiece;
  /** A tie down the chest. Business dress, and only that. */
  tie: boolean;
}

interface LookShape {
  headColour: string;
  /** Multiplied onto `HEAD_SCALE`. `[1, 1, 1]` is the default skull. */
  headStretch: [number, number, number];
  headPiece: HeadPiece;
  tie: boolean;
}

/**
 * Per-archetype geometry, keyed by the ids `shared/src/avatars.ts` defines, so
 * anything that passed the server's validation always resolves here.
 */
const LOOKS: Record<AvatarId, LookShape> = {
  cowboy: {
    headColour: "#3b3129",
    headStretch: [1, 1, 1],
    headPiece: {
      kind: "brim",
      brimRadius: 0.23,
      crownRadius: 0.115,
      crownHeight: 0.1,
    },
    tie: false,
  },
  businessman: {
    headColour: "#2b3038",
    headStretch: [1, 1, 1],
    headPiece: { kind: "none" },
    tie: true,
  },
  gentleman: {
    headColour: "#2b3038",
    headStretch: [0.98, 1.02, 1],
    headPiece: {
      kind: "topHat",
      brimRadius: 0.175,
      crownRadius: 0.115,
      crownHeight: 0.19,
    },
    tie: true,
  },
  wizard: {
    headColour: "#33304a",
    headStretch: [1, 1, 1],
    headPiece: { kind: "cone", radius: 0.14, height: 0.32, tilt: 0.18 },
    tie: false,
  },
  alien: {
    // A longer skull, so the silhouette reads before the face does.
    headColour: "#1f6b52",
    headStretch: [0.96, 1.16, 0.98],
    headPiece: { kind: "antennae", length: 0.13, spread: 0.075, bulb: 0.026 },
    tie: false,
  },
  shark: {
    headColour: "#44586a",
    headStretch: [1.02, 0.96, 1.12],
    headPiece: { kind: "fin", height: 0.17, length: 0.16 },
    tie: false,
  },
};

/**
 * The look for an archetype id.
 *
 * Falls back rather than throwing, for the same reason `avatarById` does: an
 * unknown id means a peer on a different build, and the right answer is that
 * they still get a body.
 */
export function avatarLook(id: string): AvatarLook {
  const archetype = avatarById(id);
  const shape = LOOKS[archetype.id as AvatarId] ?? LOOKS[AVATARS[0].id];

  return {
    id: archetype.id,
    label: archetype.label,
    body: archetype.colour,
    accent: archetype.accent,
    headColour: shape.headColour,
    headScale: [
      HEAD_SCALE.x * shape.headStretch[0],
      HEAD_SCALE.y * shape.headStretch[1],
      HEAD_SCALE.z * shape.headStretch[2],
    ],
    headPiece: shape.headPiece,
    tie: shape.tie,
  };
}
