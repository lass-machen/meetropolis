import { logger } from '../../logger.js';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

// Periodic check: disconnect guest users whose membership expiresAt is
// in the past, and delete their sessions. Runs every 60s.
export function startGuestExpiryInterval(room: WorldRoom): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const tenantSlug = (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
      const prisma = room.prismaForPresence ?? new PrismaClient();
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
            try { matchedClient.error(4006, 'guest_expired'); } catch { /* best-effort */ }
            matchedClient.leave(1000);
          }
        }
      });

      // Delete sessions for expired guests
      for (const userId of expiredUserIds) {
        await prisma.session.deleteMany({ where: { userId } }).catch(() => { /* best-effort */ });
      }
    } catch (e) {
      logger.debug('[WorldRoom] Guest expiry check failed', e);
    }
  }, 60_000);
}
