import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { isAllowedAvatarId } from '../../services/avatarAccess.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';

export function registerUserRoutes(
  app: express.Application,
  prisma: PrismaClient,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  getTenantFromReq: (
    req: express.Request,
  ) => { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null,
) {
  // Single user lookup (authenticated)
  app.get('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const id = req.params.id;
    if (typeof id !== 'string') return res.status(400).json({ error: 'invalid id' });
    const user = await prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId: tenant.id } } },
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
    });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  });

  // Update current user's avatar
  const AvatarUpdateSchema = z.object({
    avatarId: z.string().min(1).max(200),
  });

  app.patch('/me/avatar', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const parsed = AvatarUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid body', details: parsed.error.issues });
    }

    // Only accept an avatarId that resolves to something real AND is in this
    // caller's reach: a default, an avatar from a pack the caller's scope
    // covers (catalog packs plus its own tenant's private ones), or a custom
    // avatar of the caller's OWN PROVEN TENANT. The custom branch is scoped
    // too — do not widen it back to "any existing custom avatar", that
    // premise is what made the route an existence oracle for foreign uuids
    // (rationale on `isAllowedAvatarId` in services/avatarAccess.ts).
    // Previously any free-form string was persisted; then any registered pack
    // was — including a foreign tenant's private one.
    const scope = await resolvePackScope(prisma, req);
    if (!(await isAllowedAvatarId(prisma, parsed.data.avatarId, scope))) {
      return res.status(400).json({ error: 'invalid avatarId' });
    }

    try {
      await prisma.user.update({
        where: { id: auth.userId },
        data: { avatarId: parsed.data.avatarId },
      });
      res.json({ ok: true, avatarId: parsed.data.avatarId });
    } catch {
      res.status(500).json({ error: 'update failed' });
    }
  });
}
