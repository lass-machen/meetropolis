/**
 * Pure island/allow-list computation for H4 audio-zone privacy.
 *
 * An "island" is the audio-visibility group a participant currently
 * belongs to: `mapId:zone:<name>` while standing inside a zone polygon,
 * or `mapId:open` otherwise. Two participants may hear/see each other's
 * LiveKit tracks only when they share the exact same island id.
 *
 * No I/O here — this module only computes ids and diffs a snapshot.
 * Keeping it pure makes the membership/hysteresis and diff-engine logic
 * independently unit-testable without a Colyseus room or a database.
 */

const ZONE_MARKER = ':zone:';

export function islandOf(mapId: string, zoneName: string | null): string {
  return zoneName ? `${mapId}${ZONE_MARKER}${zoneName}` : `${mapId}:open`;
}

// A zone island is strictly more private than the map's open-world island.
export function isZoneIsland(island: string): boolean {
  return island.includes(ZONE_MARKER);
}

// Unique per identity, shared by no one else. Used as a transient
// "no association" island while a participant is leaving a zone but has
// not yet been confirmed (via hysteresis) to have arrived at their next
// island. See membershipTracker.ts for the state machine that uses this.
export function isolatedIslandFor(identity: string): string {
  return `isolated:${identity}`;
}

export type IslandSnapshot = ReadonlyMap<string, string>;

export function membersOfIsland(island: string, snapshot: IslandSnapshot): string[] {
  const out: string[] = [];
  for (const [identity, memberIsland] of snapshot) {
    if (memberIsland === island) out.push(identity);
  }
  return out;
}

// The LiveKit `setTrackSubscriptionPermissions` allow-list for one
// publisher: every other identity that currently shares its island.
export function allowListFor(identity: string, snapshot: IslandSnapshot): string[] {
  const island = snapshot.get(identity);
  if (!island) return [];
  return membersOfIsland(island, snapshot).filter((other) => other !== identity);
}

/**
 * Every identity whose allow-list may have changed as a result of one
 * participant's island transition: the mover, everyone who shared their
 * old island (they just lost the mover), and everyone who shares their
 * new island (they just gained the mover).
 *
 * `beforeSnapshot`/`afterSnapshot` may be the same map reference when the
 * caller has already applied the mutation in place and only needs the
 * post-transition membership; pass the pre-mutation snapshot explicitly
 * when old-island membership must reflect the state before the move.
 */
export function computeAffectedIdentities(
  mover: string,
  oldIsland: string | null,
  newIsland: string,
  beforeSnapshot: IslandSnapshot,
  afterSnapshot: IslandSnapshot,
): Set<string> {
  const affected = new Set<string>([mover]);
  if (oldIsland) {
    for (const identity of membersOfIsland(oldIsland, beforeSnapshot)) affected.add(identity);
  }
  for (const identity of membersOfIsland(newIsland, afterSnapshot)) affected.add(identity);
  return affected;
}
