import { PrismaClient } from '../../generated/prisma/index.js';
import { inviteExpiry } from './inviteLifecycle.js';
import crypto from 'crypto';

/**
 * Creates the single open invite for a tenant and email. The partial unique
 * index on open invites rejects a second one; when a concurrent request wins
 * that race, its invite is reused instead.
 */
export async function createOpenInvite(
  prisma: PrismaClient,
  args: { tenantId: string; email: string; createdBy: string; role: 'admin' | 'member' },
) {
  try {
    return await prisma.invite.create({
      data: {
        code: crypto.randomBytes(12).toString('hex'),
        email: args.email,
        createdBy: args.createdBy,
        tenantId: args.tenantId,
        role: args.role,
        expiresAt: inviteExpiry(),
      },
    });
  } catch (e: unknown) {
    if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'P2002') throw e;
    const raced = await prisma.invite.findFirst({
      where: { tenantId: args.tenantId, email: args.email, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!raced) throw e;
    return prisma.invite.update({
      where: { id: raced.id },
      data: { expiresAt: inviteExpiry(), role: args.role },
    });
  }
}
