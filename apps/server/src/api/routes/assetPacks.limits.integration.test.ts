import crypto from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { errorHandler } from '../errorHandler.js';
import { registerAssetPackRoutes } from './assetPacks.js';

const fixture = createHttpFixture();
const app = fixture.app();
const previousPacksDir = process.env.ASSET_PACKS_DIR;
let packsDir = '';

beforeAll(async () => {
  packsDir = await mkdtemp(path.join(os.tmpdir(), 'asset-pack-limits-fixture-'));
  process.env.ASSET_PACKS_DIR = packsDir;
  registerAssetPackRoutes(app, fixture.prisma);
  app.use(errorHandler);
});

afterAll(async () => {
  await fixture.close();
  if (packsDir) await rm(packsDir, { recursive: true, force: true });
  if (previousPacksDir === undefined) delete process.env.ASSET_PACKS_DIR;
  else process.env.ASSET_PACKS_DIR = previousPacksDir;
});

async function operator() {
  const own = await fixture.tenant();
  const caller = await fixture.caller(own.tenant);
  let internal = await fixture.prisma.tenant.findUnique({ where: { slug: 'internal' } });
  if (!internal) {
    internal = await fixture.prisma.tenant.create({ data: { slug: 'internal', name: 'Internal test tenant' } });
    fixture.tenantIds.push(internal.id);
  }
  await fixture.prisma.membership.create({ data: { tenantId: internal.id, userId: caller.id, role: 'owner' } });
  return { ...own, caller };
}

it('rejects a pack with more ZIP entries than allowed with 413 and stores nothing', async () => {
  const value = await operator();
  const uuid = crypto.randomUUID();
  const zip = new JSZip();
  zip.file(
    'config.json',
    JSON.stringify({
      uuid,
      name: 'Limit fixture',
      description: 'Limit fixture',
      author: 'Test author',
      version: '1.0.0',
      terrain: [],
      structures: [],
      objects: [],
    }),
  );
  for (let index = 0; index < 5000; index++) zip.file(`assets/${index}.png`, 'x');

  const res = await request(app)
    .post('/asset-packs/upload')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.session}`)
    .attach('file', await zip.generateAsync({ type: 'nodebuffer' }), {
      filename: 'pack.zip',
      contentType: 'application/zip',
    });

  expect(res.status).toBe(413);
  expect(res.body).toEqual({ error: 'asset_pack_too_large' });
  expect(await fixture.prisma.assetPack.count({ where: { uuid } })).toBe(0);
  expect(await readdir(packsDir)).toEqual([]);
}, 60_000);
