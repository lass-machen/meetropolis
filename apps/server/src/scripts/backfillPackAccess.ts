/**
 * Backfill script: Creates catalog entries and free-tier access for all existing packs/tenants.
 * Run with: npx tsx apps/server/src/scripts/backfillPackAccess.ts
 */
import { PrismaClient } from '../generated/prisma/index.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Create AssetPackCatalog for all AssetPacks that don't have one
    const assetPacks = await prisma.assetPack.findMany({
      where: { catalog: null },
    });
    for (const pack of assetPacks) {
      await prisma.assetPackCatalog.upsert({
        where: { assetPackId: pack.id },
        update: {},
        create: {
          assetPackId: pack.id,
          pricingModel: 'free',
          published: true,
        },
      });
      console.log(`AssetPackCatalog created for pack ${pack.uuid} (${pack.name})`);
    }

    // 2. Create AvatarPackCatalog for all AvatarPacks that don't have one
    const avatarPacks = await prisma.avatarPack.findMany({
      where: { catalog: null },
    });
    for (const pack of avatarPacks) {
      await prisma.avatarPackCatalog.upsert({
        where: { avatarPackId: pack.id },
        update: {},
        create: {
          avatarPackId: pack.id,
          pricingModel: 'free',
          published: true,
        },
      });
      console.log(`AvatarPackCatalog created for avatar pack ${pack.uuid} (${pack.name})`);
    }

    // 3. Grant all free AssetPacks to all Tenants
    const tenants = await prisma.tenant.findMany();
    const freeAssetPacks = await prisma.assetPack.findMany({
      where: { catalog: { pricingModel: 'free', published: true } },
    });
    for (const tenant of tenants) {
      for (const pack of freeAssetPacks) {
        await prisma.tenantAssetPack.upsert({
          where: { tenantId_assetPackId: { tenantId: tenant.id, assetPackId: pack.id } },
          update: {},
          create: {
            tenantId: tenant.id,
            assetPackId: pack.id,
            grantSource: 'free',
            purchasedMajorVersion: parseMajorVersion(pack.version),
          },
        });
      }
      console.log(`Granted ${freeAssetPacks.length} free asset packs to tenant ${tenant.slug}`);
    }

    // 4. Grant all free AvatarPacks to all Tenants
    const freeAvatarPacks = await prisma.avatarPack.findMany({
      where: { catalog: { pricingModel: 'free', published: true } },
    });
    for (const tenant of tenants) {
      for (const pack of freeAvatarPacks) {
        await prisma.tenantAvatarPack.upsert({
          where: { tenantId_avatarPackId: { tenantId: tenant.id, avatarPackId: pack.id } },
          update: {},
          create: {
            tenantId: tenant.id,
            avatarPackId: pack.id,
            grantSource: 'free',
            purchasedMajorVersion: parseMajorVersion(pack.version),
          },
        });
      }
      console.log(`Granted ${freeAvatarPacks.length} free avatar packs to tenant ${tenant.slug}`);
    }

    console.log('Backfill complete.');
  } finally {
    await prisma.$disconnect();
  }
}

function parseMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
