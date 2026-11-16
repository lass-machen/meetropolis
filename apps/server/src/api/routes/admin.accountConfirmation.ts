import type express from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';
import {
  ADMIN_CONFIRMATION_PURPOSE,
  confirmAccountByAdmin,
  manualConfirmationActive,
} from '../utils/manualConfirmation.js';

const paramsSchema = z.object({ id: z.string().min(1) });

async function requireManualConfirmationAccess(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<{ userId: string } | null> {
  const actor = await requireSuperAdmin(req, prisma);
  if (!actor) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  if (!(await manualConfirmationActive())) {
    res.status(409).json({ code: 'MANUAL_CONFIRMATION_UNAVAILABLE' });
    return null;
  }
  return actor;
}

async function handlePendingConfirmations(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const actor = await requireManualConfirmationAccess(prisma, req, res);
  if (!actor) return;
  const now = new Date();
  // An unused invitation that has expired can no longer be consumed, so its pending row cannot be confirmed.
  const proofs = await prisma.emailVerification.findMany({
    where: {
      purpose: ADMIN_CONFIRMATION_PURPOSE,
      usedAt: null,
      expiresAt: { gt: now },
      invite: { is: { OR: [{ usedAt: { not: null } }, { expiresAt: { gt: now } }] } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { user: true, invite: { include: { tenant: true } } },
  });
  const pending = proofs.flatMap((proof) =>
    proof.invite
      ? [
          {
            userId: proof.userId,
            email: proof.user.email,
            name: proof.user.name,
            tenantId: proof.invite.tenantId,
            tenantName: proof.invite.tenant.name,
            role: proof.invite.role,
            requestedAt: proof.createdAt.toISOString(),
            expiresAt: proof.expiresAt.toISOString(),
          },
        ]
      : [],
  );
  res.json({ pending });
}

async function handleConfirmEmail(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = paramsSchema.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: 'invalid_user_id' });
    return;
  }
  const actor = await requireManualConfirmationAccess(prisma, req, res);
  if (!actor) return;
  const result = await confirmAccountByAdmin(prisma, parse.data.id, actor.userId);
  if (result === 'user_not_found') {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  if (result === 'already_verified') {
    res.status(409).json({ code: 'ALREADY_VERIFIED' });
    return;
  }
  if (result === 'no_pending') {
    res.status(409).json({ code: 'NO_PENDING_CONFIRMATION' });
    return;
  }
  res.json({ userId: parse.data.id, verified: true });
}

export function registerAdminAccountConfirmationRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/admin/pending-confirmations', (req, res) => handlePendingConfirmations(prisma, req, res));
  app.post('/admin/users/:id/confirm-email', (req, res) => handleConfirmEmail(prisma, req, res));
}
