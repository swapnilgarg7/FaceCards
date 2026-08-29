import { describe, expect, it } from "vitest";
import { deviceProfile, sameProfile } from "./viewport.js";

describe("deviceProfile", () => {
  it("calls a desktop window neither compact nor touch", () => {
    const p = deviceProfile({ width: 1440, height: 900, coarsePointer: false });
    expect(p).toEqual({ compact: false, touch: false, handheld: false });
  });

  it("calls a phone in portrait handheld", () => {
    const p = deviceProfile({ width: 390, height: 844, coarsePointer: true });
    expect(p).toEqual({ compact: true, touch: true, handheld: true });
  });

  it("calls a phone in landscape handheld, on height alone", () => {
    // Wider than the width threshold: without the height check this would
    // read as a desktop window and keep a full-height standings column over a
    // room 430px tall.
    const p = deviceProfile({ width: 932, height: 430, coarsePointer: true });
    expect(p.compact).toBe(true);
    expect(p.handheld).toBe(true);
  });

  it("keeps a narrow desktop window on the keyboard", () => {
    // Compact, so the HUD is laid out again - but there is still a cursor and
    // still a keyboard, so nothing about the shortcuts changes.
    const p = deviceProfile({ width: 700, height: 900, coarsePointer: false });
    expect(p.compact).toBe(true);
    expect(p.touch).toBe(false);
    expect(p.handheld).toBe(false);
  });

  it("keeps a tablet's standings column and drops its key chips", () => {
    const p = deviceProfile({ width: 1024, height: 1366, coarsePointer: true });
    expect(p.compact).toBe(false);
    expect(p.touch).toBe(true);
    expect(p.handheld).toBe(false);
  });
});

describe("sameProfile", () => {
  it("is true for equal profiles and false otherwise", () => {
    const a = deviceProfile({ width: 390, height: 844, coarsePointer: true });
    const b = deviceProfile({ width: 412, height: 915, coarsePointer: true });
    const c = deviceProfile({ width: 1440, height: 900, coarsePointer: false });
    expect(sameProfile(a, b)).toBe(true);
    expect(sameProfile(a, c)).toBe(false);
  });
});
