import type express from 'express';
import type { PrismaClient } from '@prisma/client';

export function registerUserRoutes(
  app: express.Application,
  prisma: PrismaClient,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  getTenantFromReq: (req: express.Request) => { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null
) {
  // Single user lookup (authenticated)
  app.get('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const id = req.params.id;
    const user = await prisma.user.findFirst({ where: { id, memberships: { some: { tenantId: tenant.id } } } as any, select: { id: true, email: true, name: true, createdAt: true, updatedAt: true } });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  });
}


