import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';

export async function handleGetTenant(
  req: express.Request,
  res: express.Response,
  prisma: PrismaClient,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const tenantRef = getTenantFromReq(req);
  if (!tenantRef) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  try {
    // Tenant resolution (tenancy.ts) trusts the client-supplied X-Tenant header
    // over the session JWT, so without a membership check this endpoint would
    // disclose a foreign tenant's metadata (name, slug, concurrentLimit,
    // freeSeats, memberCount, publicRegistrationEnabled) to any authenticated
    // user who spoofs the header. Pre-auth registration screens read
    // publicRegistrationEnabled from GET /public/config, not here, so this route
    // is member-only. The 403 is generic (no tenant/role echo) to stay
    // non-enumerable — same rationale as handlePatchTenant / createRequireTenantAdmin.
    // Kept inside the try so a rejected membership lookup returns 500 rather than
    // escaping the un-caught Express wrapper as an unhandled rejection.
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

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

    if (!tenant) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json({
      ...tenant,
      memberCount: tenant._count.memberships,
      _count: undefined,
    });
  } catch {
    res.status(500).json({ error: 'fetch_failed' });
  }
}

const patchTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  defaultMapName: z.string().min(1).max(100).optional(),
});

async function handlePatchTenant(req: express.Request, res: express.Response, prisma: PrismaClient): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const tenantRef = getTenantFromReq(req);
  if (!tenantRef) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  // Fenced so a rejected membership lookup returns 500 rather than escaping the
  // un-caught Express wrapper as an unhandled rejection (same reasoning as
  // handleGetTenant).
  let membership: { id: string } | null;
  try {
    membership = await prisma.membership.findFirst({
      where: {
        userId: auth.userId,
        tenantId: tenantRef.id,
        role: { in: ['owner', 'admin'] },
      },
      select: { id: true },
    });
  } catch {
    res.status(500).json({ error: 'fetch_failed' });
    return;
  }

  if (!membership) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const parse = patchTenantSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  const data = parse.data;
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'no_changes' });
    return;
  }

  try {
    const updated = await prisma.tenant.update({
      where: { id: tenantRef.id },
      data,
    });

    res.json({ ok: true, id: updated.id });
  } catch {
    res.status(400).json({ error: 'update_failed' });
  }
}

export function registerTenantRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/tenant', (req, res) => handleGetTenant(req, res, prisma));
  app.patch('/tenant', (req, res) => handlePatchTenant(req, res, prisma));
}
