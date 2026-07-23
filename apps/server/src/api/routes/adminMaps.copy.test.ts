/**
 * Tests for `copyMapToTenant` — the deep copy behind POST /admin/maps/:id/copy
 * AND behind the starter world every new tenant receives
 * (`copyTemplateMapsForSignup`).
 *
 * Focus: OBJECT FIDELITY. A field that the copier forgets does not stay
 * unchanged, it silently falls back to the Prisma column default. That is how
 * the depth-layering pair (`collisionBaseHeight`, `renderLayer`) was dropped:
 * every customer received the template office map with its wall art and
 * whiteboards rendered behind avatars.
 *
 * The second test derives the expected column list from schema.prisma, so
 * ADDING a column to `MapObject` without teaching `copyObjects` about it turns
 * this suite red — the class of bug, not just the one instance.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi } from 'vitest';

import { copyMapToTenant } from './adminMaps.copy.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const SOURCE_MAP_ID = 'map-source';
const TARGET_TENANT_ID = 'tenant-target';

/** A fully populated source object: every column carries a NON-default value,
 * so a forgotten field shows up as the schema default in the assertion. */
const SOURCE_OBJECT = {
  id: 7,
  mapId: SOURCE_MAP_ID,
  assetPackUuid: 'pixel-agents-furniture',
  itemId: 'whiteboard',
  category: 'objects',
  tileX: 12,
  tileY: 34,
  chunkX: 0,
  chunkY: 1,
  width: 3,
  height: 2,
  collide: true,
  zIndex: 5,
  rotation: 90,
  flipX: true,
  flipY: true,
  scaleFactor: 1.5,
  dataUrl: 'data:image/png;base64,AAAA',
  collisionBaseHeight: 2,
  renderLayer: 'overhead',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const SOURCE_MAP = {
  id: SOURCE_MAP_ID,
  name: 'office',
  width: 64,
  height: 64,
  tileWidth: 16,
  tileHeight: 16,
  chunkSize: 32,
  meta: {},
  tilesets: [],
  layers: [],
  objects: [SOURCE_OBJECT],
  rooms: [],
};

/** The single argument `copyObjects` passes to `mapObject.create`. Typed so the
 * assertions can read `data` without a cast. */
interface MapObjectCreateArgs {
  data: Record<string, unknown>;
}

function makePrisma() {
  const mapObjectCreate = vi.fn((_args: MapObjectCreateArgs) => Promise.resolve({ id: 99 }));
  const tx = {
    map: { create: vi.fn(() => Promise.resolve({ id: 'map-copy', name: 'office' })) },
    mapTileset: { create: vi.fn(() => Promise.resolve({})) },
    mapLayer: { create: vi.fn(() => Promise.resolve({ id: 'layer-copy' })) },
    mapChunk: { create: vi.fn(() => Promise.resolve({})) },
    mapObject: { create: mapObjectCreate },
    room: { create: vi.fn(() => Promise.resolve({ id: 'room-copy' })) },
    zone: { create: vi.fn(() => Promise.resolve({})) },
  };
  const prisma = {
    map: {
      findUnique: vi.fn(({ where }: { where: { id?: string; tenantId_name?: unknown } }) =>
        // `where.id` -> the source lookup; `where.tenantId_name` -> the
        // name-collision probe in resolveCopyName (no collision here).
        Promise.resolve(where.id === SOURCE_MAP_ID ? SOURCE_MAP : null),
      ),
    },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, mapObjectCreate };
}

/**
 * Every column of `MapObject` that a copy must carry over, read from the
 * schema. Excluded: `id` (generated), `map` (the relation field backing
 * `mapId`), `createdAt`/`updatedAt` (managed by Prisma). `mapId` stays in —
 * the copier sets it to the NEW map.
 */
function expectedCopiedColumns(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schema = fs.readFileSync(path.resolve(here, '../../../prisma/schema.prisma'), 'utf8');
  const model = /model MapObject \{([\s\S]*?)\n\}/.exec(schema);
  if (!model || !model[1]) throw new Error('MapObject model not found in schema.prisma');
  const generated = new Set(['id', 'map', 'createdAt', 'updatedAt']);
  return model[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@@'))
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0 && !generated.has(name))
    .sort();
}

describe('copyMapToTenant — object fidelity', () => {
  it('carries the depth-layering fields over to the copy', async () => {
    const { prisma, mapObjectCreate } = makePrisma();
    await copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    expect(mapObjectCreate).toHaveBeenCalledTimes(1);
    const { data } = mapObjectCreate.mock.calls[0][0];
    // Both default to the "legacy" value (0 / 'sorted'), so an omitted field
    // would look plausible in the database — assert the SOURCE values.
    expect(data.collisionBaseHeight).toBe(2);
    expect(data.renderLayer).toBe('overhead');
  });

  it('writes every MapObject column declared in schema.prisma', async () => {
    const { prisma, mapObjectCreate } = makePrisma();
    await copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    const { data } = mapObjectCreate.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(expectedCopiedColumns());
  });

  it('re-points the copy at the target map and keeps every other value verbatim', async () => {
    const { prisma, mapObjectCreate } = makePrisma();
    await copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    const { data } = mapObjectCreate.mock.calls[0][0];
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...carried } = SOURCE_OBJECT;
    expect(data).toEqual({ ...carried, mapId: 'map-copy' });
  });
});
