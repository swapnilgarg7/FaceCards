import { describe, expect, it } from "vitest";
import { EYE_HEIGHT, TABLE } from "./layout.js";
import { FACE_INSET, NECK_RADIUS_BOTTOM, bodyGeometry } from "./body.js";

/**
 * The regression these guard: the torso used to be a capsule as deep as it
 * was wide whose top sat at eye height, so the chest was drawn in front of
 * the lower third of the face plane and every player lost their jaw and chin
 * to a coloured blob.
 */
describe("bodyGeometry", () => {
  const body = bodyGeometry(EYE_HEIGHT);

  it("keeps the whole chin above the shoulder line, mid-breath", () => {
    expect(body.shoulderPeakY).toBeLessThan(body.facePlaneBottomY);
  });

  it("keeps the chest behind the face plane", () => {
    expect(body.chestFrontZ).toBeLessThan(FACE_INSET);
    expect(NECK_RADIUS_BOTTOM).toBeLessThan(FACE_INSET);
  });

  it("bridges shoulders to skull with no gap at either end", () => {
    const neckTop = body.neckY + body.neckHeight / 2;
    const neckBottom = body.neckY - body.neckHeight / 2;
    expect(neckTop).toBeGreaterThan(body.headBottomY);
    expect(neckBottom).toBeLessThan(body.shoulderY);
  });

  it("sits shoulders above the felt, so players are not busts in a table", () => {
    expect(body.shoulderY).toBeGreaterThan(TABLE.topY);
  });

  it("holds its proportions at any eye height", () => {
    const tall = bodyGeometry(EYE_HEIGHT + 0.2);
    expect(tall.shoulderPeakY).toBeLessThan(tall.facePlaneBottomY);
    expect(tall.shoulderY - body.shoulderY).toBeCloseTo(0.2, 10);
  });
});
