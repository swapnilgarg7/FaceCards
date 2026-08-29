import {
  AVATAR_IDS,
  isAvatarId,
  type AvatarId,
} from "@facecards/shared";

/**
 * Which archetype a joining player actually sits down as.
 *
 * A request, resolved server-side, for the same reason every other client
 * field is: the id is dereferenced by six other machines, so an id this build
 * does not ship must never reach the schema.
 *
 * Two people are allowed to be the same archetype - friends turning up in
 * matching hats is a feature, and refusing it would mean the lobby's choice
 * could be silently overridden by whoever clicked first. What the fallback
 * does avoid is *accidental* duplication: someone who expressed no preference
 * gets the first archetype nobody is wearing, so a table that fills up with
 * defaults still looks like six different people.
 */
export function pickAvatar(
  requested: unknown,
  taken: Iterable<string>,
  seat: number,
): AvatarId {
  if (isAvatarId(requested)) return requested;

  const inUse = new Set(taken);
  const free = AVATAR_IDS.find((id) => !inUse.has(id));
  if (free) return free;

  // More seats than archetypes, which the ten-seat ceiling allows for. Index
  // rather than repeat the first one, so the wrap is still spread out.
  return AVATAR_IDS[seat % AVATAR_IDS.length]!;
}
