/**
 * Bounds for the client-supplied join options that end up in the room state.
 *
 * Join options come off the wire unvalidated, and everything in the room state
 * is synchronised to every peer, so a client that sends a 900 KB string for a
 * field that is copied into the state makes every peer download it. The
 * helpers here are the one place that decides how such a value is bounded.
 */

/**
 * Longest free-text value from a join (a display name) that may reach the room
 * state. It matches the 200-character cap the NPC API puts on `Npc.name`, the
 * only existing cap on a display name and one that ends up in the very same
 * `Player.name` field.
 */
export const MAX_JOIN_TEXT_LENGTH = 200;

/**
 * A client-supplied display text for the room state: the value itself when it
 * is a string of at most MAX_JOIN_TEXT_LENGTH characters, a longer string cut
 * to that length, and an empty string for anything that is not a string, so a
 * caller can fall back with `||`. A cut never leaves half of a surrogate pair
 * behind, because a lone surrogate is not valid text on the wire.
 */
export function clampJoinText(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (value.length <= MAX_JOIN_TEXT_LENGTH) return value;
  const cut = value.slice(0, MAX_JOIN_TEXT_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  const endsInHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return endsInHighSurrogate ? cut.slice(0, -1) : cut;
}
