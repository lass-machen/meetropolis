import { createPrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/index.js';

const prisma = createPrismaClient();

async function main() {
  const mapName = process.argv[2] || 'office';
  const tenantSlug = process.argv[3] || 'default';

  console.log(`Looking for map "${mapName}" in tenant "${tenantSlug}"...`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error('Tenant not found');
    process.exit(1);
  }

  const map = await prisma.map.findFirst({
    where: { name: mapName, tenantId: tenant.id },
  });

  if (!map) {
    console.log('Map not found.');
    return;
  }

  console.log('Cleaning up meta assets...');
  interface AssetEntry {
    dataUrl?: string;
    [key: string]: unknown;
  }
  interface MetaShape {
    assets?: AssetEntry[];
    [key: string]: unknown;
  }
  const rawMeta: unknown = map.meta;
  const currentMeta: MetaShape =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) ? (rawMeta as MetaShape) : {};
  const assets: AssetEntry[] = Array.isArray(currentMeta.assets) ? currentMeta.assets : [];

  // Remove assets pointing to missing packs (UUID a41042b0...)
  const badPrefix = '/packs/a41042b0-e2bf-4619-8cd3-1d3204b12d61/';
  const newAssets = assets.filter((a) => !a.dataUrl?.startsWith(badPrefix));

  if (assets.length !== newAssets.length) {
    console.log(`Removing ${assets.length - newAssets.length} broken assets...`);
    const updatedMeta = {
      ...currentMeta,
      assets: newAssets,
    } as unknown as Prisma.InputJsonValue;
    await prisma.map.update({
      where: { id: map.id },
      data: { meta: updatedMeta },
    });
  } else {
    console.log('No broken assets found in meta.');
  }

  console.log('Cleanup complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
