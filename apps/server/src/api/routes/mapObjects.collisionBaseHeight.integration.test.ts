/**
 * Real-database regression for PATCH collisionBaseHeight on map objects.
 *
 * Exercises HTTP create/update against an isolated migrated PostgreSQL with
 * production auth, tenant resolution and session guards. Collision cells are
 * decoded with the same mapEncoding helpers the server uses to persist them.
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeRlePairsFromBuffer,
  encodeRlePairsToBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
} from '../../mapEncoding.js';
import type { Map, Tenant } from '../../generated/prisma/index.js';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { errorHandler } from '../errorHandler.js';
import { registerMapObjectRoutes } from './mapObjects.js';

if (!process.env.DATABASE_URL) {
  throw new Error('mapObjects.collisionBaseHeight.integration.test.ts requires an isolated migrated DATABASE_URL');
}

const fixture = createHttpFixture();
const app = fixture.app();

const TILE = 16;
const CHUNK = 2;
const PACK_ITEM = 'chair';
const DATA_URL = 'data:image/png;base64,AAAA';
/** Tall 16x32 object on a 16 px grid: tiles (0,0) and (0,1) → chunk indices 0 and 2. */
const TOP = 0;
const BOTTOM = 2;

const packUuids: string[] = [];

beforeAll(() => {
  registerMapObjectRoutes(app, fixture.prisma);
  app.use(errorHandler);
});

afterAll(async () => {
  if (packUuids.length > 0) {
    await fixture.prisma.assetPack.deleteMany({ where: { uuid: { in: packUuids } } });
  }
  await fixture.close();
});

async function makeMap(tenantId: string): Promise<Map> {
  return fixture.prisma.map.create({
    data: {
      tenantId,
      name: `cbh-${randomUUID()}`,
      meta: {},
      width: 4,
      height: 4,
      tileWidth: TILE,
      tileHeight: TILE,
      chunkSize: CHUNK,
    },
  });
}

async function makePack(): Promise<string> {
  const uuid = `cbh-pack-${randomUUID()}`;
  await fixture.prisma.assetPack.create({
    data: {
      uuid,
      name: uuid,
      description: 'collisionBaseHeight fixture pack',
      author: 'test',
      version: '1',
      terrain: [],
      structures: [],
      objects: [{ id: PACK_ITEM, dataURL: DATA_URL }],
      tenantId: null,
    },
  });
  packUuids.push(uuid);
  return uuid;
}

function authHeaders(tenant: Tenant, session: string) {
  return { 'x-tenant': tenant.slug, Authorization: `Bearer ${session}` };
}

function postBody(packUuid: string) {
  return {
    assetPackUuid: packUuid,
    itemId: PACK_ITEM,
    category: 'objects',
    tileX: 0,
    tileY: 0,
    width: 16,
    height: 32,
    collide: true,
    dataUrl: DATA_URL,
    collisionBaseHeight: 0,
  };
}

function chunkBytes(data: unknown): Buffer {
  if (data instanceof Buffer) return Buffer.from(data);
  return Buffer.from(data as Uint8Array);
}

async function decodeLayerCells(mapId: string, layerName: string): Promise<boolean[] | null> {
  const layer = await fixture.prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId, name: layerName } },
  });
  if (!layer) return null;
  const chunk = await fixture.prisma.mapChunk.findUnique({
    where: { layerId_x_y: { layerId: layer.id, x: 0, y: 0 } },
  });
  if (!chunk) return null;
  return rleDecodeToBooleans(decodeRlePairsFromBuffer(chunkBytes(chunk.data)), CHUNK * CHUNK);
}

async function collisionPair(mapId: string): Promise<{ top: boolean; bottom: boolean }> {
  const cells = await decodeLayerCells(mapId, 'collision');
  expect(cells).not.toBeNull();
  return { top: cells![TOP], bottom: cells![BOTTOM] };
}

async function seedManualTopCell(mapId: string): Promise<Buffer> {
  const values = [true, false, false, false];
  const data = encodeRlePairsToBuffer(rleEncodeBooleans(values));
  const layer = await fixture.prisma.mapLayer.create({
    data: { mapId, name: 'collision_manual', chunkSize: CHUNK },
  });
  await fixture.prisma.mapChunk.create({
    data: {
      layerId: layer.id,
      x: 0,
      y: 0,
      version: 1,
      encoding: 'rle-bool',
      data: new Uint8Array(data),
    },
  });
  return Buffer.from(data);
}

async function manualChunkSnapshot(mapId: string): Promise<{ version: number; data: Buffer } | null> {
  const layer = await fixture.prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId, name: 'collision_manual' } },
  });
  if (!layer) return null;
  const chunk = await fixture.prisma.mapChunk.findUnique({
    where: { layerId_x_y: { layerId: layer.id, x: 0, y: 0 } },
  });
  if (!chunk) return null;
  return { version: chunk.version, data: chunkBytes(chunk.data) };
}

async function collisionChunkSnapshot(mapId: string): Promise<{ version: number; data: Buffer } | null> {
  const layer = await fixture.prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId, name: 'collision' } },
  });
  if (!layer) return null;
  const chunk = await fixture.prisma.mapChunk.findUnique({
    where: { layerId_x_y: { layerId: layer.id, x: 0, y: 0 } },
  });
  if (!chunk) return null;
  return { version: chunk.version, data: chunkBytes(chunk.data) };
}

describe('PATCH collisionBaseHeight against a real database', () => {
  it('round-trips HTTP POST then PATCH 1 then PATCH 0 with DB collision cells', async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'admin');
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    const headers = authHeaders(tenant, caller.session);

    const created = await request(app).post(`/maps/${map.id}/objects`).set(headers).send(postBody(packUuid));
    expect(created.status).toBe(200);
    expect(created.body.collisionBaseHeight).toBe(0);
    const objectId = created.body.id as number;
    const afterCreate = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: objectId } });
    expect(afterCreate.collisionBaseHeight).toBe(0);
    await expect(collisionPair(map.id)).resolves.toEqual({ top: true, bottom: true });

    const shrink = await request(app)
      .patch(`/maps/${map.id}/objects/${objectId}`)
      .set(headers)
      .send({ collisionBaseHeight: 1 });
    expect(shrink.status).toBe(200);
    expect(shrink.body.collisionBaseHeight).toBe(1);
    const afterShrink = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: objectId } });
    expect(afterShrink.collisionBaseHeight).toBe(1);
    await expect(collisionPair(map.id)).resolves.toEqual({ top: false, bottom: true });

    const restore = await request(app)
      .patch(`/maps/${map.id}/objects/${objectId}`)
      .set(headers)
      .send({ collisionBaseHeight: 0 });
    expect(restore.status).toBe(200);
    expect(restore.body.collisionBaseHeight).toBe(0);
    const afterRestore = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: objectId } });
    expect(afterRestore.collisionBaseHeight).toBe(0);
    await expect(collisionPair(map.id)).resolves.toEqual({ top: true, bottom: true });
  });

  it('keeps a real collision_manual top cell when shrinking to foot height 1', async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'admin');
    const map = await makeMap(tenant.id);
    const packUuid = await makePack();
    const headers = authHeaders(tenant, caller.session);

    const created = await request(app).post(`/maps/${map.id}/objects`).set(headers).send(postBody(packUuid));
    expect(created.status).toBe(200);
    const objectId = created.body.id as number;
    const manualBytes = await seedManualTopCell(map.id);
    const manualBefore = await manualChunkSnapshot(map.id);
    expect(manualBefore).not.toBeNull();
    expect(Buffer.compare(manualBefore!.data, manualBytes)).toBe(0);

    const shrink = await request(app)
      .patch(`/maps/${map.id}/objects/${objectId}`)
      .set(headers)
      .send({ collisionBaseHeight: 1 });
    expect(shrink.status).toBe(200);
    expect(shrink.body.collisionBaseHeight).toBe(1);

    await expect(collisionPair(map.id)).resolves.toEqual({ top: true, bottom: true });
    const manualAfter = await manualChunkSnapshot(map.id);
    expect(manualAfter).not.toBeNull();
    expect(manualAfter!.version).toBe(manualBefore!.version);
    expect(Buffer.compare(manualAfter!.data, manualBefore!.data)).toBe(0);
    const manualCells = await decodeLayerCells(map.id, 'collision_manual');
    expect(manualCells).toEqual([true, false, false, false]);
  });

  it.each([-1, 1.5])(
    'rejects PATCH collisionBaseHeight %s with 400 and leaves object plus collision untouched',
    async (value) => {
      const { tenant } = await fixture.tenant();
      const caller = await fixture.caller(tenant, 'admin');
      const map = await makeMap(tenant.id);
      const packUuid = await makePack();
      const headers = authHeaders(tenant, caller.session);

      const created = await request(app).post(`/maps/${map.id}/objects`).set(headers).send(postBody(packUuid));
      expect(created.status).toBe(200);
      const objectId = created.body.id as number;
      const before = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: objectId } });
      const collisionBefore = await collisionChunkSnapshot(map.id);
      expect(collisionBefore).not.toBeNull();

      const rejected = await request(app)
        .patch(`/maps/${map.id}/objects/${objectId}`)
        .set(headers)
        .send({ collisionBaseHeight: value });
      expect(rejected.status).toBe(400);

      const after = await fixture.prisma.mapObject.findUniqueOrThrow({ where: { id: objectId } });
      expect(after.collisionBaseHeight).toBe(before.collisionBaseHeight);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      const collisionAfter = await collisionChunkSnapshot(map.id);
      expect(collisionAfter).not.toBeNull();
      expect(collisionAfter!.version).toBe(collisionBefore!.version);
      expect(Buffer.compare(collisionAfter!.data, collisionBefore!.data)).toBe(0);
    },
  );
});
