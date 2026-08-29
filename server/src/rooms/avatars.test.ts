import { describe, expect, it } from "vitest";
import { AVATARS, AVATAR_IDS, DEFAULT_AVATAR, isAvatarId } from "@facecards/shared";
import { pickAvatar } from "./avatars.js";

describe("avatar catalogue", () => {
  it("ships the six archetypes the spec names", () => {
    expect(AVATAR_IDS).toEqual([
      "cowboy",
      "businessman",
      "gentleman",
      "wizard",
      "alien",
      "shark",
    ]);
  });

  it("has a unique id and a colour per archetype", () => {
    expect(new Set(AVATAR_IDS).size).toBe(AVATARS.length);
    for (const avatar of AVATARS) {
      expect(avatar.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(avatar.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(avatar.label.length).toBeGreaterThan(0);
    }
  });

  it("recognises exactly the ids it ships", () => {
    for (const id of AVATAR_IDS) expect(isAvatarId(id)).toBe(true);
    expect(isAvatarId(DEFAULT_AVATAR)).toBe(true);
    for (const bogus of ["", "COWBOY", "ninja", 3, null, undefined, {}]) {
      expect(isAvatarId(bogus)).toBe(false);
    }
  });
});

describe("pickAvatar", () => {
  it("honours a valid request", () => {
    expect(pickAvatar("wizard", [], 0)).toBe("wizard");
  });

  it("lets two players wear the same one on purpose", () => {
    expect(pickAvatar("shark", ["shark"], 1)).toBe("shark");
  });

  it("never returns an id this build does not ship", () => {
    for (const bogus of ["ninja", "", 7, null, undefined, { id: "wizard" }]) {
      expect(isAvatarId(pickAvatar(bogus, [], 0))).toBe(true);
    }
  });

  it("gives an undecided player one nobody is wearing", () => {
    expect(pickAvatar(undefined, ["cowboy", "businessman"], 2)).toBe(
      "gentleman",
    );
  });

  it("falls back to a seat-indexed one once every archetype is taken", () => {
    const all = [...AVATAR_IDS];
    expect(pickAvatar(undefined, all, 0)).toBe(AVATAR_IDS[0]);
    expect(pickAvatar(undefined, all, AVATAR_IDS.length + 1)).toBe(
      AVATAR_IDS[1],
    );
  });
});
