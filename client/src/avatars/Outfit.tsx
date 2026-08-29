import { DoubleSide } from "three";
import {
  TORSO_DEPTH,
  TORSO_RADIUS,
  type BodyGeometry,
} from "../scene/body.js";
import type { Outfit } from "./archetypes.js";

/**
 * What each archetype is wearing, in primitives.
 *
 * Phase 5 asks for "outfits with a bit of exaggeration", and exaggeration is
 * the operative word: these are read across a table, at a body that is a
 * capsule, next to a face that is the actual subject. A tailored jacket would
 * be invisible. A yoke wide enough to change the silhouette is not.
 *
 * So every outfit here is chosen for what it does to the *outline*. Six people
 * should be tellable apart from the shoulders down, with the sound off, at a
 * glance - which is the same job the hats do from the neck up, and doubles the
 * number of ways the room stays legible when three of the six have their
 * cameras off.
 *
 * Authored inside `Avatar`'s flipped group, so **+Z is the direction this
 * player faces**. A lapel sits at +Z; a cape hangs at -Z.
 *
 * The face-plane socket contract from `archetypes.ts` applies here exactly as
 * it does to `HeadPieceMesh`: nothing in this file may reach up past
 * `body.facePlaneBottomY`, or it crops the chin off a real person's face.
 */
export function OutfitMesh({
  outfit,
  body,
  colour,
  accent,
}: {
  outfit: Outfit;
  body: BodyGeometry;
  /** The torso colour, for anything cut from the same cloth. */
  colour: string;
  accent: string;
}) {
  // Everything hangs off the shoulder line and the front of the chest, both of
  // which are derived from the seat's eye height in `body.ts`. Nothing below
  // is an absolute height.
  const shoulder = body.shoulderY;
  const front = body.chestFrontZ;

  switch (outfit.kind) {
    case "none":
      return null;

    case "suit":
      return (
        <group>
          {/* Lapels: two slabs angled off the sternum. The V they leave is
              what reads as a jacket rather than as a painted stripe. */}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.055, shoulder - 0.115, front * 0.9]}
              rotation-z={side * 0.34}
              castShadow
            >
              <boxGeometry args={[0.055, 0.2, 0.018]} />
              <meshStandardMaterial color={accent} roughness={0.55} />
            </mesh>
          ))}
          {/* Collar: a pale band at the throat, which is the one high-contrast
              edge a dark suit needs to stop reading as a hole. */}
          <mesh position={[0, shoulder - 0.012, front * 0.72]} castShadow>
            <boxGeometry args={[0.15, 0.036, 0.05]} />
            <meshStandardMaterial color={outfit.collar} roughness={0.7} />
          </mesh>
          {outfit.pocketSquare && (
            <mesh
              position={[-0.115, shoulder - 0.135, front * 0.93]}
              rotation-z={0.12}
            >
              <boxGeometry args={[0.038, 0.022, 0.012]} />
              <meshStandardMaterial color={outfit.collar} roughness={0.6} />
            </mesh>
          )}
        </group>
      );

    case "yoke":
      return (
        <group>
          {/* A western yoke: one wide, shallow slab across the shoulders,
              which broadens the silhouette without adding a single curve. */}
          <mesh position={[0, shoulder - 0.055, 0]} castShadow>
            <boxGeometry
              args={[TORSO_RADIUS * 2.3, 0.07, TORSO_RADIUS * TORSO_DEPTH * 2.1]}
            />
            <meshStandardMaterial color={accent} roughness={0.8} />
          </mesh>
          {/* Bandana, knotted at the throat. */}
          <mesh position={[0, shoulder - 0.008, front * 0.55]} castShadow>
            <boxGeometry args={[0.13, 0.055, 0.055]} />
            <meshStandardMaterial color={accent} roughness={0.85} />
          </mesh>
        </group>
      );

    case "cape":
      return (
        <group>
          {/* Hangs behind: a half-cone open at the bottom, wider than the
              body, so a wizard is unmistakable from behind and from the side
              and never has anything crossing their face. */}
          <mesh
            position={[0, shoulder - 0.16, -front * 0.35]}
            rotation-x={-0.12}
            castShadow
          >
            <coneGeometry
              args={[TORSO_RADIUS * 1.55, 0.42, 16, 1, true, Math.PI * 0.62, Math.PI * 1.76]}
            />
            <meshStandardMaterial color={accent} roughness={0.9} side={DoubleSide} />
          </mesh>
          {/* The clasp that says the cape is fastened rather than draped. */}
          <mesh position={[0, shoulder - 0.03, front * 0.7]}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshStandardMaterial color={colour} roughness={0.35} metalness={0.6} />
          </mesh>
        </group>
      );

    case "collarBand":
      // A single heavy ring at the neck. The cheapest possible outfit and the
      // right one for the two archetypes whose silhouette is already doing the
      // work: an alien's skull and a shark's fin.
      return (
        <mesh position={[0, shoulder - 0.02, 0]} rotation-x={Math.PI / 2} castShadow>
          <torusGeometry args={[0.088, 0.019, 8, 20]} />
          <meshStandardMaterial
            color={accent}
            roughness={0.4}
            metalness={0.35}
          />
        </mesh>
      );
  }
}
