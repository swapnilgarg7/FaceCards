import { useEffect, useRef } from "react";
import {
  isTypingTarget,
  keybind,
  matchKeybind,
  type KeybindId,
} from "./keybinds.js";

/**
 * Wire a set of keyboard shortcuts up to handlers.
 *
 * A handler that is absent or undefined means the shortcut is not available
 * right now, and the key does nothing at all - it does not fall through to the
 * browser and it does not fire a disabled action. That is how "you cannot
 * check facing a bet" is expressed: `checkCall` simply has no handler when
 * there is nothing to check.
 *
 * Handlers are read through a ref so that passing fresh closures every render
 * - which a component holding the raise amount in state necessarily does -
 * does not tear the listener down and rebuild it on every keystroke.
 */
export type KeybindHandlers = Partial<
  Record<KeybindId, (() => void) | undefined>
>;

export function useKeybinds(handlers: KeybindHandlers, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  const active = useRef(enabled);
  active.current = enabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active.current) return;
      // Typing a name, or dragging the sensitivity slider with the arrow keys,
      // is not a table action.
      if (isTypingTarget(event.target)) return;
      if (event.repeat) return;

      const bind = matchKeybind(event);
      if (!bind) return;
      // A held binding has a beginning and an end and belongs to
      // `useHoldKeybind`. Firing it here as well would peek once on keydown
      // and never put the cards back.
      if (bind.hold) return;

      const handler = latest.current[bind.id];
      if (!handler) return;

      // Claimed. Nothing else, including a focused button's own Space or
      // Enter activation, should also act on it.
      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Wire a *held* shortcut: `onChange(true)` while the key is down, and
 * `onChange(false)` the moment it is not.
 *
 * Separate from `useKeybinds` because letting go is an event too, and a
 * keydown-only dispatcher has nowhere to put it. Holding a key to look at your
 * cards is the one binding in the game that works this way, and it works that
 * way because that is what the gesture is: you are holding the corner of a
 * card up, and the moment you stop, it is face down again.
 *
 * Three ways out, and all three are needed. Keyup is the ordinary one. Blur
 * covers alt-tabbing away mid-peek, which would otherwise leave the cards up
 * for whoever walked past the screen. `enabled` going false covers a menu
 * opening over the top.
 */
export function useHoldKeybind(
  id: KeybindId,
  onChange: (held: boolean) => void,
  enabled = true,
): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  const active = useRef(enabled);
  const held = useRef(false);

  useEffect(() => {
    active.current = enabled;
    if (!enabled && held.current) {
      held.current = false;
      latest.current(false);
    }
  }, [enabled]);

  useEffect(() => {
    const bind = keybind(id);
    const matches = (event: KeyboardEvent) =>
      (event.key.length === 1 ? event.key.toLowerCase() : event.key) === bind.key;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!active.current || !matches(event)) return;
      if (isTypingTarget(event.target)) return;
      // Space scrolls the page and activates a focused button. Claimed here
      // whether or not it is already held, or the first repeat would do both.
      event.preventDefault();
      if (held.current) return;
      held.current = true;
      latest.current(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!matches(event) || !held.current) return;
      held.current = false;
      latest.current(false);
    };

    const release = () => {
      if (!held.current) return;
      held.current = false;
      latest.current(false);
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
  }, [id]);
}
