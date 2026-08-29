import { describe, expect, it } from "vitest";
import {
  KEYBINDS,
  LOOK_AXES,
  LOOK_KEYBIND_IDS,
  keyLabel,
  keybind,
  matchKeybind,
} from "./keybinds.js";

/** A keydown event without needing a DOM. */
function press(
  key: string,
  modifiers: Partial<Record<"shiftKey" | "ctrlKey" | "altKey" | "metaKey", boolean>> = {},
): KeyboardEvent {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe("the binding table", () => {
  it("gives W, A, S and D to the look, and to nothing else", () => {
    // They were held back for this, and the reason the movement keys were
    // available when the time came is that nothing else was ever allowed to
    // take them. Nothing else may take them now either.
    const movement = new Map(
      LOOK_KEYBIND_IDS.map((id) => [keybind(id).key, id]),
    );
    expect([...movement.keys()].sort()).toEqual(["a", "d", "s", "w"]);

    for (const bind of KEYBINDS) {
      const owner = movement.get(bind.key.toLowerCase());
      if (!owner) continue;
      expect(bind.id, `${bind.key.toUpperCase()} turns the head`).toBe(owner);
    }
  });

  it("points each look key at exactly one direction", () => {
    // Positive yaw is left and positive pitch is up, matching three.js, so
    // nothing between the key and the camera has to flip a sign.
    expect(LOOK_AXES.lookLeft).toEqual({ yaw: 1, pitch: 0 });
    expect(LOOK_AXES.lookUp).toEqual({ yaw: 0, pitch: 1 });
    // Opposite keys are exact opposites, so holding both cancels rather than
    // drifting slowly one way.
    expect(LOOK_AXES.lookLeft.yaw).toBe(-LOOK_AXES.lookRight.yaw);
    expect(LOOK_AXES.lookUp.pitch).toBe(-LOOK_AXES.lookDown.pitch);
    for (const id of LOOK_KEYBIND_IDS) {
      const axis = LOOK_AXES[id];
      expect(Math.abs(axis.yaw) + Math.abs(axis.pitch)).toBe(1);
    }
  });

  it("binds each key and modifier combination once", () => {
    const seen = KEYBINDS.map((bind) => `${bind.key}:${Boolean(bind.shift)}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives every binding a distinct id and a label", () => {
    const ids = KEYBINDS.map((bind) => bind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const bind of KEYBINDS) expect(bind.label.length).toBeGreaterThan(0);
  });

  it("marks every binding that is held rather than pressed", () => {
    // Peeking is a hold because that is what the gesture is: you are holding
    // the corner of a card up, and letting go puts it face down. Turning your
    // head is a hold for the same reason - a key has no position, only a
    // duration. The flag is what keeps all five out of the keydown
    // dispatcher, which has nowhere to put a keyup.
    const held = KEYBINDS.filter((bind) => bind.hold).map((bind) => bind.id);
    expect(new Set(held)).toEqual(new Set(["peek", ...LOOK_KEYBIND_IDS]));
    expect(keybind("peek").key).toBe(" ");
  });

  it("looks a binding up by id, and refuses an unknown one", () => {
    expect(keybind("fold").key).toBe("f");
    expect(() => keybind("nope" as never)).toThrow(/no keybind/);
  });
});

describe("labels", () => {
  it("prints letters uppercase and names non-printing keys", () => {
    expect(keyLabel("fold")).toBe("F");
    expect(keyLabel("settings")).toBe("Esc");
    expect(keyLabel("raiseDown")).toBe("←");
  });

  it("marks a shifted binding", () => {
    expect(keyLabel("allIn")).toBe("⇧R");
  });

  it("names the space bar rather than printing a blank chip", () => {
    expect(keyLabel("peek")).toBe("Space");
  });
});

describe("matching", () => {
  it("matches a letter in either case", () => {
    expect(matchKeybind(press("f"))?.id).toBe("fold");
    expect(matchKeybind(press("F"))?.id).toBe("fold");
  });

  it("keeps R and Shift+R apart", () => {
    expect(matchKeybind(press("r"))?.id).toBe("raise");
    expect(matchKeybind(press("R", { shiftKey: true }))?.id).toBe("allIn");
  });

  it("matches named keys", () => {
    expect(matchKeybind(press("Escape"))?.id).toBe("settings");
    expect(matchKeybind(press("ArrowRight"))?.id).toBe("raiseUp");
  });

  it("leaves browser and OS shortcuts alone", () => {
    expect(matchKeybind(press("r", { ctrlKey: true }))).toBeUndefined();
    expect(matchKeybind(press("f", { metaKey: true }))).toBeUndefined();
    expect(matchKeybind(press("c", { altKey: true }))).toBeUndefined();
  });

  it("recognises the movement keys in either case", () => {
    expect(matchKeybind(press("a"))?.id).toBe("lookLeft");
    expect(matchKeybind(press("D"))?.id).toBe("lookRight");
    expect(matchKeybind(press("w"))?.id).toBe("lookUp");
    expect(matchKeybind(press("S"))?.id).toBe("lookDown");
  });

  it("keeps the movement keys out of the keydown dispatcher", () => {
    // `useKeybinds` refuses to fire anything flagged `hold`, so W, A, S and D
    // reach `useLookKeys` and nothing else. Firing them here as well would
    // turn the head once per press and never turn it back.
    for (const id of LOOK_KEYBIND_IDS) {
      expect(matchKeybind(press(keybind(id).key))?.hold).toBe(true);
    }
  });

  it("leaves a movement key to the browser when a modifier is down", () => {
    expect(matchKeybind(press("a", { ctrlKey: true }))).toBeUndefined();
    expect(matchKeybind(press("s", { metaKey: true }))).toBeUndefined();
  });

  it("hands a held key to the dispatcher that knows about letting go", () => {
    // `matchKeybind` still recognises it - the table is one binding table -
    // but `useKeybinds` refuses to fire a hold, because a keydown-only
    // dispatcher has nowhere to put the keyup.
    expect(matchKeybind(press(" "))?.id).toBe("peek");
    expect(matchKeybind(press(" "))?.hold).toBe(true);
  });

  it("does not fire on a key nothing is bound to", () => {
    expect(matchKeybind(press("q"))).toBeUndefined();
    expect(matchKeybind(press("Tab"))).toBeUndefined();
  });
});
