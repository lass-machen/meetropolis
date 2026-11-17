/**
 * Database integration coverage for the map object write limits.
 *
 * Every write path behind `api/utils/mapObjectWriteLimits.ts` is exercised
 * against a real migrated PostgreSQL with production authentication,
 * tenant resolution and the session/API-token guards:
 *
 * - POST /maps/:id/objects shares one collision budget per map (65536
 *   tiles); two concurrent colliding writes at the budget edge leave exactly
 *   one winner and one 400 `map_collision_footprint_too_large`.
 * - PATCH validates the stored legacy row before writing, so an oversized
 *   object created before the limits answers 400 and stays untouched.
 * - DELETE never consults the collision budget and succeeds above it.
 * - POST /admin/maps/:id/copy validates every source object before writing
 *   the first row, so an oversized template answers 400 without a new map.
 * - POST /admin/maps/import validates every Tiled object inside its
 *   transaction, so an oversized import answers 400 without a new map.
 * - `importTmjIntoMap` validates every TMJ object inside its transaction, so
 *   a rejected import keeps the previously stored objects.
 *
 * Tile size is 16 px everywhere: 1024 x 1024 px (64 x 64 = 4096 tiles) is
 * allowed, 1040 x 1024 px (65 x 64 = 4160 tiles) is rejected.
 */
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { errorHandler } from '../errorHandler.js';
import { importTmjIntoMap } from '../../scripts/importMapV2.lib.js';
import type { Map, Tenant } from '../../generated/prisma/index.js';
import { registerAdminMapRoutes } from './adminMaps.js';
import { registerMapObjectRoutes } from './mapObjects.js';

if (!process.env.DATABASE_URL) {
  throw new Error('mapObjectWriteLimits.integration.test.ts requires an isolated migrated DATABASE_URL');
}

const fixture = createHttpFixture();
const app = fixture.app();

const TILE = 16;
const PACK_ITEM = 'chair';
const DATA_URL = 'data:image/png;base64,AAAA';

beforeAll(() => {
  registerMapObjectRoutes(app, fixture.prisma);
  registerAdminMapRoutes(app, fixture.prisma);
  app.use(errorHandler);
});

afterAll(() => fixture.close());

async function makeMap(tenantId: string): Promise<Map> {
  return fixture.prisma.map.create({
    data: {
      tenantId,
      name: `limits-${randomUUID()}`,
      meta: {},
      width: 64,
      height: 64,
      tileWidth: TILE,
      tileHeight: TILE,
      chunkSize: 32,
    },
  });
}

async function makePack(): Promise<string> {
  const uuid = `limits-pack-${randomUUID()}`;
  await fixture.prisma.assetPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'write-limits fixture pack',
      author: 'test',
      version: '1',
      terrain: [],
      structures: [],
      objects: [{ id: PACK_ITEM, dataURL: DATA_URL }],
      tenantId: null,
    },
  });
  return uuid;
}

async function makeStoredObject(mapId: string, packUuid: string, overrides: Record<string, number | boolean> = {}) {
  return fixture.prisma.mapObject.create({
    data: {
      mapId,
      assetPackUuid: packUuid,
      itemId: PACK_ITEM,
      category: 'objects',
      tileX: 0,
      tileY: 0,
      chunkX: 0,
      chunkY: 0,
      width: 1024,
      height: 1024,
      collide: true,
      dataUrl: DATA_URL,
      ...overrides,
    },
  });
}

function postBody(packUuid: string, tileX: number) {
  return {
    assetPackUuid: packUuid,
    itemId: PACK_ITEM,
    category: 'objects',
    tileX,
    tileY: 0,
    width: 1024,
    height: 1024,
    collide: true,
    dataUrl: DATA_URL,
  };
}

function authHeaders(tenant: Tenant, session: string) {
  return { 'x-tenant': tenant.slug, Authorization: `Bearer ${session}` };
}

/** Owner of the `internal` tenant: the only caller `requireSuperAdmin` accepts. */
async function makeSuperAdmin() {
  const internal =
    (await fixture.prisma.tenant.findUnique({ where: { slug: 'internal' } })) ??
    (await fixture.prisma.tenant.create({ data: { slug: 'internal', name: 'internal' } }));
  const caller = await fixture.caller(internal, 'owner');
  return { internal, caller };
}

describe('map object write limits against a real database', () => {
  it('admits exactly one of two concurrent colliding writes at the map budget', async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'admin');
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    for (let index = 0; index < 15; index += 1) {
      await makeStoredObject(map.id, packUuid, { tileX: index });
    }
    const headers = authHeaders(tenant, caller.session);
    const [first, second] = await Promise.all([
      request(app).post(`/maps/${map.id}/objects`).set(headers).send(postBody(packUuid, 100)),
      request(app).post(`/maps/${map.id}/objects`).set(headers).send(postBody(packUuid, 200)),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const rejected = first.status === 400 ? first : second;
    expect(rejected.body).toEqual({ error: 'map_collision_footprint_too_large' });
    await expect(fixture.prisma.mapObject.count({ where: { mapId: map.id, collide: true } })).resolves.toBe(16);
  });

  it('rejects PATCH on an oversized legacy object without changing its row', async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'admin');
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    const stored = await makeStoredObject(map.id, packUuid, { width: 1040, tileX: 3, tileY: 4 });
    const res = await request(app)
      .patch(`/maps/${map.id}/objects/${stored.id}`)
      .set(authHeaders(tenant, caller.session))
      .send({ tileX: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
    const row = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: stored.id } });
    expect(row.tileX).toBe(3);
    expect(row.tileY).toBe(4);
  });

  it('deletes one object from a map above the collision budget', async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'admin');
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    const stored = [];
    for (let index = 0; index < 17; index += 1) {
      stored.push(await makeStoredObject(map.id, packUuid, { tileX: index }));
    }
    const res = await request(app)
      .delete(`/maps/${map.id}/objects/${stored[0].id}`)
      .set(authHeaders(tenant, caller.session));
    expect(res.status).toBe(200);
    await expect(fixture.prisma.mapObject.findUnique({ where: { id: stored[0].id } })).resolves.toBeNull();
  });

  it('rejects the template copy of an oversized source object without creating a map', async () => {
    const source = await fixture.tenant();
    const sourceMap = await makeMap(source.tenant.id);
    const packUuid = await makePack();
    await makeStoredObject(sourceMap.id, packUuid, { width: 1040, collide: false });
    const target = await fixture.tenant();
    const { caller } = await makeSuperAdmin();
    const before = await fixture.prisma.map.count({ where: { tenantId: target.tenant.id } });
    const res = await request(app)
      .post(`/admin/maps/${sourceMap.id}/copy`)
      .set(authHeaders(target.tenant, caller.session))
      .send({ targetTenantId: target.tenant.id });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
    await expect(fixture.prisma.map.count({ where: { tenantId: target.tenant.id } })).resolves.toBe(before);
  });

  it('rejects the Tiled admin import of a 16400 px wide object without creating a map', async () => {
    const { tenant } = await fixture.tenant();
    const { caller } = await makeSuperAdmin();
    const mapName = `limits-import-${randomUUID()}`;
    const tmj = {
      width: 32,
      height: 32,
      tilewidth: TILE,
      tileheight: TILE,
      tilesets: [],
      layers: [
        {
          type: 'objectgroup',
          name: 'furniture',
          objects: [{ id: 1, name: 'wardrobe', x: 0, y: 0, width: 16400, height: 16384 }],
        },
      ],
    };
    const res = await request(app)
      .post('/admin/maps/import')
      .set(authHeaders(tenant, caller.session))
      .field('tenantId', tenant.id)
      .field('name', mapName)
      .attach('file', Buffer.from(JSON.stringify(tmj), 'utf-8'), 'office.tmj');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'object_footprint_too_large' });
    await expect(
      fixture.prisma.map.findUnique({ where: { tenantId_name: { tenantId: tenant.id, name: mapName } } }),
    ).resolves.toBeNull();
  });

  it('rejects the V2 import of an oversized object and keeps the stored objects', async () => {
    const { tenant } = await fixture.tenant();
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    for (let index = 0; index < 3; index += 1) {
      await makeStoredObject(map.id, packUuid, { width: 32, height: 32, collide: false, tileX: index });
    }
    const tmjPath = join(tmpdir(), `limits-v2-${randomUUID()}.tmj`);
    try {
      await fs.writeFile(
        tmjPath,
        JSON.stringify({
          width: 64,
          height: 64,
          tilewidth: TILE,
          tileheight: TILE,
          tilesets: [],
          layers: [
            {
              type: 'objectgroup',
              name: 'objects',
              objects: [{ id: 1, name: 'wardrobe', gid: 1, x: 0, y: 1024, width: 1040, height: 1024 }],
            },
          ],
        }),
      );
      await expect(importTmjIntoMap(fixture.prisma, tenant.id, map.name, tmjPath)).rejects.toThrow();
      await expect(fixture.prisma.mapObject.count({ where: { mapId: map.id } })).resolves.toBe(3);
    } finally {
      await fs.unlink(tmjPath);
    }
  });
});
