import type { PrismaClient } from '../../generated/prisma/index.js';

export type TenantAccessPrisma = Pick<PrismaClient, 'membership' | 'tenant'>;

/** Owners of the `internal` tenant operate the platform (the rule requireSuperAdmin applies). */
export async function isInternalOwner(prisma: TenantAccessPrisma, userId: string): Promise<boolean> {
  const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' }, select: { id: true } });
  if (!internal) return false;
  const member = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: internal.id, userId } },
    select: { role: true, expiresAt: true, inviteVerificationRequired: true },
  });
  return (
    member?.role === 'owner' &&
    !member.inviteVerificationRequired &&
    (!member.expiresAt || member.expiresAt > new Date())
  );
}

/**
 * May `userId` act inside `tenantId`? True for an active membership (an
 * expired guest membership does not count) and for operators. Shared by the
 * HTTP tenant guard (api/middleware/tenantAccess.ts) and the world-join gate
 * (rooms/lifecycle/onAuth.ts) so both enforce one rule.
 */
export async function hasTenantAccess(prisma: TenantAccessPrisma, userId: string, tenantId: string): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { expiresAt: true, inviteVerificationRequired: true },
  });
  if (membership?.inviteVerificationRequired) return false;
  if (membership && (!membership.expiresAt || membership.expiresAt > new Date())) return true;
  return isInternalOwner(prisma, userId);
}
