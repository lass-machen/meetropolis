import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAssetPackRoutes } from './assetPacks.js';
import { registerAvatarPackRoutes } from './avatarPacks.js';
import { registerNpcMediaRoutes } from './npcMedia.js';
import { registerAdminMapRoutes } from './adminMaps.js';
import { registerTmjImportRoute } from './tmj.import.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
const original = { packs: process.env.ASSET_PACKS_DIR, npc: process.env.NPC_MEDIA_DIR };
let temporary = '';
beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'multipart-upload-fixture-'));
  process.env.ASSET_PACKS_DIR = path.join(temporary, 'packs');
  process.env.NPC_MEDIA_DIR = path.join(temporary, 'npc');
  registerAssetPackRoutes(app, fixture.prisma);
  registerAvatarPackRoutes(app, fixture.prisma);
  registerNpcMediaRoutes(app, fixture.prisma);
  registerAdminMapRoutes(app, fixture.prisma);
  registerTmjImportRoute(app, fixture.prisma);
  app.use(errorHandler);
});
afterAll(async () => {
  if (original.packs === undefined) delete process.env.ASSET_PACKS_DIR;
  else process.env.ASSET_PACKS_DIR = original.packs;
  if (original.npc === undefined) delete process.env.NPC_MEDIA_DIR;
  else process.env.NPC_MEDIA_DIR = original.npc;
  await fixture.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

for (const route of [
  '/asset-packs/upload',
  '/avatar-packs/upload-sprite',
  '/npcs/missing/media',
  '/admin/maps/import',
  '/maps/missing/import-tmj',
]) {
  it(`${route} checks authentication and role before malformed multipart parsing`, async () => {
    const { tenant } = await fixture.tenant();
    const member = await fixture.caller(tenant);
    const anonymous = await request(app)
      .post(route)
      .set('X-Tenant', tenant.slug)
      .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
      .send('incomplete body');
    expect(anonymous.status).toBe(401);
    const denied = await request(app)
      .post(route)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${member.session}`)
      .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
      .send('incomplete body');
    expect(denied.status).toBe(403);
  });
}

it('returns tenant_required without a resolved tenant', async () => {
  const { tenant, map } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const result = await request(app)
    .post(`/maps/${map.id}/import-tmj`)
    .set('Authorization', `Bearer ${owner.session}`)
    .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
    .send('incomplete body');
  expect(result.status).toBe(400);
  expect(result.body).toEqual({ error: 'tenant_required' });
});

it('returns admin-required forbidden for tmj member uploads', async () => {
  const { tenant, map } = await fixture.tenant();
  const member = await fixture.caller(tenant);
  const result = await request(app)
    .post(`/maps/${map.id}/import-tmj`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${member.session}`)
    .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
    .send('incomplete body');
  expect(result.status).toBe(403);
  expect(result.body).toEqual({ error: 'forbidden - admin required' });
});
