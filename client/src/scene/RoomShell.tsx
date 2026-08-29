import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  FIXTURES,
  PILASTER_COUNT,
  ROOM_HEIGHT,
  ROOM_RADIUS,
  ROOM_SEGMENTS,
  WAINSCOT_CAP,
  WAINSCOT_HEIGHT,
  neonBreath,
} from "./decor.js";
import {
  PALETTE,
  brassMaterial,
  carpetMaterial,
  glowTexture,
  ringGlowTexture,
  velvetMaterial,
  woodTexture,
} from "./surfaces.js";

/**
 * The room the table stands in.
 *
 * `plan.md`: "Do not build a large explorable casino. The table is the hero
 * asset." So this is a *shell* - eight surfaces and three rings of light,
 * nothing you could walk into and nothing with a door. It exists for one
 * reason, which is that the scene before it was a black void with fog in it,
 * and a black void does not read as a place people are sitting together.
 *
 * Everything in it is a ring. That is the same argument `seatLayout` makes and
 * it is not decorative: a neon sign on one wall is behind somebody, a sconce
 * at one bearing is over one person's shoulder and nowhere near anyone else's.
 * Anything not rotationally symmetric quietly gives one seat a better view than
 * the others, and this product cannot afford that. See `decor.ts`.
 *
 * The other rule it obeys is the face band: no fixture in here glows anywhere
 * near eye height, because at four metres the far wall is directly behind
 * somebody's head from every seat. `decor.test.ts` checks every one of them.
 */

/** A fixture by id, so the scene and the checked list cannot drift apart. */
function fixture(id: string) {
  const found = FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture "${id}"`);
  return found;
}

/** Bearing of the `index`-th pilaster. */
function pilasterBearing(index: number): number {
  return (index / PILASTER_COUNT) * Math.PI * 2;
}

const PILASTER_WIDTH = 0.22;
const PILASTER_DEPTH = 0.09;
const SCONCE_WIDTH = 0.13;
const SCONCE_HEIGHT = 0.2;
/** How wide a sconce's painted halo is on the wall behind it. */
const SCONCE_GLOW = 0.62;

export function RoomShell() {
  const cornice = fixture("cornice-neon");
  const cove = fixture("floor-cove");
  const sconce = fixture("sconces");
  const pendant = fixture("pendant");

  /**
   * This component's own copies of the painted-light materials.
   *
   * `surfaces.ts` caches materials by configuration, which is what keeps six
   * avatars from compiling six shaders - but a cached material is *shared*,
   * and the neon here breathes. Mutating a shared instance would breathe the
   * table's race and anything else that ever asked for the same colour. The
   * textures, which are the expensive half, still come from the cache.
   */
  const lights = useMemo(() => {
    const ring = (colour: string, peak: number) =>
      new THREE.MeshBasicMaterial({
        color: colour,
        map: ringGlowTexture(peak),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    const point = (colour: string) =>
      new THREE.MeshBasicMaterial({
        color: colour,
        map: glowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    const tube = (colour: string) =>
      new THREE.MeshBasicMaterial({ color: colour, toneMapped: false });

    return {
      corniceTube: tube(cornice.colour),
      corniceSpill: ring(cornice.colour, cornice.radius / ROOM_RADIUS),
      coveTube: tube(cove.colour),
      coveSpill: ring(cove.colour, cove.radius / ROOM_RADIUS),
      sconceGlow: point(sconce.colour),
      pendantGlow: point(pendant.colour),
      lampInner: tube(PALETTE.lampWarm),
    };
  }, [cornice, cove, sconce, pendant]);

  /**
   * Wall coverings need their own tiling, and `repeat` lives on the texture
   * rather than on the material. A clone shares the image - so no second
   * canvas is drawn and no extra VRAM is spent - while carrying its own UV
   * transform.
   */
  const joinery = useMemo(() => {
    const map = woodTexture().clone();
    map.needsUpdate = true;
    map.repeat.set(PILASTER_COUNT * 2, 1);
    // Two materials off one map: the dado is a cylinder seen from inside and
    // needs `BackSide`, the pilasters standing against it are solid boxes and
    // need the front. One `side` for both would either turn the wall inside
    // out or hollow out every column.
    const shared = { map, roughness: 0.5, metalness: 0.05 };
    return {
      wall: new THREE.MeshStandardMaterial({ ...shared, side: THREE.BackSide }),
      column: new THREE.MeshStandardMaterial(shared),
    };
  }, []);

  const pilasters = useRef<THREE.InstancedMesh>(null);
  const sconces = useRef<THREE.InstancedMesh>(null);
  const sconceGlows = useRef<THREE.InstancedMesh>(null);

  /**
   * Eight pilasters, eight sconces and eight halos, as three instanced meshes
   * rather than twenty-four objects. Written once on mount: nothing about a
   * wall moves, so this is a layout effect and not a frame loop.
   */
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const write = (
      mesh: THREE.InstancedMesh | null,
      radius: number,
      y: number,
    ) => {
      if (!mesh) return;
      for (let i = 0; i < PILASTER_COUNT; i++) {
        const bearing = pilasterBearing(i);
        dummy.position.set(
          Math.sin(bearing) * radius,
          y,
          Math.cos(bearing) * radius,
        );
        // Face the room's centre, which is where everybody is.
        dummy.rotation.set(0, bearing + Math.PI, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    write(pilasters.current, ROOM_RADIUS - PILASTER_DEPTH / 2, ROOM_HEIGHT / 2);
    write(sconces.current, sconce.radius, sconce.y);
    write(sconceGlows.current, sconce.radius - 0.02, sconce.y);
  }, [sconce]);

  // Materials built here rather than taken from the shared cache have to be
  // given back: the Canvas unmounts when a player leaves the table, and a
  // session that rejoined a few times would otherwise leave a shader program
  // and a uniform block behind on every visit.
  useEffect(
    () => () => {
      for (const material of Object.values(lights)) material.dispose();
      joinery.wall.dispose();
      joinery.column.dispose();
    },
    [lights, joinery],
  );

  useFrame((state) => {
    // The only motion in the room, and it is bounded at six percent by
    // `AMBIENT_MOTION_MAX`, asserted in `decor.test.ts`. Neon breathes because
    // real neon does; nothing in here swings, spins or flickers, because
    // anything that did would be a thing to look at instead of a face.
    const t = state.clock.elapsedTime;
    const pink = neonBreath(t);
    const blue = neonBreath(t, 2.2);
    lights.corniceSpill.opacity = pink;
    lights.coveSpill.opacity = blue;
    lights.sconceGlow.opacity = 0.5 + 0.5 * neonBreath(t, 4.1);
  });

  return (
    <group>
      {/* Floor. Dark and low-contrast on purpose: a real casino carpet is
          loud because it has to hide wear across an acre, and here a loud
          floor is six faces you are not looking at. */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={carpetMaterial()}>
        <circleGeometry args={[ROOM_RADIUS, ROOM_SEGMENTS]} />
      </mesh>

      {/* Velvet above, panelling below, brass where they meet. The cap is
          held under the face band on purpose: a horizontal line at chin
          height running right round the room behind everybody is the sort of
          thing nobody points at and everybody registers. */}
      <mesh position={[0, ROOM_HEIGHT / 2, 0]} material={velvetMaterial()}>
        <cylinderGeometry
          args={[ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT, ROOM_SEGMENTS, 1, true]}
        />
      </mesh>

      <mesh position={[0, WAINSCOT_HEIGHT / 2, 0]} material={joinery.wall}>
        <cylinderGeometry
          args={[
            ROOM_RADIUS - 0.01,
            ROOM_RADIUS - 0.01,
            WAINSCOT_HEIGHT,
            ROOM_SEGMENTS,
            1,
            true,
          ]}
        />
      </mesh>

      <mesh position={[0, WAINSCOT_HEIGHT, 0]} material={brassMaterial()}>
        <cylinderGeometry
          args={[
            ROOM_RADIUS - 0.005,
            ROOM_RADIUS - 0.005,
            WAINSCOT_CAP,
            ROOM_SEGMENTS,
            1,
            true,
          ]}
        />
      </mesh>

      {/* Ceiling, facing down. Nearly black: it is above the pooled light and
          the one surface no seat ever has a reason to look at. */}
      <mesh position={[0, ROOM_HEIGHT, 0]} rotation-x={Math.PI / 2}>
        <circleGeometry args={[ROOM_RADIUS, ROOM_SEGMENTS]} />
        <meshStandardMaterial color="#0d0a10" roughness={1} />
      </mesh>

      <instancedMesh
        ref={pilasters}
        geometry={pilasterGeometry}
        material={joinery.column}
        args={[undefined, undefined, PILASTER_COUNT]}
      />

      {/* --- the three races of light. Tube, then the spill it throws. */}

      <mesh
        position={[0, cornice.y, 0]}
        rotation-x={-Math.PI / 2}
        material={lights.corniceTube}
      >
        <torusGeometry args={[cornice.radius, 0.016, 6, ROOM_SEGMENTS]} />
      </mesh>
      <mesh
        position={[0, ROOM_HEIGHT - 0.02, 0]}
        rotation-x={Math.PI / 2}
        material={lights.corniceSpill}
      >
        <circleGeometry args={[ROOM_RADIUS, 40]} />
      </mesh>

      <mesh
        position={[0, cove.y, 0]}
        rotation-x={-Math.PI / 2}
        material={lights.coveTube}
      >
        <torusGeometry args={[cove.radius, 0.012, 6, ROOM_SEGMENTS]} />
      </mesh>
      <mesh
        position={[0, 0.02, 0]}
        rotation-x={-Math.PI / 2}
        material={lights.coveSpill}
      >
        <circleGeometry args={[ROOM_RADIUS, 40]} />
      </mesh>

      <instancedMesh
        ref={sconces}
        geometry={sconceGeometry}
        material={lights.lampInner}
        args={[undefined, undefined, PILASTER_COUNT]}
      />
      <instancedMesh
        ref={sconceGlows}
        geometry={sconceGlowGeometry}
        material={lights.sconceGlow}
        args={[undefined, undefined, PILASTER_COUNT]}
      />

      {/* The pendant over the table: the fixture the pooled key light in
          `Room3D` pretends to hang inside. Brass outside, hot inside, and a
          halo under it so the source reads as a source. */}
      <group position={[0, pendant.y, 0]}>
        <mesh position={[0, (ROOM_HEIGHT - pendant.y) / 2, 0]} material={brassMaterial()}>
          <cylinderGeometry args={[0.012, 0.012, ROOM_HEIGHT - pendant.y, 8]} />
        </mesh>
        <mesh material={brassMaterial()}>
          <coneGeometry args={[0.34, 0.26, 28, 1, true]} />
        </mesh>
        <mesh
          position={[0, -0.115, 0]}
          rotation-x={Math.PI / 2}
          material={lights.lampInner}
        >
          <circleGeometry args={[0.3, 24]} />
        </mesh>
        <mesh
          position={[0, -0.13, 0]}
          rotation-x={-Math.PI / 2}
          material={lights.pendantGlow}
        >
          <planeGeometry args={[1.5, 1.5]} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Shared geometries for the instanced furniture. Module-level and never
 * disposed, exactly like the card atlas: a fixed set that exists for the tab.
 */
const pilasterGeometry = new THREE.BoxGeometry(
  PILASTER_WIDTH,
  ROOM_HEIGHT,
  PILASTER_DEPTH,
);
const sconceGeometry = new THREE.BoxGeometry(
  SCONCE_WIDTH,
  SCONCE_HEIGHT,
  0.045,
);
const sconceGlowGeometry = new THREE.PlaneGeometry(SCONCE_GLOW, SCONCE_GLOW);
