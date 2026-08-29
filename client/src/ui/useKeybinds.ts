import { useEffect, useRef } from "react";
import {
  isTypingTarget,
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
