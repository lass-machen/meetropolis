import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import { revokeSessionsForUser } from '../../api/utils/sessionAuth.js';
import type { WorldRoom } from '../WorldRoom.js';

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

// Periodic check: disconnect guest users whose membership expiresAt is
// in the past, and delete their sessions. Runs every 60s.
export function startGuestExpiryInterval(room: WorldRoom): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void (async () => {
      try {
        const tenantSlug = (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
        const prisma = room.prismaForPresence ?? createPrismaClient();
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
        if (!tenant) return;

        const expiredGuests = await prisma.membership.findMany({
          where: {
            tenantId: tenant.id,
            role: 'guest',
            expiresAt: { lt: new Date() },
          },
          select: { userId: true },
        });

        if (expiredGuests.length === 0) return;

        const expiredUserIds = new Set(expiredGuests.map((g) => g.userId));

        // Find connected clients that are expired guests
        room.state.players.forEach((player, sessionId) => {
          if (expiredUserIds.has(player.identity)) {
            const matchedClient = room.clients.find((c) => c.sessionId === sessionId);
            if (matchedClient) {
              try {
                matchedClient.error(4006, 'guest_expired');
              } catch {
                /* best-effort */
              }
              matchedClient.leave(1000);
            }
          }
        });

        // Delete sessions for expired guests. Via the helper, never a raw
        // `session.deleteMany`: the rows are only half the session. Leaving the
        // in-process cache populated lets the just-kicked guest re-join the
        // world with the very same token for up to SESSION_CACHE_TTL_MS, since
        // onAuth resolves against that cache.
        for (const userId of expiredUserIds) {
          await revokeSessionsForUser(prisma, userId).catch(() => {
            /* best-effort */
          });
        }
      } catch (e) {
        logger.debug('[WorldRoom] Guest expiry check failed', e);
      }
    })();
  }, 60_000);
}
