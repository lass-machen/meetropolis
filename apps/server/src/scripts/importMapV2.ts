import path from 'path';
import { createPrismaClient } from '../db.js';
import { importTmjIntoMap } from './importMapV2.lib.js';

const prisma = createPrismaClient();

async function main() {
  const mapName = process.env.IMPORT_MAP_NAME || 'office';
  const tmjPath = process.env.IMPORT_TMJ_PATH || path.resolve(process.cwd(), 'apps/web/public/maps/office.json');
  const chunkSize = Number(process.env.IMPORT_CHUNK_SIZE || 32);
  const tenantSlug = process.env.IMPORT_TENANT_SLUG || 'default';

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new Error(`Tenant '${tenantSlug}' not found. Set IMPORT_TENANT_SLUG or create tenant first.`);
  }

  const result = await importTmjIntoMap(prisma, tenant.id, mapName, tmjPath, chunkSize);
  console.log(`Import v2 complete for map '${mapName}' (id=${result.mapId}); objects: ${result.objectsCreated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
