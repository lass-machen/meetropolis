import type express from 'express';
import type { PrismaClient } from '@prisma/client';

export function registerPresenceRoutes(
  app: express.Application,
  prisma: PrismaClient,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  getTenantFromReq: (req: express.Request) => { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null
) {
  // Presence: recent per user (latest entry), for roster UI
  app.get('/presence/recent', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    try {
      const recent = await prisma.presence.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        distinct: ['userId'],
        include: { user: { select: { id: true, email: true, name: true } }, room: { select: { name: true } } },
      } as any);
      const out = recent.map((p: any) => ({
        userId: p.userId,
        user: { id: p.user?.id, email: p.user?.email, name: p.user?.name },
        room: p.room?.name || 'world',
        x: p.x,
        y: p.y,
        direction: p.direction,
        updatedAt: p.updatedAt,
      }));
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: 'failed to load presence' });
    }
  });
}


