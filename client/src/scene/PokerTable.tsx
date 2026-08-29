import { DoubleSide } from "three";
import { TABLE } from "./layout.js";

/**
 * The table, built from primitives.
 *
 * Research turned up no clean CC0 poker table mesh, and lathing an oval rail
 * is the better answer anyway: it is a handful of triangles, it costs no
 * licence row, and its proportions stay a number we can tune against the
 * eye-line rather than a shape we inherited. Phase 5 replaces this with a
 * dressed Blender export at the same dimensions.
 */

const PEDESTAL_HEIGHT = TABLE.topY - 0.08;

export function PokerTable() {
  return (
    <group>
      {/* Felt. A unit cylinder scaled into the table's ellipse, so the whole
          scene reads one pair of radii rather than two. */}
      <mesh
        position={[0, TABLE.topY - 0.03, 0]}
        scale={[TABLE.radiusX, 1, TABLE.radiusZ]}
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, 0.06, 48]} />
        <meshStandardMaterial color="#16563f" roughness={0.95} />
      </mesh>

      {/* Padded rail. */}
      <mesh
        position={[0, TABLE.topY, 0]}
        rotation-x={-Math.PI / 2}
        scale={[TABLE.radiusX, TABLE.radiusZ, 1]}
        receiveShadow
        castShadow
      >
        <torusGeometry args={[1, TABLE.railTube, 10, 56]} />
        <meshStandardMaterial color="#3b2318" roughness={0.45} />
      </mesh>

      {/* Skirt, so the felt does not float. */}
      <mesh
        position={[0, TABLE.topY - 0.13, 0]}
        scale={[TABLE.radiusX, 1, TABLE.radiusZ]}
      >
        <cylinderGeometry args={[1, 0.96, 0.2, 48, 1, true]} />
        <meshStandardMaterial
          color="#2a1a12"
          roughness={0.6}
          side={DoubleSide}
        />
      </mesh>

      <mesh position={[0, PEDESTAL_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.34, PEDESTAL_HEIGHT, 20]} />
        <meshStandardMaterial color="#241811" roughness={0.6} />
      </mesh>

      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.06, 24]} />
        <meshStandardMaterial color="#241811" roughness={0.6} />
      </mesh>

      {/* Floor. Finite and dark: a big bright plane would pull the eye off
          the faces, which is the one thing the art direction must not do. */}
      <mesh position={[0, 0, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, 40]} />
        <meshStandardMaterial color="#14100e" roughness={1} />
      </mesh>
    </group>
  );
}
