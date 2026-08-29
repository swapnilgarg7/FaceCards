import { describe, expect, it } from "vitest";
import { AVATARS, AVATAR_IDS } from "@facecards/shared";
import { avatarLook } from "./archetypes.js";
import { FACE_PLANE_HEIGHT, HEAD_SCALE } from "../scene/body.js";

describe("avatarLook", () => {
  it("has geometry for every archetype the server can hand out", () => {
    for (const id of AVATAR_IDS) {
      const look = avatarLook(id);
      expect(look.id).toBe(id);
      expect(look.headPiece).toBeDefined();
    }
  });

  it("keeps the colour the lobby swatch showed", () => {
    for (const archetype of AVATARS) {
      const look = avatarLook(archetype.id);
      expect(look.body).toBe(archetype.colour);
      expect(look.accent).toBe(archetype.accent);
    }
  });

  it("gives a peer on an unknown build a body rather than throwing", () => {
    const look = avatarLook("ninja");
    expect(look.id).toBe(AVATARS[0].id);
    expect(look.headScale.every((s) => s > 0)).toBe(true);
  });

  it("stretches the shared skull rather than inventing its own", () => {
    // Every head is `HEAD_SCALE` times something close to one, so a change to
    // the proportions the face plane was tuned against still reaches all six.
    for (const id of AVATAR_IDS) {
      const [x, y, z] = avatarLook(id).headScale;
      expect(x / HEAD_SCALE.x).toBeGreaterThan(0.8);
      expect(x / HEAD_SCALE.x).toBeLessThan(1.25);
      expect(y / HEAD_SCALE.y).toBeGreaterThan(0.8);
      expect(y / HEAD_SCALE.y).toBeLessThan(1.25);
      expect(z / HEAD_SCALE.z).toBeGreaterThan(0.8);
      expect(z / HEAD_SCALE.z).toBeLessThan(1.25);
    }
  });

  it("makes the six read differently across a table", () => {
    const signatures = AVATAR_IDS.map((id) => {
      const look = avatarLook(id);
      return `${look.headPiece.kind}:${look.body}:${look.tie}`;
    });
    expect(new Set(signatures).size).toBe(AVATAR_IDS.length);
  });

  it("never puts a head piece where the face plane goes", () => {
    // The socket is the one thing phase 5's mesh swap has to preserve, so
    // nothing archetype-specific is allowed to grow into it. A head piece is
    // measured against the plane it must clear.
    for (const id of AVATAR_IDS) {
      const piece = avatarLook(id).headPiece;
      switch (piece.kind) {
        case "brim":
        case "topHat":
          expect(piece.crownHeight).toBeLessThan(FACE_PLANE_HEIGHT);
          expect(piece.brimRadius).toBeGreaterThan(piece.crownRadius);
          break;
        case "cone":
          expect(piece.radius).toBeGreaterThan(0);
          expect(piece.height).toBeGreaterThan(0);
          break;
        case "antennae":
          expect(piece.spread).toBeGreaterThan(0);
          expect(piece.bulb).toBeLessThan(piece.length);
          break;
        case "fin":
          expect(piece.height).toBeGreaterThan(0);
          break;
        case "none":
          break;
      }
    }
  });
});
