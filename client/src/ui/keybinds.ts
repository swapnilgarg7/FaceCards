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
 * **W, A, S and D turn your head.** They were held back for exactly this and
 * nothing else has been allowed to claim them since, which is why they were
 * free when it was time to use them. They are *held*, not pressed, and they
 * compose with the cursor rather than replacing it: see
 * `scene/keyboardLook.ts` for what a held look key means and
 * `useLookKeys` for how the holding is tracked.
 */

export type KeybindId =
  | "peek"
  | "lookLeft"
  | "lookRight"
  | "lookUp"
  | "lookDown"
  | "fold"
  | "checkCall"
  | "raise"
  | "allIn"
  | "raiseDown"
  | "raiseUp"
  | "raiseMin"
  | "raiseMax"
  | "raisePot"
  | "raiseHalfPot"
  | "raiseType"
  | "nextHand"
  | "standings"
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
  /**
   * The action lasts as long as the key is down.
   *
   * A held binding is not wired through `useKeybinds`, which fires on keydown
   * and knows nothing about letting go. It goes through `useHoldKeybind`
   * instead. The flag lives here so the settings panel can say "hold" rather
   * than "press", and so nothing can bind a hold key twice by accident.
   */
  hold?: boolean;
}

/**
 * Ordered as the settings panel lists them: turning your head and looking at
 * your hand, the four things you do on your turn, then the ways to size a
 * raise, then the room controls.
 */
export const KEYBINDS: readonly Keybind[] = [
  { id: "lookLeft", key: "a", hold: true, label: "Look left" },
  { id: "lookRight", key: "d", hold: true, label: "Look right" },
  { id: "lookUp", key: "w", hold: true, label: "Look up" },
  { id: "lookDown", key: "s", hold: true, label: "Look down" },
  {
    id: "peek",
    key: " ",
    hold: true,
    label: "Hold to look at your cards",
  },
  { id: "fold", key: "f", label: "Fold" },
  { id: "checkCall", key: "c", label: "Check or call" },
  { id: "raise", key: "r", label: "Bet or raise to the amount shown" },
  { id: "allIn", key: "r", shift: true, label: "All in" },
  { id: "raiseDown", key: "ArrowLeft", label: "Lower the raise" },
  { id: "raiseUp", key: "ArrowRight", label: "Raise the raise" },
  { id: "raiseMin", key: "Home", label: "Minimum raise" },
  { id: "raiseMax", key: "End", label: "Maximum raise" },
  // The two sizes a player says out loud, on one key each. Stepping up to a
  // pot-sized bet a blind at a time is thirty presses of an arrow; the arrows
  // stay for the times the size on screen is already nearly right.
  { id: "raisePot", key: "p", label: "Size a pot-sized bet" },
  { id: "raiseHalfPot", key: "p", shift: true, label: "Size a half-pot bet" },
  // The escape hatch from all of the above: a player who already knows the
  // number should never have to reach for the mouse to type it, because
  // reaching for the mouse is what swings the camera.
  { id: "raiseType", key: "t", label: "Type an exact amount" },
  // Only ever live over a payout, where nothing else on this list can fire:
  // there is no seat on the clock to fold, check or raise for.
  { id: "nextHand", key: "Enter", label: "Skip ahead, then deal the next hand" },
  // The standings are read between hands and are in the way during one, so
  // they get a key rather than only a button: hiding them has to be as cheap
  // as glancing at them, or nobody hides them and the panel just sits over the
  // table forever.
  { id: "standings", key: "b", label: "Show or hide the standings" },
  { id: "settings", key: "Escape", label: "Settings" },
  { id: "mute", key: "m", label: "Mute or unmute" },
  { id: "camera", key: "v", label: "Camera on or off" },
];

/**
 * Which way each look key pushes the view, as an axis pair.
 *
 * Positive yaw is to the left and positive pitch is up, matching three.js's
 * rotation signs, so nothing between here and the camera has to remember to
 * flip anything.
 */
export const LOOK_AXES: Readonly<
  Record<"lookLeft" | "lookRight" | "lookUp" | "lookDown", {
    yaw: number;
    pitch: number;
  }>
> = {
  lookLeft: { yaw: 1, pitch: 0 },
  lookRight: { yaw: -1, pitch: 0 },
  lookUp: { yaw: 0, pitch: 1 },
  lookDown: { yaw: 0, pitch: -1 },
};

/** The four keys that turn your head, in the order the settings panel lists. */
export const LOOK_KEYBIND_IDS = Object.keys(LOOK_AXES) as (keyof typeof LOOK_AXES)[];

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
  Enter: "⏎",
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
