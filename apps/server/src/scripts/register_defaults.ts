
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

  console.log(`Found map ${map.id}. Registering default local tilesets...`);

  const defaults = [
    { slot: 0, key: 'office_tiles', imageUrl: '/assets/tilesets/office_tiles.png' },
    { slot: 1, key: 'furniture_tiles', imageUrl: '/assets/tilesets/furniture_tiles.png' },
    { slot: 2, key: 'decor_tiles', imageUrl: '/assets/tilesets/decor_tiles.png' },
    { slot: 3, key: 'collision_tiles', imageUrl: '/assets/tilesets/collision_tiles.png' },
  ];

  for (const d of defaults) {
    await prisma.mapTileset.upsert({
      where: { mapId_slot: { mapId: map.id, slot: d.slot } },
      update: {
        key: d.key,
        imageUrl: d.imageUrl,
        tileWidth: 16,
        tileHeight: 16,
        margin: 0,
        spacing: 0
      },
      create: {
        mapId: map.id,
        slot: d.slot,
        key: d.key,
        imageUrl: d.imageUrl,
        tileWidth: 16,
        tileHeight: 16,
        margin: 0,
        spacing: 0
      }
    });
    console.log(`Registered slot ${d.slot}: ${d.key}`);
  }

  console.log('Registration complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

