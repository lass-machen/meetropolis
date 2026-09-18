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
import { beforeEach, describe, it, expect, vi } from 'vitest';

const tenancy = vi.hoisted(() => ({ enabled: false, resolver: vi.fn() }));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? { version: 1, isMultiTenantEnabled: () => true, resolvePackVisibility: tenancy.resolver }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

import { copyMapToTenant, TargetPackAccessError } from './adminMaps.copy.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';

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

interface PackWhere {
  uuid?: { in?: string[]; notIn?: string[] };
  tenantId?: string | null;
  OR?: PackWhere[];
  AND?: PackWhere[];
}

function matchesPackWhere(uuid: string, where: PackWhere): boolean {
  if (where.uuid?.in && !where.uuid.in.includes(uuid)) return false;
  if (where.uuid?.notIn?.includes(uuid)) return false;
  if (where.tenantId !== undefined && where.tenantId !== null) return false;
  if (where.OR && !where.OR.some((clause) => matchesPackWhere(uuid, clause))) return false;
  if (where.AND && !where.AND.every((clause) => matchesPackWhere(uuid, clause))) return false;
  return true;
}

interface PackState {
  packExists?: boolean;
  packAccessible?: boolean;
}

function makePrisma({ packExists = true, packAccessible = true }: PackState = {}) {
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
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = {
    map: {
      findUnique: vi.fn(({ where }: { where: { id?: string; tenantId_name?: unknown } }) =>
        // `where.id` -> the source lookup; `where.tenantId_name` -> the
        // name-collision probe in resolveCopyName (no collision here).
        Promise.resolve(where.id === SOURCE_MAP_ID ? SOURCE_MAP : null),
      ),
    },
    assetPack: {
      findMany: vi.fn(({ where }: { where: PackWhere }) => {
        const hasScopeFilter = where.tenantId !== undefined || where.OR !== undefined || where.AND !== undefined;
        const allowed = !hasScopeFilter || (packAccessible && matchesPackWhere(SOURCE_OBJECT.assetPackUuid, where));
        return Promise.resolve(packExists && allowed ? [{ uuid: SOURCE_OBJECT.assetPackUuid }] : []);
      }),
    },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { prisma, mapObjectCreate, transaction };
}

beforeEach(() => {
  tenancy.enabled = false;
  tenancy.resolver.mockReset();
});

function configureResolver(state: EnterprisePackResolverState): void {
  tenancy.enabled = state.hook !== 'absent';
  if (state.hook === 'reject') {
    tenancy.resolver.mockRejectedValue(new Error('catalogue unavailable'));
  } else if (state.hook === 'resolve') {
    tenancy.resolver.mockResolvedValue(state.result?.([SOURCE_OBJECT.assetPackUuid]));
  }
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
  it.each(ENTERPRISE_PACK_RESOLVER_STATES)('applies $name to target-tenant pack access', async (state) => {
    configureResolver(state);
    const { prisma, transaction } = makePrisma();
    const copy = copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');

    if (state.expected === 'accessible') {
      await expect(copy).resolves.toMatchObject({ id: 'map-copy' });
      expect(transaction).toHaveBeenCalledOnce();
    } else {
      await expect(copy).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    }
  });

  it('always permits an uncatalogued global base pack', async () => {
    tenancy.enabled = true;
    tenancy.resolver.mockResolvedValue({ catalogPackUuids: ['premium'], accessiblePackUuids: [] });
    const { prisma, transaction } = makePrisma();
    await expect(copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office')).resolves.toMatchObject({
      id: 'map-copy',
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

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

  it('copies an object whose pack UUID has no registered AssetPack', async () => {
    const { prisma, mapObjectCreate, transaction } = makePrisma({ packExists: false });

    await expect(copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office')).resolves.toMatchObject({
      id: 'map-copy',
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(mapObjectCreate).toHaveBeenCalledOnce();
  });

  it('rejects a registered source pack outside the target scope before starting the transaction', async () => {
    const { prisma, transaction } = makePrisma({ packExists: true, packAccessible: false });

    const copy = copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    await expect(copy).rejects.toEqual(
      expect.objectContaining<TargetPackAccessError>({
        message: 'target_tenant_cannot_access_asset_packs:pixel-agents-furniture',
        packUuids: ['pixel-agents-furniture'],
      }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
