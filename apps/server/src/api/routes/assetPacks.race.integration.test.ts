import crypto from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { acquirePackAdvisoryLock } from '../utils/advisoryLocks.js';
import { errorHandler } from '../errorHandler.js';
import { registerAssetPackRoutes } from './assetPacks.js';

const fixture = createHttpFixture();
const app = fixture.app();
const previousPacksDir = process.env.ASSET_PACKS_DIR;
const packUuids: string[] = [];
let packsDir = '';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

beforeAll(async () => {
  packsDir = await mkdtemp(path.join(os.tmpdir(), 'asset-pack-race-fixture-'));
  process.env.ASSET_PACKS_DIR = packsDir;
  registerAssetPackRoutes(app, fixture.prisma);
  app.use(errorHandler);
});

afterAll(async () => {
  await fixture.prisma.assetPack.deleteMany({ where: { uuid: { in: packUuids } } });
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

type Operator = Awaited<ReturnType<typeof operator>>;

function newPackUuid(): string {
  const uuid = crypto.randomUUID();
  packUuids.push(uuid);
  return uuid;
}

async function packZip(uuid: string, version: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'config.json',
    JSON.stringify({
      uuid,
      name: 'Race fixture',
      description: 'Race fixture',
      author: 'Test author',
      version,
      terrain: [],
      structures: [],
      objects: [{ id: 'pixel', key: 'pixel', category: 'objects', dataURL: 'assets/pixel.png', width: 1, height: 1 }],
    }),
  );
  zip.file('assets/pixel.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function upload(value: Operator, uuid: string, version: string) {
  return request(app)
    .post('/asset-packs/upload')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.apiToken}`)
    .attach('file', await packZip(uuid, version), { filename: 'pack.zip', contentType: 'application/zip' });
}

async function archive(value: Operator, uuid: string) {
  return request(app)
    .patch(`/asset-packs/${uuid}/archive`)
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.apiToken}`)
    .send({ archived: true });
}

async function remove(value: Operator, id: number) {
  return request(app)
    .delete(`/asset-packs/${id}`)
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${value.caller.apiToken}`);
}

async function currentPack(uuid: string) {
  return fixture.prisma.assetPack.findUnique({ where: { uuid } });
}

async function generationIds(uuid: string): Promise<string[]> {
  return readdir(path.join(packsDir, uuid, 'generations')).catch(() => []);
}

async function exists(file: string): Promise<boolean> {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

/** Objects of the stored pack config, as the routes rewrote them. */
function storedObjectUrl(pack: { objects: unknown }): string {
  return (pack.objects as Array<{ dataURL: string }>)[0].dataURL;
}

function fileOfUrl(url: string): string {
  return path.join(packsDir, ...url.replace(/^\/packs\//, '').split('/'));
}

async function waitingAdvisoryLocks(): Promise<number> {
  const rows = await fixture.prisma.$queryRaw<Array<{ waiting: bigint }>>`
    SELECT count(*) AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
  return Number(rows[0]?.waiting ?? 0);
}

async function untilWaiting(count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while ((await waitingAdvisoryLocks()) < count) {
    if (Date.now() > deadline) throw new Error(`fewer than ${count} writers queued on the pack lock`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Holds the pack lock while the given writers queue up in order, then
 * releases it so they run one after another against the same pack row.
 */
async function queueBehindPackLock<T>(uuid: string, writers: Array<() => Promise<T>>): Promise<T[]> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = fixture.prisma.$transaction(
    async (tx) => {
      await acquirePackAdvisoryLock(tx, uuid);
      locked();
      await released;
    },
    { timeout: 30_000 },
  );
  await isLocked;
  const results: Array<Promise<T>> = [];
  try {
    for (const [index, writer] of writers.entries()) {
      results.push(writer());
      await untilWaiting(index + 1);
    }
  } finally {
    release();
    await holder;
  }
  return Promise.all(results);
}

describe('asset pack writers on a real database', () => {
  it('rejects deleting a pack while a map tileset points into its files', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const pack = await currentPack(uuid);
    const url = storedObjectUrl(pack!);
    await fixture.prisma.mapTileset.create({
      data: { mapId: value.map.id, slot: 0, key: `race-${uuid}`, imageUrl: url, tileWidth: 32, tileHeight: 32 },
    });

    const res = await remove(value, pack!.id);

    expect(res.status).toBe(409);
    expect(await currentPack(uuid)).not.toBeNull();
    expect(await exists(fileOfUrl(url))).toBe(true);
  });

  it('removes a superseded, unreferenced generation after the next upload commits', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const first = (await currentPack(uuid))!.currentGeneration;

    expect((await upload(value, uuid, '1.0.1')).status).toBe(200);

    const second = (await currentPack(uuid))!.currentGeneration;
    expect(second).not.toBe(first);
    expect(await generationIds(uuid)).toEqual([second]);
  });

  it('keeps a superseded generation that a map tileset still references', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const firstPack = (await currentPack(uuid))!;
    const url = storedObjectUrl(firstPack);
    await fixture.prisma.mapTileset.create({
      data: { mapId: value.map.id, slot: 0, key: `race-${uuid}`, imageUrl: url, tileWidth: 32, tileHeight: 32 },
    });

    expect((await upload(value, uuid, '1.0.1')).status).toBe(200);

    expect(await exists(fileOfUrl(url))).toBe(true);
    expect((await generationIds(uuid)).sort()).toEqual(
      [firstPack.currentGeneration, (await currentPack(uuid))!.currentGeneration].sort(),
    );
  });

  it('keeps legacy pack files that placed objects still reference', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const legacyUrl = `/packs/${uuid}/legacy-desk.png`;
    await mkdir(path.join(packsDir, uuid), { recursive: true });
    await writeFile(fileOfUrl(legacyUrl), PNG);
    await fixture.prisma.mapObject.create({
      data: {
        mapId: value.map.id,
        assetPackUuid: uuid,
        itemId: 'legacy-desk',
        category: 'objects',
        tileX: 0,
        tileY: 0,
        chunkX: 0,
        chunkY: 0,
        width: 1,
        height: 1,
        dataUrl: legacyUrl,
      },
    });

    expect((await upload(value, uuid, '1.0.1')).status).toBe(200);

    expect(await exists(fileOfUrl(legacyUrl))).toBe(true);
  });

  it('lets two queued uploads of the same pack both publish', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);

    const results = await queueBehindPackLock(uuid, [
      () => upload(value, uuid, '1.0.1'),
      () => upload(value, uuid, '1.0.2'),
    ]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const pack = (await currentPack(uuid))!;
    expect(pack.version).toBe('1.0.2');
    expect(await exists(fileOfUrl(storedObjectUrl(pack)))).toBe(true);
    expect(await generationIds(uuid)).toEqual([pack.currentGeneration]);
  });

  it('keeps an archive flag set by a writer queued before an upload', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);

    const results = await queueBehindPackLock(uuid, [() => archive(value, uuid), () => upload(value, uuid, '1.0.1')]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const pack = (await currentPack(uuid))!;
    expect(pack.archived).toBe(true);
    expect(pack.version).toBe('1.0.1');
  });

  it('publishes an upload queued behind a deletion and keeps its files', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const { id } = (await currentPack(uuid))!;

    const results = await queueBehindPackLock(uuid, [() => remove(value, id), () => upload(value, uuid, '2.0.0')]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const pack = (await currentPack(uuid))!;
    expect(pack.version).toBe('2.0.0');
    expect(await exists(fileOfUrl(storedObjectUrl(pack)))).toBe(true);
  });

  it('removes the files of a pack deleted after a queued upload', async () => {
    const value = await operator();
    const uuid = newPackUuid();
    expect((await upload(value, uuid, '1.0.0')).status).toBe(200);
    const { id } = (await currentPack(uuid))!;

    const results = await queueBehindPackLock(uuid, [() => upload(value, uuid, '1.0.1'), () => remove(value, id)]);

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await currentPack(uuid)).toBeNull();
    expect(await exists(path.join(packsDir, uuid))).toBe(false);
  });
});
