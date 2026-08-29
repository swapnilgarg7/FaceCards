/**
 * Every keyboard shortcut at the table, defined once.
 *
 * The mouse belongs to the camera. Cursor position drives the look directly
 * (see `scene/SeatedCamera.tsx`), so *reaching* for a button swings the view
 * across the table on the way there - you cannot click Call without first
 * turning your head at the floor. That is the whole reason this file exists:
 * acting should never cost you your eye-line.
 *
 * The bindings, the chips drawn on the buttons and the list in the settings
 * panel all read this one table, so a shortcut cannot end up documented as one
 * key and handled as another.
 *
 * **W, A, S and D are reserved and must stay unbound.** They are the obvious
 * keys for leaning or shifting seat position later, and a shortcut that has to
 * be taken away from players once they have learned it is worse than one that
 * was never offered. `keybinds.test.ts` fails if anything claims them.
 */

export const RESERVED_KEYS = ["w", "a", "s", "d"] as const;

export type KeybindId =
  | "fold"
  | "checkCall"
  | "raise"
  | "allIn"
  | "raiseDown"
  | "raiseUp"
  | "raiseMin"
  | "raiseMax"
  | "settings"
  | "mute"
  | "camera";

export interface Keybind {
  id: KeybindId;
  /**
   * A single letter, or a `KeyboardEvent.key` name for a non-printing key.
   * Letters match case-insensitively.
   */
  key: string;
  /** Shift must be held. Absent means it must not be. */
  shift?: boolean;
  /** What the shortcut does, in the words the UI uses for it. */
  label: string;
}

/**
 * Ordered as the settings panel lists them: the four things you do on your
 * turn, then the ways to size a raise, then the room controls.
 */
export const KEYBINDS: readonly Keybind[] = [
  { id: "fold", key: "f", label: "Fold" },
  { id: "checkCall", key: "c", label: "Check or call" },
  { id: "raise", key: "r", label: "Bet or raise to the amount shown" },
  { id: "allIn", key: "r", shift: true, label: "All in" },
  { id: "raiseDown", key: "ArrowLeft", label: "Lower the raise" },
  { id: "raiseUp", key: "ArrowRight", label: "Raise the raise" },
  { id: "raiseMin", key: "Home", label: "Minimum raise" },
  { id: "raiseMax", key: "End", label: "Maximum raise" },
  { id: "settings", key: "Escape", label: "Settings" },
  { id: "mute", key: "m", label: "Mute or unmute" },
  { id: "camera", key: "v", label: "Camera on or off" },
];

const BY_ID = new Map(KEYBINDS.map((bind) => [bind.id, bind]));

export function keybind(id: KeybindId): Keybind {
  const bind = BY_ID.get(id);
  if (!bind) throw new Error(`no keybind for ${id}`);
  return bind;
}

/** Pretty names for keys whose `event.key` is not what a player calls them. */
const KEY_NAMES: Record<string, string> = {
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
};

/** What to print on the chip: "F", "Esc", "⇧R". */
export function keyLabel(id: KeybindId): string {
  const bind = keybind(id);
  const name =
    KEY_NAMES[bind.key] ??
    (bind.key.length === 1 ? bind.key.toUpperCase() : bind.key);
  return bind.shift ? `⇧${name}` : name;
}

/**
 * Should this event be ignored because the player is typing?
 *
 * Without it, "c" in the display-name field would fold instead of appearing,
 * and the sensitivity slider would eat its own arrow keys.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The binding this event fires, if any.
 *
 * Modifier matching is exact, which is what keeps R and Shift+R distinct. Any
 * event carrying Ctrl, Alt or Meta belongs to the browser or the OS, never to
 * the table.
 */
export function matchKeybind(event: KeyboardEvent): Keybind | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) return undefined;

  const pressed = event.key;
  const lower = pressed.length === 1 ? pressed.toLowerCase() : pressed;

  return KEYBINDS.find(
    (bind) => bind.key === lower && Boolean(bind.shift) === event.shiftKey,
  );
}
