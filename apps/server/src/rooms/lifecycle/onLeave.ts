import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { broadcastBubbleState } from '../utils/bubbleHelpers.js';
import { onPlayerLeaveZoneLock } from '../handlers/zoneLockHandler.js';
import { trackLeave } from '../audioZones/runtime.js';
import { isWorldAuth } from './onAuth.js';

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

// onLeave: schedule a graceful player removal after `LEAVE_GRACE_MS`.
// Behavior must match the previous override exactly, including:
// - synchronously kick off the presence persistence (fire-and-forget)
//   BEFORE arming the grace timer, so a crash within the grace window
//   still persists the position
// - replace any existing pending leave timer for the same sid
// - on commit: broadcast `player_left` on the player's mapId (or globally)
// - dissolve bubble groups losing members, drop groups < 2 members
export function performOnLeave(room: WorldRoom, client: Client, _code?: number): void {
  // Persist position + mapName before removing player (fire-and-forget)
  // Important: trigger synchronously (before the graceful timer) so the
  // position is persisted even if the process crashes during the grace window.
  const player = room.state.players.get(client.sessionId);
  if (player && player.identity && room.prismaForPresence) {
    const prisma = room.prismaForPresence;
    const { identity, x, y, direction, mapName } = player;
    const data = {
      x: Math.round(x),
      y: Math.round(y),
      direction,
      ...(mapName ? { mapName } : {}),
    };
    // Scope the presence write by the JWT-verified tenant (auth.tenantId),
    // consistent with the join-path PII scoping. NEVER write onto the shared
    // room-metadata tenant: in a shared apex/'default' room that is 'default',
    // not the leaving player's real tenant, so the position would be persisted
    // under the wrong tenant. Fall back to the room slug only for NPC /
    // token-less joins that carry no verified tenant.
    const auth = isWorldAuth(client.auth) ? client.auth : undefined;
    const authTenantId = auth?.tenantId;
    if (authTenantId) {
      prisma.presence
        .updateMany({ where: { userId: identity, tenantId: authTenantId }, data })
        .catch((e) => logger.debug('[WorldRoom] Failed to persist position on leave', e));
    } else {
      const tenantSlug = (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      prisma.tenant
        .findUnique({ where: { slug: tenantSlug }, select: { id: true } })
        .then((tenant) => {
          if (!tenant) return;
          return prisma.presence.updateMany({ where: { userId: identity, tenantId: tenant.id }, data });
        })
        .catch((e) => logger.debug('[WorldRoom] Failed to persist position on leave', e));
    }
  }

  // Idempotency: if a pending leave already exists for this sid, replace it.
  const prevTimer = room.pendingLeaves.get(client.sessionId);
  if (prevTimer) {
    clearTimeout(prevTimer);
    room.pendingLeaves.delete(client.sessionId);
  }

  const sessionId = client.sessionId;
  const mapIdForLeave = player?.mapId;
  logger.info('[WorldRoom] Player leave queued (grace):', sessionId);

  const timer = setTimeout(() => {
    // Cleanup state + auxiliary maps
    room.state.players.delete(sessionId);
    room.lastSeen.delete(sessionId);
    room.pendingLeaves.delete(sessionId);
    room.playerTenantKey.delete(sessionId);
    try {
      colyseusPlayers.dec();
    } catch (e) {
      logger.debug('[WorldRoom] Failed to decrement colyseusPlayers metric', e);
    }
    // Zone lock cleanup
    onPlayerLeaveZoneLock(room, room.zoneLockState, sessionId);
    // H4: drop audio-zone membership and notify former islandmates.
    if (player?.identity) trackLeave(room, player.identity);
    // Mirror player_joined: broadcast on the same map (fallback: global).
    if (mapIdForLeave) {
      broadcastToMap(room, mapIdForLeave, 'player_left', { id: sessionId });
    } else {
      room.broadcast('player_left', { id: sessionId });
    }
    // Remove the player from any bubble groups.
    let changed = false;
    for (const [gid, members] of Object.entries(room.bubbleGroups)) {
      if (members.includes(sessionId)) {
        room.bubbleGroups[gid] = members.filter((m) => m !== sessionId);
        changed = true;
      }
    }
    // Drop groups with fewer than two members.
    for (const [gid, members] of Object.entries(room.bubbleGroups)) {
      if (!Array.isArray(members) || members.length < 2) {
        delete room.bubbleGroups[gid];
        changed = true;
      }
    }
    if (changed) broadcastBubbleState(room);
    logger.info('[WorldRoom] Player left (graceful committed):', sessionId);
  }, room.leaveGraceMs);

  room.pendingLeaves.set(sessionId, timer);
}
