import { broadcastAccessRevoked } from '../api/utils/broadcast.js';
import { logger } from '../logger.js';
import { enqueueAvRevocation } from '../rooms/lifecycle/avPendingRevocations.js';
import { listWorldRoomNames } from '../rooms/lifecycle/livekitRevocation.js';

/**
 * Everything that has to happen once a user's access to a tenant is gone
 * (member removed, account deleted, guest revoked). Call it only after the
 * change is committed; it never throws.
 *
 * - World: every world room learns the user at once through the single
 *   per-user access-revoked event and disconnects each of the user's sessions
 *   whose verified tenant no longer grants access
 *   (rooms/lifecycle/accessRevocation.ts).
 * - AV: the user is removed from the tenant's LiveKit calls, whose
 *   connection the world disconnect does not end.
 */
export function revokeTenantAccess(tenantSlug: string, userId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    broadcastAccessRevoked(userId);
    enqueueAvRevocation(`${tenantSlug}:world`, userId);
    resolve();
  });
}

/**
 * Account deletion ends the user's sessions in every tenant at once: exactly
 * one per-user world event (even with no membership left) plus the AV removal
 * per tenant slug. Call it only after the change is committed; it never throws.
 * Every other live world room is queued as well, so a session in a foreign
 * tenant's room ends at once instead of waiting for the periodic reconciler.
 */
export function revokeAccountAccess(userId: string, tenantSlugs: Iterable<string>): Promise<void> {
  return new Promise<void>((resolve) => {
    broadcastAccessRevoked(userId);
    const queued = new Set<string>();
    for (const tenantSlug of tenantSlugs) {
      const roomName = `${tenantSlug}:world`;
      queued.add(roomName);
      enqueueAvRevocation(roomName, userId);
    }
    void listWorldRoomNames()
      .then((roomNames) => {
        for (const roomName of roomNames) {
          if (queued.has(roomName)) continue;
          queued.add(roomName);
          enqueueAvRevocation(roomName, userId);
        }
      })
      .catch((error: unknown) => {
        logger.warn({
          event: 'tenant_access.list_world_rooms_failed',
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    resolve();
  });
}
