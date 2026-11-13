import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { uploadTransport, writeBytes } from '../../../test/fixtures/uploadFixture.js';
import { registerAssetPackRoutes } from './assetPacks.js';
import { registerAvatarPackRoutes } from './avatarPacks.js';
import { registerAdminMapRoutes } from './adminMaps.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
let directory = '';
const previous = process.env.ASSET_PACKS_DIR;
const packUuids: string[] = [];
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'global-media-upload-fixture-'));
  process.env.ASSET_PACKS_DIR = directory;
  registerAssetPackRoutes(app, fixture.prisma);
  registerAvatarPackRoutes(app, fixture.prisma);
  registerAdminMapRoutes(app, fixture.prisma);
  app.use(errorHandler);
});
afterAll(async () => {
  await fixture.prisma.assetPack.deleteMany({ where: { uuid: { in: packUuids } } });
  await fixture.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ASSET_PACKS_DIR;
  else process.env.ASSET_PACKS_DIR = previous;
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

for (const [route, limit] of [
  ['/asset-packs/upload', 50],
  ['/avatar-packs/upload-sprite', 5],
  ['/admin/maps/import', 50],
] as const) {
  it(`${route} accepts the exact file limit for content validation and rejects one extra byte with 413`, async () => {
    const value = await operator();
    for (const overflow of [false, true]) {
      const transport = await uploadTransport(app);
      const { req, result } = transport.open(route, {
        'X-Tenant': value.tenant.slug,
        Authorization: `Bearer ${value.caller.session}`,
        'Content-Type': 'multipart/form-data; boundary=fixture-global',
      });
      try {
        await transport.ready(1);
        for (const [name, text] of [
          ['packUuid', crypto.randomUUID()],
          ['tenantId', value.tenant.id],
          ['name', crypto.randomUUID()],
        ]) {
          req.write(`--fixture-global\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${text}\r\n`);
        }
        req.write(
          '--fixture-global\r\nContent-Disposition: form-data; name="file"; filename="invalid.bin"\r\nContent-Type: application/octet-stream\r\n\r\n',
        );
        await writeBytes(req, limit * 1024 * 1024 + Number(overflow), 0);
        req.end('\r\n--fixture-global--\r\n');
        const response = await result;
        if (overflow) expect(response.status).toBe(413);
        else expect([400, 500].includes(response.status)).toBe(true);
      } finally {
        req.destroy();
        await transport.close();
      }
    }
  }, 90_000);
}

it('accepts valid small ZIP, PNG and administrator map uploads', async () => {
  const value = await operator();
  const uuid = crypto.randomUUID();
  packUuids.push(uuid);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  );
  const zip = new JSZip();
  zip.file(
    'config.json',
    JSON.stringify({
      uuid,
      name: 'Upload test',
      description: 'Upload fixture',
      author: 'Test author',
      version: '1.0.0',
      terrain: [],
      structures: [],
      objects: [{ id: 'pixel', key: 'pixel', category: 'objects', dataURL: 'assets/pixel.png', width: 1, height: 1 }],
    }),
  );
  zip.file('assets/pixel.png', png);
  const pack = await request(app)
    .post('/asset-packs/upload')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.apiToken}`)
    .attach('file', await zip.generateAsync({ type: 'nodebuffer' }), {
      filename: 'pack.zip',
      contentType: 'application/zip',
    });
  expect(pack.status).toBe(200);
  expect(await fixture.prisma.assetPack.count({ where: { uuid } })).toBe(1);
  const sprite = await request(app)
    .post('/avatar-packs/upload-sprite')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.session}`)
    .field('packUuid', uuid)
    .attach('file', png, { filename: 'sprite.png', contentType: 'image/png' });
  expect(sprite.status).toBe(200);
  const map = await request(app)
    .post('/admin/maps/import')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.apiToken}`)
    .field('tenantId', value.tenant.id)
    .field('name', `fixture-admin-map-${crypto.randomUUID()}`)
    .attach(
      'file',
      Buffer.from(JSON.stringify({ width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [], tilesets: [] })),
      { filename: 'map.json', contentType: 'application/json' },
    );
  expect(map.status).toBe(200);
});
