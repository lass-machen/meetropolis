/**
 * Eager zone-polygon catalog for H4 audio-zone privacy.
 *
 * zoneLockHandler.ts's cache is lazy (only populated on first zone_lock
 * attempt) and intentionally scoped to that feature. Audio-zone
 * enforcement needs zone polygons available on every `move` message from
 * the moment a player joins a map, so it keeps its own eager cache here —
 * but reuses zoneLockHandler's DB-fetch/point-in-polygon primitives
 * rather than re-implementing them (see fetchZonesFromDb/getPlayerZone).
 */

import type { PrismaClient } from '../../generated/prisma/index.js';
import { fetchZonesFromDb, getPlayerZone, type ZonePolygon } from '../handlers/zoneLockHandler.js';
import { islandOf } from './islandModel.js';

export interface ZoneCatalog {
  zones: Map<string, ZonePolygon[]>;
  loading: Map<string, Promise<ZonePolygon[]>>;
}

export function createZoneCatalog(): ZoneCatalog {
  return { zones: new Map(), loading: new Map() };
}

// Eagerly (re)load a map's zone polygons. Safe to call concurrently for
// the same mapId; concurrent callers share the in-flight fetch.
export async function ensureZonesLoaded(
  catalog: ZoneCatalog,
  mapId: string,
  tenantSlug: string,
  prisma: PrismaClient,
): Promise<ZonePolygon[]> {
  const cached = catalog.zones.get(mapId);
  if (cached) return cached;
  const inFlight = catalog.loading.get(mapId);
  if (inFlight) return inFlight;

  const fetchPromise = fetchZonesFromDb(mapId, tenantSlug, prisma).then((zones) => {
    catalog.zones.set(mapId, zones);
    catalog.loading.delete(mapId);
    return zones;
  });
  catalog.loading.set(mapId, fetchPromise);
  return fetchPromise;
}

// Synchronous read for the hot `move` path. If zones for this map have
// not been loaded yet, this returns an empty list — the caller then
// resolves the player to the map's `open` island rather than blocking
// movement on a DB round-trip. `ensureZonesLoaded` (called eagerly on
// join/map-change) is expected to have already populated the cache by
// the time regular movement starts.
export function getZonesSync(catalog: ZoneCatalog, mapId: string): ZonePolygon[] {
  return catalog.zones.get(mapId) ?? [];
}

export function resolveIsland(catalog: ZoneCatalog, mapId: string, pos: { x: number; y: number }): string {
  const zones = getZonesSync(catalog, mapId);
  const zoneName = zones.length > 0 ? getPlayerZone(zones, pos) : null;
  return islandOf(mapId, zoneName);
}

export function invalidateZones(catalog: ZoneCatalog, mapId?: string): void {
  if (mapId) {
    catalog.zones.delete(mapId);
    catalog.loading.delete(mapId);
  } else {
    catalog.zones.clear();
    catalog.loading.clear();
  }
}
