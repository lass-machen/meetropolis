import type { PrismaClient, Prisma } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { revokeSessionsForUserInTx } from '../api/utils/sessionAuth.js';
import { invalidateSessionsForUser } from '../api/utils/sessionCache.js';
import { customAvatarPacksDir, deleteCustomAvatarFiles } from './avatarComposer.js';
import { revokeAccountAccess, revokeTenantAccess } from './tenantAccessRevocation.js';

/**
 * Account deletion and member removal.
 *
 * Every database change runs in ONE interactive transaction: either the whole
 * deletion lands or nothing does. The previous implementation deleted rows one
 * by one, swallowed every error and then failed on `user.delete` because
 * `Session` and `EmailVerification` reference the user with ON DELETE RESTRICT,
 * which left accounts without any membership behind while the client was told
 * the deletion had failed.
 *
 * Semantics:
 * - `deleteAccount`: removes the account and everything that references it.
 * - `removeMemberFromTenant`: removes the membership in ONE tenant and signs the
 *   user out everywhere. If that was the user's last membership, the account is
 *   deleted in the same transaction (an account without any tenant has no use).
 *
 * Filesystem work (custom avatar sprites), cache invalidation and the
 * revocation of open world and AV connections happen after the commit and never turn a committed deletion into an error.
 */

export interface MemberRemovalResult {
  accountDeleted: boolean;
}

export class MembershipNotFoundError extends Error {
  constructor(userId: string, tenantId: string) {
    super(`membership of user ${userId} in tenant ${tenantId} not found`);
    this.name = 'MembershipNotFoundError';
  }
}

async function purgeAccountRows(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await revokeSessionsForUserInTx(tx, userId);
  await tx.emailVerification.deleteMany({ where: { userId } });
  await tx.passwordReset.deleteMany({ where: { userId } });
  await tx.apiToken.deleteMany({ where: { userId } });
  await tx.presence.deleteMany({ where: { userId } });
  await tx.invite.updateMany({ where: { usedById: userId }, data: { usedById: null } });
  await tx.invite.updateMany({ where: { createdBy: userId }, data: { createdBy: null } });
  await tx.membership.deleteMany({ where: { userId } });
  // CustomAvatar and the enterprise transcription tables cascade from User.
  await tx.user.delete({ where: { id: userId } });
}

async function readCustomAvatarUuid(prisma: PrismaClient, userId: string): Promise<string | null> {
  const avatar = await prisma.customAvatar.findUnique({ where: { userId }, select: { uuid: true } });
  return avatar?.uuid ?? null;
}

async function removeCustomAvatarFiles(userId: string, uuid: string | null): Promise<void> {
  if (!uuid) return;
  try {
    await deleteCustomAvatarFiles(customAvatarPacksDir(), uuid);
  } catch (err) {
    // The rows are gone already; orphaned sprite files are a cleanup issue,
    // not a reason to report the committed deletion as failed.
    logger.warn({ event: 'user.delete.avatar_cleanup_failed', userId, error: String(err) });
  }
}

/** Delete the account of `userId` with everything that references it. */
export async function deleteAccount(prisma: PrismaClient, userId: string): Promise<void> {
  const avatarUuid = await readCustomAvatarUuid(prisma, userId);
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { tenant: { select: { slug: true } } },
  });
  await prisma.$transaction(async (tx) => {
    await purgeAccountRows(tx, userId);
  });
  invalidateSessionsForUser(userId);
  await revokeAccountAccess(
    userId,
    memberships.map((m) => m.tenant.slug),
  );
  await removeCustomAvatarFiles(userId, avatarUuid);
}

/**
 * Remove `userId` from `tenantId`. Deletes the whole account when no other
 * membership remains. Throws `MembershipNotFoundError` (nothing changed) when
 * the membership does not exist.
 */
export async function removeMemberFromTenant(
  prisma: PrismaClient,
  params: { userId: string; tenantId: string },
): Promise<MemberRemovalResult> {
  const { userId, tenantId } = params;
  const avatarUuid = await readCustomAvatarUuid(prisma, userId);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  const accountDeleted = await prisma.$transaction(async (tx) => {
    const removed = await tx.membership.deleteMany({ where: { userId, tenantId } });
    if (removed.count === 0) throw new MembershipNotFoundError(userId, tenantId);
    await tx.presence.deleteMany({ where: { userId, tenantId } });
    // Sign the user out everywhere: sessions are not bound to a tenant, and a
    // removed member must not keep a live session in the tenant it left.
    await revokeSessionsForUserInTx(tx, userId);
    const remaining = await tx.membership.count({ where: { userId } });
    if (remaining > 0) return false;
    await purgeAccountRows(tx, userId);
    return true;
  });
  invalidateSessionsForUser(userId);
  if (tenant) await revokeTenantAccess(tenant.slug, userId);
  if (accountDeleted) await removeCustomAvatarFiles(userId, avatarUuid);
  return { accountDeleted };
}
