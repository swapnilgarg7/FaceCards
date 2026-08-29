import { useMemo } from "react";
import * as THREE from "three";
import { TABLE } from "./layout.js";
import {
  INLAY_INNER,
  INLAY_OUTER,
  FELT_RADIUS,
  NEON_RADIUS,
  NEON_TUBE,
  NEON_Y,
  TABLE_SEGMENTS,
  apronProfile,
  pedestalProfile,
  railProfile,
  type ProfilePoint,
} from "./tableProfile.js";
import {
  PALETTE,
  brassMaterial,
  contactShadowMaterial,
  feltMaterial,
  leatherMaterial,
  neonMaterial,
  ringGlowMaterial,
  woodMaterial,
} from "./surfaces.js";

/**
 * The table. The hero asset, and the only object in the room allowed to be
 * one.
 *
 * Turned rather than downloaded, as `tableProfile.ts` explains: research found
 * no clean CC0 poker table mesh, and a surface of revolution authored as
 * numbers is both cheaper and *checkable*. Everything about its proportions
 * that matters to the game - that the rail clears the deck, that the felt
 * clears a full stack - is asserted in `tableProfile.test.ts` against the same
 * anchors the scene draws chips and cards to.
 *
 * Five materials, five draw calls: felt, brass, leather, walnut, neon. Plus
 * two unlit quads for the painted light. That is the whole table.
 */

/** A profile in table-local metres, lifted onto the felt's own height. */
function lathePoints(profile: readonly ProfilePoint[]): THREE.Vector2[] {
  return profile.map((p) => new THREE.Vector2(p.r, TABLE.topY + p.y));
}

function useLathe(profile: readonly ProfilePoint[]): THREE.LatheGeometry {
  return useMemo(
    () => new THREE.LatheGeometry(lathePoints(profile), TABLE_SEGMENTS),
    [profile],
  );
}

/**
 * How far out the neon's painted spill reaches on the floor. The disc is drawn
 * this wide and the bright ring inside it is placed as a fraction of it, which
 * is the one conversion `ringGlowTexture` needs from world units.
 */
const NEON_SPILL_RADIUS = 1.75;

/** The pool of dark the table stands in. Wider than the table, and softer. */
const CONTACT_RADIUS = 1.55;

export function PokerTable() {
  const rail = useLathe(useMemo(() => railProfile(), []));
  const apron = useLathe(useMemo(() => apronProfile(), []));
  const pedestal = useLathe(useMemo(() => pedestalProfile(), []));

  return (
    <group>
      {/* The playing surface. One 1024px disc rather than a tiled swatch, so
          the betting line can be drawn at a world radius the layout agrees
          with; see `feltTexture`. */}
      <mesh
        position={[0, TABLE.topY, 0]}
        rotation-x={-Math.PI / 2}
        receiveShadow
        material={feltMaterial()}
      >
        <circleGeometry args={[FELT_RADIUS, TABLE_SEGMENTS]} />
      </mesh>

      {/* The brass race between cloth and leather. Two rings of triangles, and
          the single detail that does most of the work of reading as premium:
          it is the only genuinely metallic thing on the table, so it is the
          only thing that moves its highlight as you turn your head. */}
      <mesh
        position={[0, TABLE.topY + 0.0012, 0]}
        rotation-x={-Math.PI / 2}
        material={brassMaterial()}
      >
        <ringGeometry args={[INLAY_INNER, INLAY_OUTER, TABLE_SEGMENTS]} />
      </mesh>

      <mesh
        geometry={rail}
        material={leatherMaterial()}
        castShadow
        receiveShadow
      />
      <mesh geometry={apron} material={woodMaterial()} receiveShadow />
      <mesh geometry={pedestal} material={woodMaterial(0.72)} />

      {/* The neon race, tucked under the rail's outer lip so what a seated
          player sees is the light on the apron rather than the tube. Its
          height is checked against the face band in `decor.ts`. */}
      <mesh
        position={[0, TABLE.topY + NEON_Y, 0]}
        rotation-x={-Math.PI / 2}
        material={neonMaterial(PALETTE.neonPink)}
      >
        <torusGeometry args={[NEON_RADIUS, NEON_TUBE, 8, TABLE_SEGMENTS]} />
      </mesh>

      {/* What that tube throws on the floor. Painted, not cast: see the note
          on bloom in `surfaces.ts` - a halo drawn where the fixture is beats a
          screen-space effect that cannot tell neon from a lit forehead. */}
      <mesh
        position={[0, 0.014, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={-1}
        material={ringGlowMaterial(
          PALETTE.neonPink,
          NEON_RADIUS / NEON_SPILL_RADIUS,
        )}
      >
        <circleGeometry args={[NEON_SPILL_RADIUS, 40]} />
      </mesh>

      {/* Baked contact shadow. The table weighs something, and this is what
          says so; a shadow map aimed under a table nobody can see under would
          cost a render pass to say the same thing worse. */}
      <mesh
        position={[0, 0.008, 0]}
        rotation-x={-Math.PI / 2}
        renderOrder={-2}
        material={contactShadowMaterial(0.72)}
      >
        <circleGeometry args={[CONTACT_RADIUS, 32]} />
      </mesh>
    </group>
  );
}
