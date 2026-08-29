/**
 * The avatar library (spec section 5, plan phase 3).
 *
 * Six archetypes, shared by both ends: the lobby renders this list, the server
 * validates a join option against it, and the scene keys its geometry off the
 * same ids. One definition, so a client cannot claim an archetype the server
 * has never heard of and the scene cannot be asked to draw one it has no
 * geometry for.
 *
 * **No asset ships with this list.** Phase 3 differentiates archetypes with
 * procedural geometry and a palette, because the point of doing it now is the
 * *plumbing*: an id that survives join, sanitisation, schema, snapshot and
 * scene, with a face-plane socket that does not care which archetype is under
 * it. Phase 5 swaps the primitives for the Quaternius modular bodies, and the
 * only contract that has to survive that swap is this id and that socket. The
 * licence audit in `docs/ASSET-CREDITS.md` starts when a mesh does.
 */

export interface AvatarArchetype {
  id: string;
  /** What the lobby calls it. */
  label: string;
  /** One line of flavour, shown under the label in the picker. */
  blurb: string;
  /**
   * Body colour, in both ends' hands: the picker swatch and the scene's torso
   * are the same value, so what someone chose is what they sit down as.
   */
  colour: string;
  /** Secondary colour, used by the accessory and trim. */
  accent: string;
}

export const AVATARS = [
  {
    id: "cowboy",
    label: "Cowboy",
    blurb: "Wide brim, wider bluffs.",
    colour: "#a2653a",
    accent: "#e8d3a9",
  },
  {
    id: "businessman",
    label: "Businessman",
    blurb: "Here on expenses.",
    colour: "#2f3a4f",
    accent: "#c0392b",
  },
  {
    id: "gentleman",
    label: "Gentleman",
    blurb: "Top hat, no tell.",
    colour: "#1f2430",
    accent: "#d8c27a",
  },
  {
    id: "wizard",
    label: "Wizard",
    blurb: "Claims not to count cards.",
    colour: "#4c3f8f",
    accent: "#8fd0ff",
  },
  {
    id: "alien",
    label: "Alien",
    blurb: "Reads minds, badly.",
    colour: "#2f8f6b",
    accent: "#b6ff8f",
  },
  {
    id: "shark",
    label: "Shark",
    blurb: "Exactly what it looks like.",
    colour: "#5a6f80",
    accent: "#dfe7ee",
  },
] as const satisfies readonly AvatarArchetype[];

export type AvatarId = (typeof AVATARS)[number]["id"];

export const AVATAR_IDS: readonly AvatarId[] = AVATARS.map((a) => a.id);

/** Used when a client sends nothing, or something this build does not know. */
export const DEFAULT_AVATAR: AvatarId = "cowboy";

/**
 * Is this an archetype this build ships?
 *
 * A display name is sanitised because it is rendered; an avatar id is
 * *validated* because it is dereferenced. An unknown id reaching the scene is
 * a lookup miss on every client in the room, not a cosmetic problem.
 */
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATAR_IDS as readonly string[]).includes(value);
}

/** The archetype record for an id, falling back rather than throwing. */
export function avatarById(id: string): AvatarArchetype {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}
