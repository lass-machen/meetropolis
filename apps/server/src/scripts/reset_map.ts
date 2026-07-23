import { createPrismaClient } from '../db.js';

const prisma = createPrismaClient();

async function main() {
  const mapName = process.argv[2] || 'office';
  const tenantSlug = process.argv[3] || 'internal';

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
    console.log('Map not found. Nothing to delete.');
    return;
  }

  console.log(`Found map ${map.id}. Deleting related v2 data...`);

  // Delete v2 data
  const deletedChunks = await prisma.mapChunk.deleteMany({
    where: { layer: { mapId: map.id } },
  });
  console.log(`Deleted ${deletedChunks.count} chunks`);

  const deletedLayers = await prisma.mapLayer.deleteMany({
    where: { mapId: map.id },
  });
  console.log(`Deleted ${deletedLayers.count} layers`);

  const deletedTilesets = await prisma.mapTileset.deleteMany({
    where: { mapId: map.id },
  });
  console.log(`Deleted ${deletedTilesets.count} tilesets`);

  // Finally delete the map itself? Or just reset it?
  // The user asked "kill the map".
  // If we delete the map, we might break rooms referring to it unless we cascade or they are deleted too.
  // The schema doesn't show Cascade delete on Room->Map relation (it's usually restricted).
  // Let's just reset the v2 state and the meta field.

  console.log('Resetting map meta and dimensions...');
  await prisma.map.update({
    where: { id: map.id },
    data: {
      meta: {},
      width: 32,
      height: 32,
      tileWidth: 16,
      tileHeight: 16,
      chunkSize: 32,
    },
  });

  console.log('Map reset complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
