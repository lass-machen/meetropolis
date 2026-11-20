import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { uploadTransport, writeBytes } from '../../../test/fixtures/uploadFixture.js';
import { registerTmjImportRoute } from '../routes/tmj.import.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
registerTmjImportRoute(app, fixture.prisma);
app.use(errorHandler);
afterAll(() => fixture.close());
const MiB = 1024 * 1024;

it('bounds cumulative bytes of a chunked multipart body before buffering', async () => {
  const { tenant, map } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const transport = await uploadTransport(app);
  const { req, result } = transport.open(`/maps/${map.id}/import-tmj`, {
    'X-Tenant': tenant.slug,
    Authorization: `Bearer ${owner.session}`,
    'Content-Type': 'multipart/form-data; boundary=fixture-budget',
  });
  try {
    await transport.ready(1);
    req.write(
      '--fixture-budget\r\nContent-Disposition: form-data; name="file"; filename="map.tmj"\r\nContent-Type: application/json\r\n\r\n',
    );
    const json = JSON.stringify({ width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [], tilesets: [] });
    req.write(json);
    await writeBytes(req, 10 * MiB - 1 - Buffer.byteLength(json));
    for (let i = 0; i < 10; i++) {
      req.write(
        `\r\n--fixture-budget\r\nContent-Disposition: form-data; name="images"; filename="image-${i}.png"\r\nContent-Type: image/png\r\n\r\n`,
      );
      await writeBytes(req, 5 * MiB - 1);
    }
    for (let i = 0; i < 16; i++) {
      req.write(`\r\n--fixture-budget\r\nContent-Disposition: form-data; name="field${i}"\r\n\r\n`);
      await writeBytes(req, 64 * 1024 - 1);
    }
    req.end('\r\n--fixture-budget--\r\n');
    expect((await result).status).toBe(413);
    expect((await fixture.prisma.map.findUniqueOrThrow({ where: { id: map.id } })).width).toBe(4);
  } finally {
    req.destroy();
    await transport.close();
  }
}, 90_000);

it('shares the per-user budget across sessions and returns 429 with Retry-After on attempt eleven', async () => {
  const { tenant, map } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const second = await fixture.session(owner.id, tenant.id);
  for (let i = 0; i < 10; i++) {
    const response = await request(app)
      .post(`/maps/${map.id}/import-tmj`)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${i % 2 ? second.token : owner.session}`)
      .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
      .send('malformed');
    expect(response.status).not.toBe(429);
  }
  const result = await request(app)
    .post(`/maps/${map.id}/import-tmj`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${owner.apiToken}`)
    .set('Content-Type', 'multipart/form-data; boundary=fixture-broken')
    .send('malformed');
  expect(result.status).toBe(429);
  expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
});

it('rejects a third concurrent upload and releases slots after abort', async () => {
  const { tenant, map } = await fixture.tenant();
  const owner = await fixture.caller(tenant, 'owner');
  const transport = await uploadTransport(app);
  const headers = {
    'X-Tenant': tenant.slug,
    Authorization: `Bearer ${owner.session}`,
    'Content-Type': 'multipart/form-data; boundary=fixture-open',
  };
  const first = transport.open(`/maps/${map.id}/import-tmj`, headers);
  const second = transport.open(`/maps/${map.id}/import-tmj`, headers);
  try {
    await transport.ready(2);
    const prefix = '--fixture-open\r\nContent-Disposition: form-data; name="file"; filename="map.tmj"\r\n\r\n{';
    first.req.write(prefix);
    second.req.write(prefix);
    const result = await request(app).post(`/maps/${map.id}/import-tmj`).set(headers).send('malformed');
    expect(result.status).toBe(429);
    expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
    first.req.destroy();
    second.req.destroy();
  } finally {
    first.req.destroy();
    second.req.destroy();
    await transport.close();
  }
  const afterAbort = await request(app).post(`/maps/${map.id}/import-tmj`).set(headers).send('malformed');
  expect(afterAbort.status).not.toBe(429);
}, 20_000);
