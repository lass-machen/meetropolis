import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createZoneCatalog, ensureZonesLoaded, getZonesSync, resolveIsland, invalidateZones } from './zoneCatalog.js';

function prismaReturningZones(zones: { name: string; points: [number, number][] }[]): PrismaClient {
  return {
    map: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', meta: { zones } })),
    },
  } as unknown as PrismaClient;
}

const KITCHEN_SQUARE: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('resolveIsland with an empty (not-yet-loaded) cache', () => {
  it('falls back to the open island rather than blocking on a DB fetch', () => {
    const catalog = createZoneCatalog();
    expect(resolveIsland(catalog, 'map-1', { x: 5, y: 5 })).toBe('map-1:open');
  });
});

describe('ensureZonesLoaded', () => {
  it('populates the cache from Prisma and resolveIsland then reflects it', async () => {
    const catalog = createZoneCatalog();
    const prisma = prismaReturningZones([{ name: 'kitchen', points: KITCHEN_SQUARE }]);
    await ensureZonesLoaded(catalog, 'map-1', 'acme', prisma);
    expect(getZonesSync(catalog, 'map-1')).toHaveLength(1);
    expect(resolveIsland(catalog, 'map-1', { x: 5, y: 5 })).toBe('map-1:zone:kitchen');
    expect(resolveIsland(catalog, 'map-1', { x: 50, y: 50 })).toBe('map-1:open');
  });

  it('only fetches once for concurrent callers of the same mapId', async () => {
    const catalog = createZoneCatalog();
    const prisma = prismaReturningZones([{ name: 'kitchen', points: KITCHEN_SQUARE }]);
    await Promise.all([
      ensureZonesLoaded(catalog, 'map-1', 'acme', prisma),
      ensureZonesLoaded(catalog, 'map-1', 'acme', prisma),
      ensureZonesLoaded(catalog, 'map-1', 'acme', prisma),
    ]);
    expect(prisma.map.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateZones', () => {
  it('drops a single map when given a mapId', async () => {
    const catalog = createZoneCatalog();
    const prisma = prismaReturningZones([{ name: 'kitchen', points: KITCHEN_SQUARE }]);
    await ensureZonesLoaded(catalog, 'map-1', 'acme', prisma);
    await ensureZonesLoaded(catalog, 'map-2', 'acme', prisma);
    invalidateZones(catalog, 'map-1');
    expect(getZonesSync(catalog, 'map-1')).toEqual([]);
    expect(getZonesSync(catalog, 'map-2')).toHaveLength(1);
  });

  it('drops every map when called without a mapId', async () => {
    const catalog = createZoneCatalog();
    const prisma = prismaReturningZones([{ name: 'kitchen', points: KITCHEN_SQUARE }]);
    await ensureZonesLoaded(catalog, 'map-1', 'acme', prisma);
    invalidateZones(catalog);
    expect(getZonesSync(catalog, 'map-1')).toEqual([]);
  });
});
