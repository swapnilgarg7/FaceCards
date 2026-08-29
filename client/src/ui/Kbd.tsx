import { keyLabel, keybind, type KeybindId } from "./keybinds.js";
import { useView } from "./useViewport.js";

/**
 * The key chip printed on a control.
 *
 * It reads its letter from the binding table rather than taking a string, so a
 * chip can never advertise a key that is not the one actually wired up.
 *
 * On a touchscreen it prints nothing at all. A phone has no F to press, and a
 * chip saying so is a control made wider, and a decision made slower, by an
 * instruction that cannot be followed. Every chip in the product goes through
 * this one component, so this is the whole of "no key hints on a phone" - the
 * buttons underneath are unchanged, and a Bluetooth keyboard still works, it
 * is only no longer advertised.
 */
export function Kbd({ bind }: { bind: KeybindId }) {
  const { touch } = useView();
  if (touch) return null;

  return (
    <kbd className="kbd" title={keybind(bind).label}>
      {keyLabel(bind)}
    </kbd>
  );
}
