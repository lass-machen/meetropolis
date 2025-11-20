
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  const currentMeta = (map.meta as any) || {};
  const assets = Array.isArray(currentMeta.assets) ? currentMeta.assets : [];
  
  // Remove assets pointing to missing packs (UUID a41042b0...)
  const badPrefix = '/packs/a41042b0-e2bf-4619-8cd3-1d3204b12d61/';
  const newAssets = assets.filter((a: any) => !a.dataUrl?.startsWith(badPrefix));
  
  if (assets.length !== newAssets.length) {
     console.log(`Removing ${assets.length - newAssets.length} broken assets...`);
     await prisma.map.update({
        where: { id: map.id },
        data: {
           meta: {
              ...currentMeta,
              assets: newAssets
           }
        }
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

