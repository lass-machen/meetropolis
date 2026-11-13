/**
 * Legacy OSS contract snapshot for compatibility testing (red test before the fix).
 * Origin: apps/server/src/services/accountDeletion.ts at commit
 * e9e3817d935c25a7774d475361b8836dab6d8a7d (f0b43db9 working-tree SHA256).
 * Implementation is unchanged; only relative import paths were shifted one
 * directory level because this fixture lives in __testutils__/.
 */
import type { PrismaClient } from '../../generated/prisma/index.js';
import { Prisma } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { revokeSessionsForUserInTx } from '../../api/utils/sessionAuth.js';
import { invalidateSessionsForUser } from '../../api/utils/sessionCache.js';
import { customAvatarPacksDir, deleteCustomAvatarFiles } from '../avatarComposer.js';
import { revokeTenantAccess } from '../tenantAccessRevocation.js';
import { removeTenantFiles } from '../tenantFiles.js';

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
  for (const m of memberships) await revokeTenantAccess(m.tenant.slug, userId);
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
    // Serialize concurrent removals of the same user: without the row
    // lock, two removals of the last two memberships each still see the
    // other's membership, and both keep an account that ends up memberless.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
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

/**
 * Delete a tenant together with its memberships in ONE transaction. Members
 * lose all their sessions (sessions are not tenant-bound); a member whose last
 * membership this was loses the account. Rows that carry the tenant id without
 * a foreign key go in the same transaction: CustomAvatar here, enterprise rows
 * via `cleanupInTx`. Tenant content (maps, rooms, zones, NPCs) is not deleted:
 * while it exists, the final tenant delete fails on its foreign keys and the
 * whole transaction rolls back. World and AV access end after the commit.
 */
/**
 * A tenant with large maps deletes tens of thousands of map chunks in this
 * transaction; the Prisma default of 5 s is not enough (timeout-case large-map
 * test).
 */
const TENANT_DELETION_TIMEOUT_MS = 120_000;

export async function deleteTenantWithMembers(
  prisma: PrismaClient,
  tenantId: string,
  options: { cleanupInTx?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
): Promise<{ deletedAccounts: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) throw new Error('tenant not found');
  const memberIds = (
    await prisma.membership.findMany({ where: { tenantId }, select: { userId: true }, orderBy: { userId: 'asc' } })
  ).map((m) => m.userId);
  const mapIds = (await prisma.map.findMany({ where: { tenantId }, select: { id: true } })).map((m) => m.id);
  const layerIds = (await prisma.mapLayer.findMany({ where: { mapId: { in: mapIds } }, select: { id: true } })).map(
    (l) => l.id,
  );
  const roomIds = (await prisma.room.findMany({ where: { tenantId }, select: { id: true } })).map((r) => r.id);
  const npcIds = (await prisma.npc.findMany({ where: { tenantId }, select: { id: true } })).map((n) => n.id);
  const assetPackUuids = (await prisma.assetPack.findMany({ where: { tenantId }, select: { uuid: true } })).map(
    (p) => p.uuid,
  );
  const avatarPackUuids = (await prisma.avatarPack.findMany({ where: { tenantId }, select: { uuid: true } })).map(
    (p) => p.uuid,
  );
  const customAvatarUuids = (await prisma.customAvatar.findMany({ where: { tenantId }, select: { uuid: true } })).map(
    (c) => c.uuid,
  );
  const avatarUuids = new Map<string, string | null>();
  for (const userId of memberIds) avatarUuids.set(userId, await readCustomAvatarUuid(prisma, userId));

  const deletedUserIds = await prisma.$transaction(
    async (tx) => {
      // Same row lock as removeMemberFromTenant in id order so that
      // two deletions cannot deadlock each other.
      if (memberIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(memberIds)}) ORDER BY id FOR UPDATE`;
      }
      if (options.cleanupInTx) await options.cleanupInTx(tx);
      await tx.presence.deleteMany({ where: { OR: [{ tenantId }, { roomId: { in: roomIds } }] } });
      await tx.zone.deleteMany({
        where: { OR: [{ tenantId }, { mapId: { in: mapIds } }, { roomId: { in: roomIds } }] },
      });
      await tx.room.deleteMany({ where: { OR: [{ tenantId }, { mapId: { in: mapIds } }] } });
      if (layerIds.length > 0) await tx.mapChunk.deleteMany({ where: { layerId: { in: layerIds } } });
      if (mapIds.length > 0) {
        await tx.mapLayer.deleteMany({ where: { mapId: { in: mapIds } } });
        await tx.mapTileset.deleteMany({ where: { mapId: { in: mapIds } } });
        await tx.mapAutotile.deleteMany({ where: { mapId: { in: mapIds } } });
        await tx.mapObject.deleteMany({ where: { mapId: { in: mapIds } } });
      }
      await tx.map.deleteMany({ where: { tenantId } });
      if (npcIds.length > 0) await tx.npcMediaFile.deleteMany({ where: { npcId: { in: npcIds } } });
      await tx.npc.deleteMany({ where: { tenantId } });
      await tx.assetPack.deleteMany({ where: { tenantId } });
      await tx.avatarPack.deleteMany({ where: { tenantId } });
      await tx.customAvatar.deleteMany({ where: { tenantId } });
      await tx.invite.deleteMany({ where: { tenantId } });
      await tx.membership.deleteMany({ where: { tenantId } });
      const deleted: string[] = [];
      for (const userId of memberIds) {
        await revokeSessionsForUserInTx(tx, userId);
        if ((await tx.membership.count({ where: { userId } })) === 0) {
          await purgeAccountRows(tx, userId);
          deleted.push(userId);
        }
      }
      await tx.tenant.delete({ where: { id: tenantId } });
      return deleted;
    },
    { timeout: TENANT_DELETION_TIMEOUT_MS, maxWait: 10_000 },
  );

  for (const userId of memberIds) {
    invalidateSessionsForUser(userId);
    await revokeTenantAccess(tenant.slug, userId);
  }
  await removeTenantFiles({
    tenantSlug: tenant.slug,
    assetPackUuids,
    avatarPackUuids,
    customAvatarUuids,
    npcIds,
  });
  for (const userId of deletedUserIds) await removeCustomAvatarFiles(userId, avatarUuids.get(userId) ?? null);
  return { deletedAccounts: deletedUserIds.length };
}
