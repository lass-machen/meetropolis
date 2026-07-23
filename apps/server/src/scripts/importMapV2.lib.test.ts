import { describe, expect, it, vi } from 'vitest';
import { readSpawnFromProperties, persistSpawnFromTmj } from './importMapV2.lib.js';
import type { TmjProperty, Tmj } from './importMapV2.lib.js';
import type { PrismaClient } from '../generated/prisma/index.js';

// A TMJ carrying the given top-level properties; only `properties` is read by
// persistSpawnFromTmj, so the rest is filler to satisfy the type.
function tmjWithProps(properties: TmjProperty[]): Tmj {
  return { width: 1, height: 1, tilewidth: 16, tileheight: 16, tilesets: [], layers: [], properties };
}

// Minimal Prisma stand-in that records map.update calls.
function fakePrismaWithUpdateSpy() {
  const update = vi.fn(() => Promise.resolve());
  const prisma = { map: { update } } as unknown as PrismaClient;
  return { prisma, update };
}

// ---------------------------------------------------------------------------
// readSpawnFromProperties
//
// Guards the spawn-propagation fix: the v2 importer must lift the TMJ
// top-level `spawnX` / `spawnY` custom properties (pixel coords) into
// Map.meta.spawn. These are the only spawn source the office.json ships.
// ---------------------------------------------------------------------------

describe('readSpawnFromProperties', () => {
  it('reads spawnX/spawnY as pixel coordinates', () => {
    const props: TmjProperty[] = [
      { name: 'spawnX', type: 'int', value: 384 },
      { name: 'spawnY', type: 'int', value: 560 },
    ];
    expect(readSpawnFromProperties(props)).toEqual({ x: 384, y: 560 });
  });

  it('ignores unrelated properties around the spawn ones', () => {
    const props: TmjProperty[] = [
      { name: 'author', type: 'string', value: 'meetropolis' },
      { name: 'spawnY', type: 'int', value: 12 },
      { name: 'spawnX', type: 'int', value: 34 },
    ];
    expect(readSpawnFromProperties(props)).toEqual({ x: 34, y: 12 });
  });

  it('returns undefined when either coordinate is missing', () => {
    expect(readSpawnFromProperties([{ name: 'spawnX', type: 'int', value: 100 }])).toBeUndefined();
    expect(readSpawnFromProperties([{ name: 'spawnY', type: 'int', value: 100 }])).toBeUndefined();
  });

  it('returns undefined for non-numeric coordinates', () => {
    const props: TmjProperty[] = [
      { name: 'spawnX', type: 'string', value: '384' },
      { name: 'spawnY', type: 'int', value: 560 },
    ];
    expect(readSpawnFromProperties(props)).toBeUndefined();
  });

  it('returns undefined for undefined or empty properties', () => {
    expect(readSpawnFromProperties(undefined)).toBeUndefined();
    expect(readSpawnFromProperties([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// persistSpawnFromTmj
//
// Guards the meta merge: the spawn must be written into Map.meta.spawn without
// dropping foreign meta keys, and no write must happen when there is no spawn.
// ---------------------------------------------------------------------------

describe('persistSpawnFromTmj', () => {
  const spawnProps: TmjProperty[] = [
    { name: 'spawnX', type: 'int', value: 384 },
    { name: 'spawnY', type: 'int', value: 560 },
  ];

  it('merges spawn into existing meta, preserving foreign keys', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();
    const map = { id: 'map-1', meta: { zonesVersion: 3, theme: 'dark' } };

    await persistSpawnFromTmj(prisma, map, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { meta: { zonesVersion: 3, theme: 'dark', spawn: { x: 384, y: 560 } } },
    });
  });

  it('writes spawn onto an empty meta', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();

    await persistSpawnFromTmj(prisma, { id: 'map-2', meta: {} }, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-2' },
      data: { meta: { spawn: { x: 384, y: 560 } } },
    });
  });

  it('overwrites only the spawn key on re-import, keeping the rest', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();
    const map = { id: 'map-3', meta: { spawn: { x: 1, y: 2 }, keep: 'me' } };

    await persistSpawnFromTmj(prisma, map, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-3' },
      data: { meta: { spawn: { x: 384, y: 560 }, keep: 'me' } },
    });
  });

  it('does not write when the TMJ has no spawn properties', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();

    await persistSpawnFromTmj(prisma, { id: 'map-4', meta: { theme: 'dark' } }, tmjWithProps([]));

    expect(update).not.toHaveBeenCalled();
  });
});
