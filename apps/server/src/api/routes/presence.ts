import type express from 'express';
import type { PrismaClient, Prisma } from '../../generated/prisma/index.js';

type PresenceWithRoom = Prisma.PresenceGetPayload<{ include: { room: { select: { name: true } } } }>;

export function registerPresenceRoutes(
  app: express.Application,
  prisma: PrismaClient,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  getTenantFromReq: (
    req: express.Request,
  ) => { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null,
) {
  // Presence: recent per user (latest entry), for roster UI
  // Returns ALL tenant members, even those who never logged in
  app.get('/presence/recent', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    try {
      // 1. Fetch all tenant members.
      const memberships = await prisma.membership.findMany({
        where: { tenantId: tenant.id },
        include: { user: { select: { id: true, email: true, name: true } } },
      });

      // 2. Fetch presence data for those users.
      const recent: PresenceWithRoom[] = await prisma.presence.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        distinct: ['userId'],
        include: { room: { select: { name: true } } },
      });

      // 3. Build a userId -> presence map.
      const presenceMap = new Map<string, PresenceWithRoom>();
      for (const p of recent) {
        presenceMap.set(p.userId, p);
      }

      // 4. Combine all members with their presence data (if any).
      const out = memberships.map((m) => {
        const presence = presenceMap.get(m.userId);
        return {
          userId: m.userId,
          user: { id: m.user?.id, email: m.user?.email, name: m.user?.name },
          room: presence?.room?.name || null,
          x: presence?.x ?? null,
          y: presence?.y ?? null,
          direction: presence?.direction || null,
          updatedAt: presence?.updatedAt || null,
        };
      });

      res.json(out);
    } catch (_e) {
      res.status(500).json({ error: 'failed to load presence' });
    }
  });
}
