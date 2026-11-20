import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerTmjImportRoute } from './tmj.import.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
const tmj = Buffer.from(
  JSON.stringify({
    width: 2,
    height: 2,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [],
    layers: [],
  }),
);

beforeAll(() => {
  registerTmjImportRoute(app, fixture.prisma);
  app.use(errorHandler);
});
afterAll(() => fixture.close());

describe('TMJ import through a real session, tenant resolver and PostgreSQL', () => {
  it('rejects member changes and permits the same import for owners and administrators', async () => {
    const own = await fixture.tenant();
    const other = await fixture.tenant();
    const member = await fixture.caller(own.tenant);
    const owner = await fixture.caller(own.tenant, 'owner');
    const admin = await fixture.caller(own.tenant, 'admin');
    const guest = await fixture.caller(own.tenant, 'guest');
    const foreign = await fixture.caller(other.tenant, 'owner');
    const layer = await fixture.prisma.mapLayer.create({
      data: { mapId: own.map.id, name: 'ground', chunkSize: 32 },
    });
    await fixture.prisma.mapChunk.create({
      data: { layerId: layer.id, x: 0, y: 0, version: 1, encoding: 'rle', data: new Uint8Array([1, 0]) },
    });
    const before = {
      map: await fixture.prisma.map.findUniqueOrThrow({ where: { id: own.map.id } }),
      layers: await fixture.prisma.mapLayer.findMany({ where: { mapId: own.map.id } }),
      chunks: await fixture.prisma.mapChunk.findMany({ where: { layerId: layer.id } }),
    };
    const endpoint = `/maps/${own.map.id}/import-tmj`;
    const denied = await request(app)
      .post(endpoint)
      .set('x-tenant', own.tenant.slug)
      .set('Authorization', `Bearer ${member.session}`)
      .attach('file', tmj, 'office.tmj');
    expect(denied.status).toBe(403);
    expect(await fixture.prisma.map.findUniqueOrThrow({ where: { id: own.map.id } })).toEqual(before.map);
    expect(await fixture.prisma.mapLayer.findMany({ where: { mapId: own.map.id } })).toEqual(before.layers);
    expect(await fixture.prisma.mapChunk.findMany({ where: { layerId: layer.id } })).toEqual(before.chunks);

    for (const caller of [guest, foreign]) {
      const result = await request(app)
        .post(endpoint)
        .set('x-tenant', own.tenant.slug)
        .set('Authorization', `Bearer ${caller.session}`)
        .attach('file', tmj, 'office.tmj');
      expect(result.status).toBe(403);
    }
    for (const token of [owner.session, admin.session, owner.apiToken]) {
      const allowed = await request(app)
        .post(endpoint)
        .set('x-tenant', own.tenant.slug)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', tmj, 'office.tmj');
      expect(allowed.status).toBe(200);
      expect(await fixture.prisma.map.findUniqueOrThrow({ where: { id: own.map.id } })).toMatchObject({
        width: 2,
        height: 2,
      });
    }
    const foreignMap = await request(app)
      .post(`/maps/${other.map.id}/import-tmj`)
      .set('x-tenant', own.tenant.slug)
      .set('Authorization', `Bearer ${owner.session}`)
      .attach('file', tmj, 'office.tmj');
    expect(foreignMap.status).toBe(404);
  });
});
