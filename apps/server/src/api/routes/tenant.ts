import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

export function registerTenantRoutes(app: express.Application, prisma: PrismaClient) {

  // GET /tenant — Current tenant info for authenticated users
  app.get('/tenant', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const tenantRef = getTenantFromReq(req);
    if (!tenantRef) return res.status(400).json({ error: 'tenant_required' });

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantRef.id },
        select: {
          id: true,
          slug: true,
          name: true,
          concurrentLimit: true,
          freeSeats: true,
          bypassLimits: true,
          isInternal: true,
          defaultMapName: true,
          publicRegistrationEnabled: true,
          createdAt: true,
          _count: {
            select: {
              memberships: true,
            },
          },
        },
      });

      if (!tenant) return res.status(404).json({ error: 'not_found' });

      res.json({
        ...tenant,
        memberCount: tenant._count.memberships,
        _count: undefined,
      });
    } catch {
      res.status(500).json({ error: 'fetch_failed' });
    }
  });

  // PATCH /tenant — Update tenant data (owner/admin only)
  app.patch('/tenant', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const tenantRef = getTenantFromReq(req);
    if (!tenantRef) return res.status(400).json({ error: 'tenant_required' });

    // Check if user is owner or admin
    const membership = await prisma.membership.findFirst({
      where: {
        userId: auth.userId,
        tenantId: tenantRef.id,
        role: { in: ['owner', 'admin'] },
      },
    });

    if (!membership) return res.status(403).json({ error: 'forbidden' });

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      defaultMapName: z.string().min(1).max(100).optional(),
    });

    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid_payload' });

    const data = parse.data;
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'no_changes' });

    try {
      const updated = await prisma.tenant.update({
        where: { id: tenantRef.id },
        data,
      });

      res.json({ ok: true, id: updated.id });
    } catch {
      res.status(400).json({ error: 'update_failed' });
    }
  });
}
