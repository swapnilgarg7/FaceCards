import { useEffect, useRef, type RefObject } from "react";
import type { LookAxes } from "../scene/keyboardLook.js";
import { LOOK_AXES, LOOK_KEYBIND_IDS, isTypingTarget, keybind } from "./keybinds.js";

/**
 * Which way the held look keys are asking the view to turn, in a ref.
 *
 * A ref rather than state, and the reason is the whole reason this is its own
 * hook: the value is read once per frame inside `useFrame`, and re-rendering
 * the scene graph sixty times a second because someone is holding A is exactly
 * the thing `CLAUDE.md` forbids. Nothing in React ever needs to know a look key
 * is down.
 *
 * It cannot go through `useKeybinds` either. That dispatcher fires on keydown
 * and has nowhere to put a keyup, and `useHoldKeybind` handles one binding at a
 * time - whereas turning your head diagonally means two keys held at once, and
 * opposite keys held together must cancel rather than the last one winning.
 * Tracking the held *set* is the only shape that gets both right.
 *
 * Three ways a key stops counting, and all three are needed. Keyup is the
 * ordinary one. Blur covers alt-tabbing away mid-turn, which would otherwise
 * leave the view drifting for as long as the tab stayed in the background.
 * `enabled` going false covers a menu opening over the top, which is the same
 * moment the cursor is handed back.
 */
export function useLookKeys(enabled: boolean): RefObject<LookAxes> {
  const axes = useRef<LookAxes>({ yaw: 0, pitch: 0 });
  const held = useRef(new Set<string>());
  const active = useRef(enabled);

  useEffect(() => {
    active.current = enabled;
    if (!enabled) {
      held.current.clear();
      axes.current = { yaw: 0, pitch: 0 };
    }
  }, [enabled]);

  useEffect(() => {
    // Resolved once: the keys themselves live in the one binding table, so a
    // rebind cannot leave the settings panel documenting a key the camera does
    // not listen for.
    const byKey = new Map(
      LOOK_KEYBIND_IDS.map((id) => [keybind(id).key, LOOK_AXES[id]]),
    );

    const recompute = () => {
      let yaw = 0;
      let pitch = 0;
      for (const key of held.current) {
        const axis = byKey.get(key);
        if (!axis) continue;
        yaw += axis.yaw;
        pitch += axis.pitch;
      }
      // Opposite keys held together cancel, and a diagonal is not faster than
      // a straight turn - both fall out of summing and then clamping.
      axes.current = {
        yaw: Math.max(-1, Math.min(1, yaw)),
        pitch: Math.max(-1, Math.min(1, pitch)),
      };
    };

    const normalise = (event: KeyboardEvent) =>
      event.key.length === 1 ? event.key.toLowerCase() : event.key;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!active.current) return;
      // Ctrl+A selects, Cmd+S saves. Anything carrying a modifier belongs to
      // the browser or the OS, never to the table.
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;

      const key = normalise(event);
      if (!byKey.has(key)) return;
      event.preventDefault();
      if (held.current.has(key)) return;
      held.current.add(key);
      recompute();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // Not gated on `active`, and deliberately: a key that went down before a
      // menu opened still has to come back up, or it would stay held forever.
      const key = normalise(event);
      if (!held.current.delete(key)) return;
      recompute();
    };

    const release = () => {
      if (held.current.size === 0) return;
      held.current.clear();
      recompute();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);

  return axes;
}
