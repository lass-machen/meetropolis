import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerTmjImportRoute } from './tmj.import.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
registerTmjImportRoute(app, fixture.prisma);
app.use(errorHandler);
afterAll(() => fixture.close());
const MiB = 1024 * 1024;
const json = JSON.stringify({ width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [], tilesets: [] });
function tmj(size: number) {
  return Buffer.from(json + ' '.repeat(Math.max(0, size - Buffer.byteLength(json))));
}

it('includes the TMJ file limit and rejects one extra byte with 413 without changing the map', async () => {
  for (const [size, expected] of [
    [10 * MiB, 200],
    [10 * MiB + 1, 413],
  ]) {
    const { tenant, map } = await fixture.tenant();
    const owner = await fixture.caller(tenant, 'owner');
    const result = await request(app)
      .post(`/maps/${map.id}/import-tmj`)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${owner.session}`)
      .attach('file', tmj(size), { filename: 'map.tmj', contentType: 'application/json' });
    expect(result.status).toBe(expected);
    expect((await fixture.prisma.map.findUniqueOrThrow({ where: { id: map.id } })).width).toBe(
      expected === 200 ? 2 : 4,
    );
  }
}, 60_000);

it('enforces 5 MiB image and 64 KiB field limits alongside a valid map', async () => {
  for (const field of ['image', 'text']) {
    for (const overflow of [false, true]) {
      const { tenant, map } = await fixture.tenant();
      const owner = await fixture.caller(tenant, 'owner');
      const post = request(app)
        .post(`/maps/${map.id}/import-tmj`)
        .set('X-Tenant', tenant.slug)
        .set('Authorization', `Bearer ${owner.session}`)
        .attach('file', tmj(Buffer.byteLength(json)), { filename: 'map.tmj', contentType: 'application/json' });
      if (field === 'image')
        post.attach('images', Buffer.alloc(5 * MiB + Number(overflow)), {
          filename: 'unused.png',
          contentType: 'image/png',
        });
      else post.field('description', 'a'.repeat(64 * 1024 + Number(overflow)));
      const result = await post;
      expect(result.status).toBe(overflow ? 413 : 200);
      expect((await fixture.prisma.map.findUniqueOrThrow({ where: { id: map.id } })).width).toBe(overflow ? 4 : 2);
    }
  }
}, 60_000);

it('limits requests to 16 fields and 11 files without changing the map on rejection', async () => {
  for (const overflow of [false, true]) {
    const { tenant, map } = await fixture.tenant();
    const owner = await fixture.caller(tenant, 'owner');
    const post = request(app)
      .post(`/maps/${map.id}/import-tmj`)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${owner.session}`)
      .attach('file', tmj(Buffer.byteLength(json)), { filename: 'map.tmj', contentType: 'application/json' });
    for (let i = 0; i < 10; i++)
      post.attach('images', Buffer.from([0]), { filename: `unused-${i}.png`, contentType: 'image/png' });
    for (let i = 0; i < 16 + Number(overflow); i++) post.field(`field${i}`, 'a');
    expect((await post).status).toBe(overflow ? 413 : 200);
    expect((await fixture.prisma.map.findUniqueOrThrow({ where: { id: map.id } })).width).toBe(overflow ? 4 : 2);
  }
});

it('closes the connection on oversized content length', async () => {
  const { tenant, map } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const result = await request(app)
    .post(`/maps/${map.id}/import-tmj`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${owner.session}`)
    .attach('file', tmj(61 * MiB + 1), {
      filename: 'map.tmj',
      contentType: 'application/json',
    });
  expect(result.status).toBe(413);
  expect(String(result.headers['connection'] || '')).toMatch(/close/i);
}, 60_000);
