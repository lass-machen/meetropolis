
import { PrismaClient } from '@prisma/client';
import { decodeRlePairsFromBuffer, rleDecodeToNumbers } from '../mapEncoding.js';

const prisma = new PrismaClient();

async function main() {
  const mapName = process.argv[2] || 'office';
  const tenantSlug = process.argv[3] || 'default';

  console.log(`Inspecting collisions for map '${mapName}' in tenant '${tenantSlug}'...`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error('Tenant not found');
    return;
  }

  const map = await prisma.map.findFirst({ where: { name: mapName, tenantId: tenant.id } });
  if (!map) {
    console.error('Map not found');
    return;
  }

  const layer = await prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId: map.id, name: 'collision' } }
  });

  if (!layer) {
    console.error('Collision layer not found in DB');
    return;
  }

  console.log(`Layer found: ID=${layer.id}, ChunkSize=${layer.chunkSize}`);

  const chunks = await prisma.mapChunk.findMany({
    where: { layerId: layer.id }
  });

  console.log(`Found ${chunks.length} chunks.`);

  const chunkSize = layer.chunkSize;

  for (const chunk of chunks) {
    console.log(`Chunk [${chunk.x}, ${chunk.y}] - Encoding: ${chunk.encoding}, Version: ${chunk.version}`);
    
    const buf = Buffer.from(chunk.data);
    const pairs = decodeRlePairsFromBuffer(buf);
    const values = rleDecodeToNumbers(pairs, chunkSize * chunkSize);

    // Simple 1-bit check
    const hasCollision = values.some(v => v !== 0);
    console.log(`  -> Has collision data? ${hasCollision}`);

    if (hasCollision) {
      // Fill visual grid (relative to chunk)
      for (let y = 0; y < chunkSize; y++) {
        for (let x = 0; x < chunkSize; x++) {
          const val = values[y * chunkSize + x];
          if (val !== 0) {
             console.log(`     Collision at local ${x},${y} (World ${chunk.x*chunkSize + x}, ${chunk.y*chunkSize + y})`);
          }
        }
      }
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

