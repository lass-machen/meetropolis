import { broadcastAccessRevoked } from '../api/utils/broadcast.js';
import { enqueueAvRevocation } from '../rooms/lifecycle/avPendingRevocations.js';

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
export async function revokeTenantAccess(tenantSlug: string, userId: string): Promise<void> {
  broadcastAccessRevoked(userId);
  enqueueAvRevocation(`${tenantSlug}:world`, userId);
}

/**
 * Account deletion ends the user's sessions in every tenant at once: exactly
 * one per-user world event (even with no membership left) plus the AV removal
 * per tenant slug. Call it only after the change is committed; it never throws.
 */
export async function revokeAccountAccess(userId: string, tenantSlugs: Iterable<string>): Promise<void> {
  broadcastAccessRevoked(userId);
  for (const tenantSlug of tenantSlugs) {
    enqueueAvRevocation(`${tenantSlug}:world`, userId);
  }
}
