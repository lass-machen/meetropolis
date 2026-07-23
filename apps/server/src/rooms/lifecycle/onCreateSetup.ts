import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom } from '../WorldRoom.js';
import { sanitizePosition, type MapMeta } from '../utils/mapBoundsHelpers.js';

// Async initial-load: pulls the tenant's default map from the DB, fills
// the room's map metadata fields and `defaultSpawn`, and seeds the
// per-mapId cache. Best-effort; failure is logged at debug level.
export async function loadInitialSpawn(room: WorldRoom, tenantSlug: string): Promise<void> {
  try {
    const prisma = createPrismaClient();
    room.prismaForPresence = prisma;
    const tenantRecord = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { defaultMapName: true },
    });
    const mapName = tenantRecord?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
    let resolvedMap = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
    if (!resolvedMap) {
      resolvedMap = await prisma.map.findFirst({
        where: { tenant: { slug: tenantSlug } },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (resolvedMap) {
      try {
        room.mapWidthTiles = resolvedMap.width ?? null;
        room.mapHeightTiles = resolvedMap.height ?? null;
        room.tileWidthPx = resolvedMap.tileWidth ?? null;
        room.tileHeightPx = resolvedMap.tileHeight ?? null;
        const meta: MapMeta = (resolvedMap.meta as MapMeta) || {};
        const sp = meta?.spawn;
        room.mapCache.set(resolvedMap.id, {
          widthTiles: resolvedMap.width ?? 32,
          heightTiles: resolvedMap.height ?? 32,
          tileWidthPx: resolvedMap.tileWidth ?? 16,
          tileHeightPx: resolvedMap.tileHeight ?? 16,
          defaultSpawn: sp && typeof sp.x === 'number' && typeof sp.y === 'number' ? { x: sp.x, y: sp.y } : null,
        });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to cache map metadata', e);
      }
    }
    const meta = (resolvedMap?.meta as MapMeta) || {};
    const sp = meta?.spawn;
    if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
      const clamped = sanitizePosition(room, sp.x, sp.y);
      room.defaultSpawn = clamped;
      logger.info('[WorldRoom] Loaded default spawn from DB:', room.defaultSpawn);
    }
  } catch (e) {
    try {
      logger.debug('[WorldRoom] Failed to load default spawn:', e instanceof Error ? e.message : String(e));
    } catch (e2) {
      logger.debug('[WorldRoom] Failed to log default spawn error', e2);
    }
  }
}
