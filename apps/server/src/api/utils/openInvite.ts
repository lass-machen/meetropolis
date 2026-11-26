import { PrismaClient } from '../../generated/prisma/index.js';
import { inviteExpiry } from './inviteLifecycle.js';
import { newInviteCode } from './inviteCode.js';

/**
 * Creates the single open invite for a tenant and email. The partial unique
 * index on open invites rejects a second one; when a concurrent request wins
 * that race, its invite is reused with a fresh code instead.
 */
export async function createOpenInvite(
  prisma: PrismaClient,
  args: { tenantId: string; email: string; createdBy: string; role: 'admin' | 'member' },
) {
  const fresh = newInviteCode();
  try {
    const invite = await prisma.invite.create({
      data: {
        code: fresh.codeHash,
        email: args.email,
        createdBy: args.createdBy,
        tenantId: args.tenantId,
        role: args.role,
        expiresAt: inviteExpiry(),
      },
    });
    return { invite, rawCode: fresh.code };
  } catch (e: unknown) {
    if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'P2002') throw e;
    const raced = await prisma.invite.findFirst({
      where: { tenantId: args.tenantId, email: args.email, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!raced) throw e;
    const rotated = newInviteCode();
    const invite = await prisma.invite.update({
      where: { id: raced.id },
      data: { code: rotated.codeHash, expiresAt: inviteExpiry(), role: args.role },
    });
    return { invite, rawCode: rotated.code };
  }
}
