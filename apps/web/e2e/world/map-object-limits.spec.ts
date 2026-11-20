/**
 * Regression test for the footprint limits of map objects.
 * The test creates the required asset pack via the real production API
 * (POST /asset-packs/upload) from the bundled Atelier-v1 asset of the repo,
 * reads the stored object back via GET /asset-packs/:uuid and
 * removes map and pack again via the same API. There is deliberately no
 * dependency on preinstalled default packs.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import JSZip from 'jszip';
import { test, expect, type APIRequestContext, type TestInfo } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

function failClosedEnv(): void {
  const apiUrl = process.env.E2E_API_URL;
  const project = process.env.MT_PROJECT;
  const email = process.env.E2E_OPERATOR_EMAIL;
  const password = process.env.E2E_OPERATOR_PASSWORD;
  if (!apiUrl) throw new Error('E2E_API_URL is required');
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('E2E_API_URL is not a valid URL');
  }
  if (url.protocol !== 'http:') throw new Error('E2E_API_URL must use http');
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1') {
    throw new Error('E2E_API_URL must be loopback');
  }
  if (!project || !/^mtest-\d+$/.test(project)) throw new Error('MT_PROJECT must be mtest-<number>');
  if (!email || !password) throw new Error('E2E_OPERATOR_EMAIL and E2E_OPERATOR_PASSWORD are required');
}

if (SHOULD_RUN) failClosedEnv();

const it = SHOULD_RUN ? test : test.skip;

const API_URL = process.env.E2E_API_URL ?? '';

/**
 * Real, bundled sources from the repo:
 * - the manifest of the bundled Atelier-v1 pack,
 * - the corresponding PNG image in the web public directory.
 * Both are read unchanged; no test PNGs are generated.
 */
const SOURCE_MANIFEST = 'apps/server/prisma/seed-data/asset-packs/atelier-v1/holz.json';
const SOURCE_ASSET_ROOT = 'apps/web/public/assets';
const SOURCE_OBJECT_ID = 'atelier_v1_holz_armchair';

interface TestPack {
  uuid: string;
  objectId: string;
  category: string;
  width: number;
  height: number;
  dataUrl: string;
}

interface UploadedPack {
  packId: number;
  uuid: string;
  objectId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repoRoot(testInfo: TestInfo): string {
  // apps/web/e2e/world/<spec>.ts -> Repo-Wurzel
  return path.resolve(path.dirname(testInfo.file), '..', '..', '..', '..');
}

/** Reads the real pack object including image path from the bundled manifest. */
async function loadSourceObject(
  root: string,
): Promise<{ item: Record<string, unknown>; objectId: string; assetPath: string; author: string }> {
  const manifestPath = path.join(root, SOURCE_MANIFEST);
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(manifest)) throw new Error(`asset pack manifest invalid: ${manifestPath}`);
  const author = manifest.author;
  if (typeof author !== 'string' || author.length === 0) throw new Error(`asset pack manifest has no author`);
  const objects = manifest.objects;
  if (!Array.isArray(objects)) throw new Error(`asset pack manifest has no objects: ${manifestPath}`);
  const item = objects.find((entry) => isRecord(entry) && entry.id === SOURCE_OBJECT_ID);
  if (!isRecord(item)) throw new Error(`source object ${SOURCE_OBJECT_ID} missing in ${manifestPath}`);
  const width = item.width;
  const height = item.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width !== height || width < 2 || width > 64) {
    throw new Error(`source object ${SOURCE_OBJECT_ID} is not a square object of 2..64 px`);
  }
  const dataUrl = item.dataURL;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('/assets/')) {
    throw new Error(`source object ${SOURCE_OBJECT_ID} has no bundled asset path`);
  }
  return { item, objectId: SOURCE_OBJECT_ID, assetPath: dataUrl.replace(/^\/assets\//, ''), author };
}

/** Imports the real pack via POST /asset-packs/upload. */
async function uploadTestPack(request: APIRequestContext, root: string): Promise<UploadedPack> {
  const source = await loadSourceObject(root);
  const assetBytes = await readFile(path.join(root, SOURCE_ASSET_ROOT, source.assetPath));
  const uuid = randomUUID();
  const config = {
    uuid,
    name: `mtest-object-limits-pack-${uuid.slice(0, 8)}`,
    description: 'Temporary E2E test pack from the bundled Atelier-v1 asset.',
    author: source.author,
    version: '1.0.0',
    terrain: [],
    structures: [],
    objects: [{ ...source.item, dataURL: `assets/${source.assetPath}` }],
    autotiles: [],
  };
  const archive = new JSZip();
  archive.file('config.json', JSON.stringify(config));
  archive.file(`assets/${source.assetPath}`, assetBytes);
  const response = await request.post(`${API_URL}/asset-packs/upload`, {
    multipart: {
      file: {
        name: `${uuid}.zip`,
        mimeType: 'application/zip',
        buffer: await archive.generateAsync({ type: 'nodebuffer' }),
      },
    },
  });
  if (!response.ok()) {
    throw new Error(`asset pack upload failed: HTTP ${response.status()} ${await response.text()}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('asset pack upload response invalid');
  const packId = body.id;
  const uploadedUuid = body.uuid;
  if (typeof packId !== 'number' || typeof uploadedUuid !== 'string' || uploadedUuid.length === 0) {
    throw new Error('asset pack upload response without id/uuid');
  }
  return { packId, uuid: uploadedUuid, objectId: source.objectId };
}

/** Actually reads the created pack object back via GET /asset-packs/:uuid. */
async function readBackPackObject(request: APIRequestContext, uuid: string, objectId: string): Promise<TestPack> {
  const response = await request.get(`${API_URL}/asset-packs/${uuid}`);
  if (!response.ok()) {
    throw new Error(`asset pack read failed: HTTP ${response.status()} ${await response.text()}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('asset pack response invalid');
  const objects = body.objects;
  if (!Array.isArray(objects)) throw new Error('asset pack response without objects');
  const item = objects.find((entry) => isRecord(entry) && entry.id === objectId);
  if (!isRecord(item)) throw new Error(`uploaded pack has no object ${objectId}`);
  const width = item.width;
  const height = item.height;
  const dataUrl = item.dataURL;
  const category = item.category;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof dataUrl !== 'string' ||
    dataUrl.length === 0 ||
    typeof category !== 'string' ||
    category.length === 0
  ) {
    throw new Error(`uploaded pack object ${objectId} is malformed`);
  }
  return { uuid, objectId, category, width, height, dataUrl };
}

async function login(request: APIRequestContext): Promise<void> {
  const email = process.env.E2E_OPERATOR_EMAIL;
  const password = process.env.E2E_OPERATOR_PASSWORD;
  if (!email || !password) throw new Error('operator credentials missing');
  const response = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

async function getTenantId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${API_URL}/tenant`);
  expect(response.ok()).toBeTruthy();
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('tenant response invalid');
  const id = body.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('tenant id missing');
  return id;
}

async function createMap(request: APIRequestContext, tenantId: string, name: string): Promise<string> {
  const response = await request.post(`${API_URL}/admin/maps`, {
    data: { tenantId, name, width: 32, height: 32, tileWidth: 16, tileHeight: 16 },
  });
  expect(response.ok()).toBeTruthy();
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('map response invalid');
  const id = body.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('map id missing');
  return id;
}

async function listObjects(request: APIRequestContext, mapId: string): Promise<unknown[]> {
  const response = await request.get(`${API_URL}/maps/${mapId}/objects`);
  expect(response.ok()).toBeTruthy();
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('objects response invalid');
  return body;
}

/** Deletes the own map; the object rows are removed by cascade. */
async function deleteMap(request: APIRequestContext, mapId: string): Promise<string[]> {
  const response = await request.delete(`${API_URL}/admin/maps/${mapId}`);
  if (response.ok()) return [];
  return [`map ${mapId} cleanup failed: HTTP ${response.status()} ${await response.text()}`];
}

/** Deletes only the self-created pack. */
async function deleteAssetPack(request: APIRequestContext, packId: number): Promise<string[]> {
  const response = await request.delete(`${API_URL}/asset-packs/${packId}`);
  if (response.ok()) return [];
  return [`asset pack ${packId} cleanup failed: HTTP ${response.status()} ${await response.text()}`];
}

interface Created {
  mapId?: string;
  packId?: number;
}

/** Deletes only the self-created IDs: first the map, then the pack. */
async function cleanupCreated(request: APIRequestContext, created: Created): Promise<string[]> {
  const errors: string[] = [];
  if (created.mapId) errors.push(...(await deleteMap(request, created.mapId)));
  if (created.packId !== undefined) errors.push(...(await deleteAssetPack(request, created.packId)));
  return errors;
}

/**
 * Creates pack and map via the real API, runs the test body and
 * removes both afterwards via the same API. Cleanup errors are
 * not swallowed: they appear as their own error or as an addition to the
 * original error message.
 */
async function withPackAndMap(
  request: APIRequestContext,
  testInfo: TestInfo,
  tenantId: string,
  name: string,
  body: (context: { pack: TestPack; mapId: string }) => Promise<void>,
): Promise<void> {
  const created: Created = {};
  let bodyError: Error | null = null;
  try {
    const uploaded = await uploadTestPack(request, repoRoot(testInfo));
    created.packId = uploaded.packId;
    const pack = await readBackPackObject(request, uploaded.uuid, uploaded.objectId);
    const mapId = await createMap(request, tenantId, name);
    created.mapId = mapId;
    await body({ pack, mapId });
  } catch (error) {
    bodyError = error instanceof Error ? error : new Error(String(error));
  }
  const cleanupErrors = await cleanupCreated(request, created);
  if (bodyError) {
    if (cleanupErrors.length > 0) bodyError.message += ` | cleanup failed: ${cleanupErrors.join('; ')}`;
    throw bodyError;
  }
  if (cleanupErrors.length > 0) throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`);
}

function uniqueName(suffix: string): string {
  return `mtest-object-limits-${suffix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

it('accepts one individually valid scaled object', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('single-valid'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const scaleFactor = 512 / pack.width;
    const response = await request.post(`${API_URL}/maps/${mapId}/objects`, {
      data: {
        assetPackUuid: pack.uuid,
        itemId: pack.objectId,
        category: pack.category,
        tileX: 0,
        tileY: 0,
        width: pack.width,
        height: pack.height,
        collide: false,
        dataUrl: pack.dataUrl,
        scaleFactor,
      },
    });
    expect(response.status()).toBe(200);
    const after = await listObjects(request, mapId);
    expect(after).toHaveLength(before.length + 1);
  });
});

it('rejects oversized client dimensions without storing', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('oversized'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const response = await request.post(`${API_URL}/maps/${mapId}/objects`, {
      data: {
        assetPackUuid: pack.uuid,
        itemId: pack.objectId,
        category: pack.category,
        tileX: 0,
        tileY: 0,
        width: 16 * 4097,
        height: 16,
        collide: false,
        dataUrl: pack.dataUrl,
        scaleFactor: 1,
      },
    });
    expect(response.status()).toBe(400);
    const after = await listObjects(request, mapId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

it('rejects a scaleFactor that overflows tile dimensions', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('overflow'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const response = await request.post(`${API_URL}/maps/${mapId}/objects`, {
      data: {
        assetPackUuid: pack.uuid,
        itemId: pack.objectId,
        category: pack.category,
        tileX: 0,
        tileY: 0,
        width: pack.width,
        height: pack.height,
        collide: false,
        dataUrl: pack.dataUrl,
        scaleFactor: 1e308,
      },
    });
    expect(response.status()).toBe(400);
    const after = await listObjects(request, mapId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

it('rejects a bulk payload above the planned batch budget', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('bulk-large'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const scaleFactor = 512 / pack.width;
    const objects = Array.from({ length: 65 }, () => ({
      assetPackUuid: pack.uuid,
      itemId: pack.objectId,
      category: pack.category,
      tileX: 0,
      tileY: 0,
      width: pack.width,
      height: pack.height,
      collide: false,
      dataUrl: pack.dataUrl,
      scaleFactor,
    }));
    const response = await request.post(`${API_URL}/maps/${mapId}/objects/bulk`, { data: { objects } });
    expect(response.status()).toBe(400);
    const after = await listObjects(request, mapId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

it('accepts 65 small objects in one bulk payload', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('bulk-small'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const objects = Array.from({ length: 65 }, () => ({
      assetPackUuid: pack.uuid,
      itemId: pack.objectId,
      category: pack.category,
      tileX: 0,
      tileY: 0,
      width: pack.width,
      height: pack.height,
      collide: false,
      dataUrl: pack.dataUrl,
    }));
    const response = await request.post(`${API_URL}/maps/${mapId}/objects/bulk`, { data: { objects } });
    expect(response.status()).toBe(200);
    const after = await listObjects(request, mapId);
    expect(after).toHaveLength(before.length + 65);
  });
});

/**
 * Boundary case: exactly 4096 footprint tiles (64 × 64 at 16 px tiles) must
 * still be accepted — only 4097 tiles are too large.
 */
it('accepts a single object with exactly 4096 tiles', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('single-exact'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const response = await request.post(`${API_URL}/maps/${mapId}/objects`, {
      data: {
        assetPackUuid: pack.uuid,
        itemId: pack.objectId,
        category: pack.category,
        tileX: 0,
        tileY: 0,
        width: 1024,
        height: 1024,
        collide: false,
        dataUrl: pack.dataUrl,
        scaleFactor: 1,
      },
    });
    expect(response.status()).toBe(200);
    const after = await listObjects(request, mapId);
    expect(after).toHaveLength(before.length + 1);
  });
});

/**
 * Grenzfall: exakt 65536 Summen-Kacheln im Bulk (64 Objekte à 32 × 32 Kacheln)
 * several such objects must still be accepted — only above that does the total limit apply.
 */
it('accepts a bulk payload with exactly 65536 total tiles', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('bulk-exact'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const objects = Array.from({ length: 64 }, () => ({
      assetPackUuid: pack.uuid,
      itemId: pack.objectId,
      category: pack.category,
      tileX: 0,
      tileY: 0,
      width: 512,
      height: 512,
      collide: false,
      dataUrl: pack.dataUrl,
      scaleFactor: 1,
    }));
    const response = await request.post(`${API_URL}/maps/${mapId}/objects/bulk`, { data: { objects } });
    expect(response.status()).toBe(200);
    const after = await listObjects(request, mapId);
    expect(after).toHaveLength(before.length + 64);
  });
});

/**
 * Boundary case: a single object that is too large (4097 tiles) rejects the entire
 * bulk, although the total stays far below 65536 — and there
 * must be no partial write; the object list remains unchanged.
 */
it('rejects a bulk payload with one oversized object and writes nothing', async ({ request }, testInfo) => {
  await login(request);
  const tenantId = await getTenantId(request);
  await withPackAndMap(request, testInfo, tenantId, uniqueName('bulk-one-big'), async ({ pack, mapId }) => {
    const before = await listObjects(request, mapId);
    const small = Array.from({ length: 10 }, () => ({
      assetPackUuid: pack.uuid,
      itemId: pack.objectId,
      category: pack.category,
      tileX: 0,
      tileY: 0,
      width: pack.width,
      height: pack.height,
      collide: false,
      dataUrl: pack.dataUrl,
    }));
    const objects = [
      ...small,
      {
        assetPackUuid: pack.uuid,
        itemId: pack.objectId,
        category: pack.category,
        tileX: 0,
        tileY: 0,
        width: 16 * 4097,
        height: 16,
        collide: false,
        dataUrl: pack.dataUrl,
        scaleFactor: 1,
      },
    ];
    const response = await request.post(`${API_URL}/maps/${mapId}/objects/bulk`, { data: { objects } });
    expect(response.status()).toBe(400);
    const after = await listObjects(request, mapId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
