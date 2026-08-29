import { keyLabel, keybind, type KeybindId } from "./keybinds.js";

/**
 * The key chip printed on a control.
 *
 * It reads its letter from the binding table rather than taking a string, so a
 * chip can never advertise a key that is not the one actually wired up.
 */
export function Kbd({ bind }: { bind: KeybindId }) {
  return (
    <kbd className="kbd" title={keybind(bind).label}>
      {keyLabel(bind)}
    </kbd>
  );
}
