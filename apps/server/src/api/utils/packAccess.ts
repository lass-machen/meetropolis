import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';

export function parseMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function grantPackAccess(prisma: PrismaClient, params: {
  tenantId: string;
  packType: 'asset' | 'avatar';
  packUuid: string;
  grantSource: string;
  purchasedMajorVersion: number;
  stripePaymentId?: string;
  expiresAt?: Date | null;
  grantedBy?: string;
}): Promise<void> {
  if (params.packType === 'asset') {
    const pack = await prisma.assetPack.findUnique({ where: { uuid: params.packUuid } });
    if (!pack) {
      logger.warn({ event: 'pack_access.grant_failed', reason: 'asset_pack_not_found', uuid: params.packUuid });
      return;
    }
    await prisma.tenantAssetPack.upsert({
      where: { tenantId_assetPackId: { tenantId: params.tenantId, assetPackId: pack.id } },
      update: {
        grantSource: params.grantSource,
        purchasedMajorVersion: params.purchasedMajorVersion,
        stripePaymentId: params.stripePaymentId ?? undefined,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
        revokedAt: null,
      },
      create: {
        tenantId: params.tenantId,
        assetPackId: pack.id,
        grantSource: params.grantSource,
        purchasedMajorVersion: params.purchasedMajorVersion,
        stripePaymentId: params.stripePaymentId ?? null,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
      },
    });
  } else {
    const pack = await prisma.avatarPack.findUnique({ where: { uuid: params.packUuid } });
    if (!pack) {
      logger.warn({ event: 'pack_access.grant_failed', reason: 'avatar_pack_not_found', uuid: params.packUuid });
      return;
    }
    await prisma.tenantAvatarPack.upsert({
      where: { tenantId_avatarPackId: { tenantId: params.tenantId, avatarPackId: pack.id } },
      update: {
        grantSource: params.grantSource,
        purchasedMajorVersion: params.purchasedMajorVersion,
        stripePaymentId: params.stripePaymentId ?? undefined,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
        revokedAt: null,
      },
      create: {
        tenantId: params.tenantId,
        avatarPackId: pack.id,
        grantSource: params.grantSource,
        purchasedMajorVersion: params.purchasedMajorVersion,
        stripePaymentId: params.stripePaymentId ?? null,
        expiresAt: params.expiresAt ?? null,
        grantedBy: params.grantedBy ?? null,
      },
    });
  }
  logger.info({ event: 'pack_access.granted', tenantId: params.tenantId, packType: params.packType, packUuid: params.packUuid, grantSource: params.grantSource });
}

export async function grantFreePacksToTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
  // Grant all free+published asset packs
  const freeAssetPacks = await prisma.assetPackCatalog.findMany({
    where: { pricingModel: 'free', published: true },
    include: { assetPack: true },
  });
  for (const catalog of freeAssetPacks) {
    await prisma.tenantAssetPack.upsert({
      where: { tenantId_assetPackId: { tenantId, assetPackId: catalog.assetPackId } },
      update: {},
      create: {
        tenantId,
        assetPackId: catalog.assetPackId,
        grantSource: 'free',
        purchasedMajorVersion: parseMajorVersion(catalog.assetPack.version),
      },
    });
  }

  // Grant all free+published avatar packs
  const freeAvatarPacks = await prisma.avatarPackCatalog.findMany({
    where: { pricingModel: 'free', published: true },
    include: { avatarPack: true },
  });
  for (const catalog of freeAvatarPacks) {
    await prisma.tenantAvatarPack.upsert({
      where: { tenantId_avatarPackId: { tenantId, avatarPackId: catalog.avatarPackId } },
      update: {},
      create: {
        tenantId,
        avatarPackId: catalog.avatarPackId,
        grantSource: 'free',
        purchasedMajorVersion: parseMajorVersion(catalog.avatarPack.version),
      },
    });
  }
  logger.info({ event: 'pack_access.free_packs_granted', tenantId, assetCount: freeAssetPacks.length, avatarCount: freeAvatarPacks.length });
}

export async function checkPackAccess(prisma: PrismaClient, tenantId: string, assetPackUuid: string): Promise<boolean> {
  const pack = await prisma.assetPack.findUnique({ where: { uuid: assetPackUuid } });
  if (!pack) return false;

  const now = new Date();
  const access = await prisma.tenantAssetPack.findUnique({
    where: { tenantId_assetPackId: { tenantId, assetPackId: pack.id } },
  });
  if (!access) return false;
  if (access.revokedAt) return false;
  if (access.expiresAt && access.expiresAt <= now) return false;
  if (access.purchasedMajorVersion < parseMajorVersion(pack.version)) return false;
  return true;
}
