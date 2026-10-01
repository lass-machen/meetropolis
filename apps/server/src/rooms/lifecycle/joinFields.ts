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

/**
 * Longest identity a join without a verified token may claim. An identity is
 * the account id the server issued (a 25-character cuid) or the identity of an
 * NPC, which is 'npc-' plus the at most 100 characters the NPC API allows
 * (see api/routes/npcs.ts), so no identity the server knows is longer. An
 * identity is a key, not a label: it is refused when too long, never cut, so a
 * cut can not turn one identity into another.
 */
export const MAX_JOIN_IDENTITY_LENGTH = 104;

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** A facing direction in the room state. */
export type JoinDirection = (typeof DIRECTIONS)[number];

/** The direction a joining player faces when the client names none, or none that is valid. */
export const DEFAULT_JOIN_DIRECTION: JoinDirection = 'down';

/**
 * The direction a client names for its join: one of the four values the rest of
 * the API accepts for a direction (the NPC and position schemas), otherwise the
 * default. The value goes into the room state as it is, so anything else, a
 * 900 KB string included, must never get there.
 */
export function joinDirection(value: unknown): JoinDirection {
  const known = DIRECTIONS.find((direction) => direction === value);
  return known ?? DEFAULT_JOIN_DIRECTION;
}
