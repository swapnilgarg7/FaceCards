import type { HeadPiece } from "./archetypes.js";

/**
 * The one thing that makes a cowboy a cowboy, in primitives.
 *
 * Authored in the seat's own frame: -Z is forward, so a fin sits at +Z and a
 * cone tips towards +Z to lean back. It is deliberately *outside* the flipped
 * group that carries the face plane and the name plate, because those need
 * their UVs turned around and this does not.
 *
 * Nothing here may reach down into the face plane's rectangle. `archetypes.ts`
 * documents that contract and `archetypes.test.ts` asserts the dimensions
 * respect it; this file is what would break it, so it only ever draws above
 * `headTopY` or behind the head.
 */
export function HeadPieceMesh({
  piece,
  headTopY,
  colour,
  accent,
}: {
  piece: HeadPiece;
  /** Crown of the skull, in the seat's local frame. */
  headTopY: number;
  colour: string;
  accent: string;
}) {
  switch (piece.kind) {
    case "none":
      return null;

    case "brim":
    case "topHat": {
      // The brim sits a little *below* the crown of the head, the way a hat
      // is worn: resting on it, not balanced on top of it.
      const brimY = headTopY - 0.035;
      return (
        <group>
          <mesh position={[0, brimY, 0]} castShadow>
            <cylinderGeometry args={[piece.brimRadius, piece.brimRadius, 0.014, 20]} />
            <meshStandardMaterial color={colour} roughness={0.8} />
          </mesh>
          <mesh position={[0, brimY + piece.crownHeight / 2, 0]} castShadow>
            <cylinderGeometry
              args={[piece.crownRadius, piece.crownRadius * 1.04, piece.crownHeight, 18]}
            />
            <meshStandardMaterial color={colour} roughness={0.8} />
          </mesh>
          {/* Band, in the accent colour, so the hat is not one flat mass. */}
          <mesh position={[0, brimY + 0.022, 0]}>
            <cylinderGeometry
              args={[piece.crownRadius * 1.06, piece.crownRadius * 1.06, 0.026, 18]}
            />
            <meshStandardMaterial color={accent} roughness={0.6} />
          </mesh>
        </group>
      );
    }

    case "cone":
      return (
        <mesh
          position={[0, headTopY + piece.height / 2 - 0.03, 0.01]}
          rotation-x={piece.tilt}
          castShadow
        >
          <coneGeometry args={[piece.radius, piece.height, 18]} />
          <meshStandardMaterial color={colour} roughness={0.85} />
        </mesh>
      );

    case "antennae":
      return (
        <group>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * piece.spread, headTopY - 0.02, 0]}>
              <mesh rotation-z={side * -0.28} position={[0, piece.length / 2, 0]}>
                <cylinderGeometry args={[0.008, 0.01, piece.length, 8]} />
                <meshStandardMaterial color={colour} roughness={0.7} />
              </mesh>
              <mesh
                position={[side * piece.length * 0.26, piece.length * 0.98, 0]}
              >
                <sphereGeometry args={[piece.bulb, 10, 8]} />
                <meshStandardMaterial
                  color={accent}
                  emissive={accent}
                  emissiveIntensity={0.55}
                  roughness={0.4}
                />
              </mesh>
            </group>
          ))}
        </group>
      );

    case "fin":
      // Behind the head (+Z is backwards), leaning back, so it is a
      // silhouette from across the table and never crosses a face.
      return (
        <mesh
          position={[0, headTopY + piece.height / 2 - 0.06, 0.085]}
          rotation-x={0.42}
          scale={[0.16, 1, 1]}
          castShadow
        >
          <coneGeometry args={[piece.length, piece.height, 4]} />
          <meshStandardMaterial color={accent} roughness={0.75} />
        </mesh>
      );
  }
}
