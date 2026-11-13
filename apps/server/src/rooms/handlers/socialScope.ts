import type { Client } from 'colyseus';
import type { ZoneLockInfo } from '@meetropolis/shared';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { NO_TENANT_KEY, isPlayerVisibleToTenant, tenantKeyForClient } from '../lifecycle/tenantView.js';

/**
 * Shared scope checks for the social room features (bubble groups and zone
 * locks).
 *
 * Every social operation is bound to the sender: the tenant proven by the
 * verified auth of its client and the map the server keeps for that seat. A
 * client never names its own scope - the room state and the tenant registry
 * decide. The very same scope decides what a recipient is allowed to see
 * (bubble groups, zone locks), so a second tenant that shares the room
 * instance never observes foreign state.
 *
 * The tenant key is the verified tenant id (`tenantKeyForClient` for the
 * sender, `room.playerTenantKey` for any other seat). A seat without a proven
 * tenant has no scope at all and is never accepted.
 */
export interface SocialScope {
  /** The seat the scope belongs to. */
  sessionId: string;
  /** Verified tenant key of the seat. */
  tenantKey: string;
  /** The verified tenant id, used for database proofs. */
  tenantId: string;
  /** The server-side map the seat currently stands on. */
  mapId: string;
}

/** One bubble group as a recipient sees it. */
export interface BubbleGroupView {
  id: string;
  members: string[];
}

/** The bubble state of one recipient. */
export interface BubbleStateView {
  groups: BubbleGroupView[];
  members: string[];
}

/** The seat of a client, if it is seated and has a proven tenant. */
export function senderScope(room: WorldRoom, client: Client): SocialScope | null {
  const tenantKey = tenantKeyForClient(client);
  if (!tenantKey || tenantKey === NO_TENANT_KEY) return null;
  const player = room.state?.players?.get(client.sessionId);
  if (!player) return null;
  return { sessionId: client.sessionId, tenantKey, tenantId: tenantKey, mapId: player.mapId };
}

/** The scope of any seat, taken from the room's own tenant registry. */
export function sessionScope(room: WorldRoom, sessionId: string): SocialScope | null {
  const player = room.state?.players?.get(sessionId);
  if (!player) return null;
  const tenantKey = room.playerTenantKey.get(sessionId);
  if (!tenantKey || tenantKey === NO_TENANT_KEY) return null;
  return { sessionId, tenantKey, tenantId: tenantKey, mapId: player.mapId };
}

/**
 * Does the seat still live in the given scope? Used after every await: a
 * sender that left the room or switched maps in the meantime must not be able
 * to finish the operation it started.
 */
export function sameScope(room: WorldRoom, sessionId: string, scope: SocialScope): boolean {
  const current = sessionScope(room, sessionId);
  return current !== null && current.tenantKey === scope.tenantKey && current.mapId === scope.mapId;
}

/** The bubble state one recipient may see: only groups inside its own scope. */
export function bubbleStateForClient(room: WorldRoom, client: Client): BubbleStateView {
  const viewerKey = tenantKeyForClient(client);
  const viewer = room.state?.players?.get(client.sessionId);
  const viewerMapId = viewer?.mapId;
  const groups: BubbleGroupView[] = [];
  for (const [id, rawMembers] of Object.entries(room.bubbleGroups)) {
    const members = rawMembers.filter((member) => room.state.players.has(member));
    if (members.length < 2) continue;
    if (!members.every((member) => memberInScope(room, member, viewerKey, viewerMapId))) continue;
    groups.push({ id, members });
  }
  const members: string[] = [];
  for (const group of groups) {
    for (const member of group.members) {
      if (!members.includes(member)) members.push(member);
    }
  }
  return { groups, members };
}

/** Send the bubble state to every client, each one scoped to its own tenant and map. */
export function broadcastBubbleStateToClients(room: WorldRoom): void {
  for (const client of room.clients) {
    client.send('bubble_state', bubbleStateForClient(room, client));
  }
}

/**
 * The zone locks one recipient may see. A lock belongs to the tenant of the
 * seats that hold it and to the map it was created on, so a recipient only
 * sees locks of its own tenant on its own map. The envelope (zone name, map
 * id, session ids) carries no personal data; the pending requests of other
 * tenants are stripped.
 */
export function zoneLocksForClient(room: WorldRoom, client: Client): ZoneLockInfo[] {
  const viewerKey = tenantKeyForClient(client);
  const viewer = room.state?.players?.get(client.sessionId);
  const viewerMapId = viewer?.mapId;
  const visible: ZoneLockInfo[] = [];
  for (const lock of room.zoneLockState.locks.values()) {
    const lockView = visibleLock(room, lock, viewerKey, viewerMapId);
    if (lockView) visible.push(lockView);
  }
  return visible;
}

/**
 * Does the zone belong to the tenant and the map of the scope? The database
 * decides, never the client. Fails closed when the lookup fails.
 */
export async function zoneBelongsToScope(prisma: PrismaClient, scope: SocialScope, zoneName: string): Promise<boolean> {
  try {
    const zone = await prisma.zone.findFirst({
      where: { tenantId: scope.tenantId, mapId: scope.mapId, name: zoneName },
      select: { id: true },
    });
    return zone !== null;
  } catch (e) {
    logger.debug('[WorldRoom] Zone ownership lookup failed', e);
    return false;
  }
}

/** Is the seat part of the recipient's tenant and map? */
function memberInScope(
  room: WorldRoom,
  sessionId: string,
  viewerKey: string,
  viewerMapId: string | undefined,
): boolean {
  const player = room.state?.players?.get(sessionId);
  if (!player) return false;
  if (viewerMapId !== undefined && player.mapId !== viewerMapId) return false;
  const ownerKey = room.playerTenantKey.get(sessionId);
  return ownerKey !== undefined && ownerKey === viewerKey;
}

/** The lock as one recipient may see it, or null when it stays hidden. */
function visibleLock(
  room: WorldRoom,
  lock: ZoneLockInfo,
  viewerKey: string,
  viewerMapId: string | undefined,
): ZoneLockInfo | null {
  if (viewerMapId !== undefined && lock.mapId !== viewerMapId) return null;
  const ownerKeys = lockOwnerKeys(room, lock);
  if (ownerKeys.size > 0 && !ownerKeys.has(viewerKey)) return null;
  const pendingRequests = lock.pendingRequests.filter((request) =>
    isPlayerVisibleToTenant(false, room.playerTenantKey.get(request.sessionId), viewerKey),
  );
  if (pendingRequests.length === lock.pendingRequests.length) return lock;
  return { ...lock, pendingRequests };
}

/** The verified tenants of the seats that hold a lock. */
function lockOwnerKeys(room: WorldRoom, lock: ZoneLockInfo): Set<string> {
  const keys = new Set<string>();
  for (const sessionId of [lock.lockedBy, ...lock.accessList]) {
    const key = room.playerTenantKey.get(sessionId);
    if (key) keys.add(key);
  }
  return keys;
}
