import { describe, expect, it } from "vitest";
import {
  KEYBINDS,
  RESERVED_KEYS,
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
  it("leaves W, A, S and D alone for camera movement later", () => {
    // The point of the test: taking a shortcut away from players after they
    // have learned it is worse than never offering it, so this fails loudly
    // the moment someone reaches for a movement key.
    for (const reserved of RESERVED_KEYS) {
      const clash = KEYBINDS.find((bind) => bind.key.toLowerCase() === reserved);
      expect(clash, `${reserved.toUpperCase()} is reserved`).toBeUndefined();
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

  it("does not fire on a reserved movement key", () => {
    for (const reserved of RESERVED_KEYS) {
      expect(matchKeybind(press(reserved))).toBeUndefined();
      expect(matchKeybind(press(reserved.toUpperCase()))).toBeUndefined();
    }
  });

  it("does not fire on a key nothing is bound to", () => {
    expect(matchKeybind(press("q"))).toBeUndefined();
    expect(matchKeybind(press("Tab"))).toBeUndefined();
  });
});
