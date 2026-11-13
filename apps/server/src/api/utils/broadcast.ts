import crypto from 'node:crypto';
import { logger } from '../../logger.js';

/** Process identity: rooms skip revocation messages they already applied locally. */
export const PROCESS_ID = crypto.randomUUID();

// `gameServer` and `activeWorldRooms` are declared once, in types/global.d.ts.
// This file used to re-declare both with shapes of its own; the duplicate is a
// TS2403 that `skipLibCheck` swallows, and the two descriptions had already
// drifted apart (see the note there).

export function broadcastMapUpdate(tenantSlug: string, type: string, payload: unknown): void {
  const gameServer = global.gameServer;
  if (gameServer?.presence) {
    try {
      void gameServer.presence.publish(`map_update:${tenantSlug}`, { type, payload });
    } catch (e: unknown) {
      logger.error('[Broadcast] presence publish failed', { error: e instanceof Error ? e.message : String(e) });
    }
  } else {
    const rooms = Array.from((global.activeWorldRooms || new Set()).values());
    for (const room of rooms) {
      try {
        room.broadcast?.(type, payload);
      } catch (e: unknown) {
        logger.debug?.('[Broadcast] room broadcast failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

export function broadcastSpawnUpdate(mapId: string, spawn: { x: number; y: number }): void {
  const rooms = Array.from((global.activeWorldRooms || new Set()).values());
  for (const room of rooms) {
    try {
      room.setDefaultSpawn?.(mapId, spawn);
    } catch {}
  }
}

/** Presence channel on which every world room learns that a user lost access. */
export const ACCESS_REVOKED_CHANNEL = 'access_revoked';

/**
 * Tell every world room, in any process, that `userId` lost access (member
 * removed, account deleted, guest revoked), so the user's open world
 * connections end at once. Each room decides per session, by its verified
 * tenant, which clients must leave. Call it only after the change is
 * committed. The rooms' periodic access sweep (rooms/lifecycle/guestExpiry.ts)
 * stays the safety net when a message is lost.
 *
 * Local rooms revoke first, synchronously: even when the publish below
 * fails, this process no longer keeps a revoked session.
 */
export function broadcastAccessRevoked(userId: string): void {
  for (const room of global.activeWorldRooms ?? []) {
    try {
      room.revokeAccess(userId);
    } catch (e: unknown) {
      logger.warn({
        event: 'world.access_revoked_local_failed',
        userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const presence = global.gameServer?.presence;
  if (!presence) {
    logger.debug('[Broadcast] no game server presence, access revocation not published', { userId });
    return;
  }
  const logFailure = (e: unknown): void => {
    logger.warn({
      event: 'world.access_revoked_publish_failed',
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  };
  // Runs after a committed change and must never throw. The in-process
  // LocalPresence publishes synchronously (it returns itself), the Redis
  // presence returns a promise; Promise.resolve covers both. The origin
  // marks messages this process already applied above, so its rooms skip
  // them instead of revoking twice.
  try {
    Promise.resolve(presence.publish(ACCESS_REVOKED_CHANNEL, { userId, origin: PROCESS_ID })).catch(logFailure);
  } catch (e: unknown) {
    logFailure(e);
  }
}
