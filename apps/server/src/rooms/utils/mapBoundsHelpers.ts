import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom } from '../WorldRoom.js';

export interface MapMeta {
  spawn?: { x: number; y: number };
  [key: string]: unknown;
}

export interface MapCacheEntry {
  widthTiles: number;
  heightTiles: number;
  tileWidthPx: number;
  tileHeightPx: number;
  defaultSpawn: { x: number; y: number } | null;
}

// Compute pixel-space bounds for the room's primary cached map (the one
// loaded in onCreate). Returns null if metadata is incomplete.
export function getBoundsPx(room: WorldRoom): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const wTiles = room.mapWidthTiles;
  const hTiles = room.mapHeightTiles;
  const tW = room.tileWidthPx;
  const tH = room.tileHeightPx;
  if (!wTiles || !hTiles || !tW || !tH) return null;
  const minX = tW / 2;
  const minY = tH / 2;
  const maxX = wTiles * tW - tW / 2;
  const maxY = hTiles * tH - tH / 2;
  return { minX, minY, maxX, maxY };
}

// Compute pixel-space bounds for a specific map. Falls back to the
// room-level bounds if the mapId is unknown to the cache.
export function getBoundsPxForMap(
  room: WorldRoom,
  mapId?: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (mapId && room.mapCache.has(mapId)) {
    const entry = room.mapCache.get(mapId)!;
    const minX = entry.tileWidthPx / 2;
    const minY = entry.tileHeightPx / 2;
    const maxX = entry.widthTiles * entry.tileWidthPx - entry.tileWidthPx / 2;
    const maxY = entry.heightTiles * entry.tileHeightPx - entry.tileHeightPx / 2;
    return { minX, minY, maxX, maxY };
  }
  return getBoundsPx(room);
}

export function getMapCenter(room: WorldRoom): { x: number; y: number } | null {
  const wTiles = room.mapWidthTiles;
  const hTiles = room.mapHeightTiles;
  const tW = room.tileWidthPx;
  const tH = room.tileHeightPx;
  if (!wTiles || !hTiles || !tW || !tH) return null;
  return { x: (wTiles * tW) / 2, y: (hTiles * tH) / 2 };
}

// Clamp position to room-level bounds, falling back to defaultSpawn or
// the map center on invalid/out-of-range input.
export function sanitizePosition(room: WorldRoom, x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const fallback = room.defaultSpawn ?? getMapCenter(room);
    return fallback ?? { x: 200, y: 200 };
  }
  const bounds = getBoundsPx(room);
  if (!bounds) {
    return { x, y };
  }
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    const fallback = room.defaultSpawn ?? getMapCenter(room);
    if (fallback) {
      const fx = Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x));
      const fy = Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y));
      return { x: fx, y: fy };
    }
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
    };
  }
  return { x, y };
}

// Per-map variant: prefers the cached entry for `mapId`, falls back to
// room defaults otherwise. Mirrors the original behavior precisely.
export function sanitizePositionForMap(
  room: WorldRoom,
  x: number,
  y: number,
  mapId?: string,
): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (mapId && room.mapCache.has(mapId)) {
      const entry = room.mapCache.get(mapId)!;
      return (
        entry.defaultSpawn ?? {
          x: (entry.widthTiles * entry.tileWidthPx) / 2,
          y: (entry.heightTiles * entry.tileHeightPx) / 2,
        }
      );
    }
    const fallback = room.defaultSpawn ?? getMapCenter(room);
    return fallback ?? { x: 200, y: 200 };
  }
  const bounds = getBoundsPxForMap(room, mapId);
  if (!bounds) return { x, y };
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    if (mapId && room.mapCache.has(mapId)) {
      const entry = room.mapCache.get(mapId)!;
      const fallback = entry.defaultSpawn ?? {
        x: (entry.widthTiles * entry.tileWidthPx) / 2,
        y: (entry.heightTiles * entry.tileHeightPx) / 2,
      };
      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y)),
      };
    }
    const fallback = room.defaultSpawn ?? getMapCenter(room);
    if (fallback) {
      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, fallback.x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, fallback.y)),
      };
    }
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
    };
  }
  return { x, y };
}

// Lazy-load and cache map metadata for a given mapId. Returns null when
// the map cannot be resolved by id or by name.
export async function ensureMapMeta(room: WorldRoom, mapId: string, tenantSlug: string): Promise<MapCacheEntry | null> {
  if (room.mapCache.has(mapId)) return room.mapCache.get(mapId)!;
  const prisma = room.prismaForPresence ?? createPrismaClient();
  try {
    let map = await prisma.map.findFirst({ where: { id: mapId, tenant: { slug: tenantSlug } } });
    if (!map) {
      map = await prisma.map.findFirst({ where: { name: mapId, tenant: { slug: tenantSlug } } });
    }
    if (!map) return null;
    const meta: MapMeta = (map.meta as MapMeta) || {};
    const sp = meta?.spawn;
    const entry: MapCacheEntry = {
      widthTiles: map.width ?? 32,
      heightTiles: map.height ?? 32,
      tileWidthPx: map.tileWidth ?? 16,
      tileHeightPx: map.tileHeight ?? 16,
      defaultSpawn: sp && typeof sp.x === 'number' && typeof sp.y === 'number' ? { x: sp.x, y: sp.y } : null,
    };
    room.mapCache.set(mapId, entry);
    return entry;
  } catch (e) {
    logger.debug('[WorldRoom] ensureMapMeta failed for', mapId, e);
    return null;
  }
}
