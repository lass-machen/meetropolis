/**
 * Who may change a map, and what a new tenant receives.
 *
 * The cases use the real seed, the real login and the real HTTP routes.
 * There are no route mocks and no invented tokens. A second tenant exists
 * only through the freshTenant fixture, which skips outside the enterprise
 * edition (apps/web/e2e/fixtures/index.ts).
 *
 * Menu: the editor entry is rendered only when onToggleEditor is passed
 * (apps/web/src/ui/app/TopRightMenu.tsx, apps/web/src/app/routes/components/WorldMainView.tsx).
 * The button label is the menu string in common.json.
 *
 * Editor state: PUT /maps/:id/editor-state requires an owner or admin
 * membership (apps/server/src/api/routes/maps.editor.zones.ts,
 * apps/server/src/api/routes/maps.editor.ts). A missing membership is 403
 * "forbidden"; a plain member is 403 "forbidden - admin required".
 *
 * Objects: the member test sends POST, PATCH and DELETE and expects 403.
 * The routes themselves admit every membership role
 * (apps/server/src/api/routes/mapObjects.ts). 403 is what they return when
 * the caller has no membership in the tenant named by X-Tenant.
 *
 * Packs: upload does not set tenantId, so the stored pack is global
 * (apps/server/src/api/routes/assetPacks.processor.ts). A tenant list
 * includes that tenant's packs and every global pack
 * (apps/server/src/services/packScope.ts).
 *
 * A new tenant's starter map is the copy made for freshTenant from the
 * template tenant (apps/web/e2e/support/provisioning.ts, which calls the
 * same copy the signup uses in apps/server/src/api.ts).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import JSZip from 'jszip';
import type { APIRequestContext, APIResponse, Page, TestInfo } from '@playwright/test';

import { expect, test } from '../fixtures';
import { MeetropolisApi, createApiRequest } from '../support/api';
import type { SeedData, TestUser } from '../support/api';
import { completeSeedOnboarding, getSeedTenant, passwordFor } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const UI_TIMEOUT_MS = 30_000;
const EDITOR_ITEM = /Map.Editor öffnen|Open map editor|Editor beenden|Exit editor/;
const SOURCE_MANIFEST = 'apps/server/prisma/seed-data/asset-packs/atelier-v1/holz.json';
const SOURCE_ASSET_ROOT = 'apps/web/public/assets';
const SOURCE_OBJECT_ID = 'atelier_v1_holz_armchair';

type ZonePoint = { x: number; y: number };

type ZoneSnapshot = {
  name: string;
  capacity: number | null;
  polygon: ZonePoint[];
  type: string | null;
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
};

type MapSnapshot = {
  zones: ZoneSnapshot[];
  backgroundColor: string | null;
  objects: Array<{ id: number; content: string }>;
};

type ZoneSignature = {
  name: string;
  capacity: number | null;
  type: string | null;
  points: ZonePoint[];
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
};

type StackEnv = { apiUrl: string; baseUrl: string };

type DeniedCall = {
  method: 'get' | 'put' | 'post' | 'patch' | 'delete';
  path: string;
  data?: unknown;
};

const OBJECT_CONTENT_KEYS = [
  'assetPackUuid',
  'itemId',
  'category',
  'tileX',
  'tileY',
  'width',
  'height',
  'rotation',
  'scaleFactor',
  'collide',
  'zIndex',
  'flipX',
  'flipY',
  'dataUrl',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires the isolated stack and rejects production targets outright. */
function requireIsolatedStack(stack: StackEnv): void {
  const project = process.env.MT_PROJECT ?? '';
  if (!/^mtest-\d+$/.test(project)) {
    throw new Error(`MT_PROJECT must be mtest-<number>, found: ${project || '<empty>'}.`);
  }
  const apiPort = process.env.MT_PORT_API ?? '';
  const webPort = process.env.MT_PORT_WEB ?? '';
  const targets: Array<[string, string, string, string]> = [
    ['E2E_API_URL', stack.apiUrl, 'MT_PORT_API', apiPort],
    ['E2E_BASE_URL', stack.baseUrl, 'MT_PORT_WEB', webPort],
  ];
  for (const [name, value, portName, expectedPort] of targets) {
    if (expectedPort === '') throw new Error(`${portName} is missing: no expected port known.`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL.`);
    }
    if (url.protocol !== 'http:') throw new Error(`${name} must use loopback http.`);
    if (url.hostname !== 'localhost') throw new Error(`${name} must have origin localhost.`);
    if (url.port === '') throw new Error(`${name} needs an explicit port (no default fallback).`);
    const numeric = Number(url.port);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`${name} has no valid port.`);
    if (numeric === 80 || numeric === 443) throw new Error(`${name} must not use a default port.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name} port ${url.port} does not match ${portName}=${expectedPort}.`);
    }
  }
}

function requireMember(seed: SeedData): { member: TestUser; owner: TestUser; mapId: string; tenantSlug: string } {
  const tenant = getSeedTenant(seed);
  const member = tenant.users.member;
  const owner = tenant.users.owner;
  if (!member?.password || !owner?.password) {
    throw new Error('The seed provides no member and owner with a password.');
  }
  return { member, owner, mapId: tenant.mapId, tenantSlug: tenant.slug };
}

function asPoints(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZonePoint[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.x === 'number' && typeof entry.y === 'number') {
      points.push({ x: entry.x, y: entry.y });
    }
  }
  return points;
}

function zonePoints(zone: Record<string, unknown>): ZonePoint[] {
  const direct = asPoints(zone.points ?? zone.polygon);
  if (direct.length > 0) return direct;
  return asPoints(isRecord(zone.polygon) ? zone.polygon.points : undefined);
}

function zoneSnapshot(zone: Record<string, unknown>): ZoneSnapshot {
  return {
    name: typeof zone.name === 'string' ? zone.name : 'Zone',
    capacity: typeof zone.capacity === 'number' ? zone.capacity : null,
    polygon: zonePoints(zone),
    type: typeof zone.type === 'string' ? zone.type : null,
    portalTarget: typeof zone.portalTarget === 'string' ? zone.portalTarget : null,
    portalSpawnX: typeof zone.portalSpawnX === 'number' ? zone.portalSpawnX : null,
    portalSpawnY: typeof zone.portalSpawnY === 'number' ? zone.portalSpawnY : null,
  };
}

function zoneSignature(zone: Record<string, unknown>): ZoneSignature {
  const snapshot = zoneSnapshot(zone);
  return {
    name: snapshot.name,
    capacity: snapshot.capacity,
    type: snapshot.type,
    points: snapshot.polygon,
    portalTarget: snapshot.portalTarget,
    portalSpawnX: snapshot.portalSpawnX,
    portalSpawnY: snapshot.portalSpawnY,
  };
}

function sortSignatures(zones: ZoneSignature[]): ZoneSignature[] {
  return [...zones].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return JSON.stringify(left.points).localeCompare(JSON.stringify(right.points));
  });
}

function objectContent(object: Record<string, unknown>): string {
  const content: Record<string, unknown> = {};
  for (const key of OBJECT_CONTENT_KEYS) content[key] = object[key] ?? null;
  return JSON.stringify(content);
}

async function readJson(response: APIResponse, label: string): Promise<unknown> {
  if (!response.ok()) throw new Error(`${label} failed: HTTP ${response.status()}.`);
  return response.json() as Promise<unknown>;
}

async function getEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`);
  const body = await readJson(response, 'GET editor-state');
  if (!isRecord(body)) throw new Error('GET editor-state did not return a JSON object.');
  return body;
}

async function listObjects(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>[]> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects`);
  const body = await readJson(response, 'GET objects');
  if (!Array.isArray(body) || !body.every(isRecord)) throw new Error('GET objects did not return a JSON array.');
  return body;
}

async function readSnapshot(request: APIRequestContext, apiUrl: string, mapId: string): Promise<MapSnapshot> {
  const state = await getEditorState(request, apiUrl, mapId);
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord).map(zoneSnapshot) : [];
  const objects = (await listObjects(request, apiUrl, mapId)).map((object) => {
    if (typeof object.id !== 'number') throw new Error('Map object has no numeric id.');
    return { id: object.id, content: objectContent(object) };
  });
  objects.sort((left, right) => left.id - right.id);
  zones.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return JSON.stringify(left.polygon).localeCompare(JSON.stringify(right.polygon));
  });
  return {
    zones,
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
    objects,
  };
}

async function restoreSnapshot(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  baseline: MapSnapshot,
): Promise<string[]> {
  const errors: string[] = [];
  const current = await listObjects(request, apiUrl, mapId);
  for (const object of current) {
    if (typeof object.id !== 'number' || baseline.objects.some((known) => known.id === object.id)) continue;
    const response = await request.delete(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${object.id}`);
    if (!response.ok()) errors.push(`object ${object.id} cleanup failed: HTTP ${response.status()}.`);
  }
  const missing = baseline.objects.filter((known) => !current.some((object) => object.id === known.id));
  if (missing.length > 0) {
    const ids = missing.map((object) => object.id).join(',');
    errors.push(`objects missing after the test: ${ids}.`);
  }
  const response = await request.put(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state`, {
    data: {
      zones: baseline.zones,
      replaceZones: true,
      ...(baseline.backgroundColor ? { backgroundColor: baseline.backgroundColor } : {}),
    },
  });
  if (!response.ok()) errors.push(`editor-state restore failed: HTTP ${response.status()}.`);
  return errors;
}

/** Runs the body, then restores the seed map when it drifted. */
async function withUnchangedMap(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  body: () => Promise<void>,
): Promise<void> {
  const before = await readSnapshot(request, apiUrl, mapId);
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (error) {
    bodyError = error instanceof Error ? error : new Error('Test body failed.');
  }
  const after = await readSnapshot(request, apiUrl, mapId);
  const drifted = JSON.stringify(before) !== JSON.stringify(after);
  const restoreErrors = drifted ? await restoreSnapshot(request, apiUrl, mapId, before) : [];
  if (drifted) {
    const drift = new Error('The seed map changed during the test.');
    bodyError = bodyError ?? drift;
    if (bodyError !== drift) bodyError.message += ` | ${drift.message}`;
  }
  if (bodyError) {
    if (restoreErrors.length > 0) bodyError.message += ` | cleanup failed: ${restoreErrors.join('; ')}`;
    throw bodyError;
  }
  if (restoreErrors.length > 0) throw new Error(`Cleanup failed: ${restoreErrors.join('; ')}`);
}

async function expectStatus(response: APIResponse, status: number, error: string): Promise<void> {
  expect(response.status()).toBe(status);
  const body: unknown = await response.json();
  expect(body).toEqual({ error });
}

async function expectForeignMapDenied(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  tenantSlug: string,
): Promise<void> {
  const marker = `e2e-we-${Date.now()}`;
  const calls: DeniedCall[] = [
    { method: 'get', path: `/maps/${encodeURIComponent(mapId)}/editor-state` },
    {
      method: 'put',
      path: `/maps/${encodeURIComponent(mapId)}/editor-state`,
      data: {
        replaceZones: true,
        backgroundColor: '#010203',
        zones: [
          {
            name: marker,
            polygon: [
              { x: 1, y: 1 },
              { x: 2, y: 1 },
              { x: 2, y: 2 },
            ],
          },
        ],
      },
    },
    { method: 'get', path: `/maps/${encodeURIComponent(mapId)}/objects` },
    { method: 'post', path: `/maps/${encodeURIComponent(mapId)}/objects`, data: {} },
    { method: 'patch', path: `/maps/${encodeURIComponent(mapId)}/objects/1`, data: { tileX: 1 } },
    { method: 'delete', path: `/maps/${encodeURIComponent(mapId)}/objects/1` },
  ];
  for (const call of calls) {
    const response = await request[call.method](`${apiUrl}${call.path}`, {
      headers: { 'x-tenant': tenantSlug },
      ...(call.data === undefined ? {} : { data: call.data }),
    });
    await expectStatus(response, 403, 'forbidden');
  }
}

async function expectEditorMenuHidden(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
  await expect(page.getByRole('menuitem', { name: /^(Abmelden|Log out)$/ })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByRole('menuitem', { name: EDITOR_ITEM })).toHaveCount(0);
}

type PlacedPack = {
  packId: number;
  uuid: string;
  objectId: string;
  category: string;
  width: number;
  height: number;
  dataUrl: string;
};

type ObjectWrite = {
  assetPackUuid: string;
  itemId: string;
  category: string;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  collide: false;
  dataUrl: string;
  scaleFactor: number;
};

function repoRoot(testInfo: TestInfo): string {
  return path.resolve(path.dirname(testInfo.file), '..', '..', '..', '..');
}

async function loadSourceObject(
  root: string,
): Promise<{ item: Record<string, unknown>; assetPath: string; author: string }> {
  const manifestPath = path.join(root, SOURCE_MANIFEST);
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(manifest)) throw new Error(`asset pack manifest invalid: ${manifestPath}`);
  const author = manifest.author;
  if (typeof author !== 'string' || author.length === 0) throw new Error('asset pack manifest has no author');
  const objects = manifest.objects;
  if (!Array.isArray(objects)) throw new Error(`asset pack manifest has no objects: ${manifestPath}`);
  const item = objects.find((entry) => isRecord(entry) && entry.id === SOURCE_OBJECT_ID);
  if (!isRecord(item)) throw new Error(`source object ${SOURCE_OBJECT_ID} missing in ${manifestPath}`);
  const dataUrl = item.dataURL;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('/assets/')) {
    throw new Error(`source object ${SOURCE_OBJECT_ID} has no bundled asset path`);
  }
  return { item, assetPath: dataUrl.replace(/^\/assets\//, ''), author };
}

/** Imports one real bundled object via POST /asset-packs/upload, under the test prefix. */
async function uploadPrefixedPack(
  request: APIRequestContext,
  apiUrl: string,
  root: string,
  objectId: string,
): Promise<PlacedPack> {
  const source = await loadSourceObject(root);
  const assetBytes = await readFile(path.join(root, SOURCE_ASSET_ROOT, source.assetPath));
  const uuid = randomUUID();
  const archive = new JSZip();
  archive.file(
    'config.json',
    JSON.stringify({
      uuid,
      name: objectId,
      description: 'Temporary map object for the editor access spec.',
      author: source.author,
      version: '1.0.0',
      terrain: [],
      structures: [],
      objects: [{ ...source.item, id: objectId, dataURL: `assets/${source.assetPath}` }],
      autotiles: [],
    }),
  );
  archive.file(`assets/${source.assetPath}`, assetBytes);
  const uploaded = await request.post(`${apiUrl}/asset-packs/upload`, {
    multipart: {
      file: {
        name: `${uuid}.zip`,
        mimeType: 'application/zip',
        buffer: await archive.generateAsync({ type: 'nodebuffer' }),
      },
    },
  });
  if (!uploaded.ok()) throw new Error(`asset pack upload failed: HTTP ${uploaded.status()}.`);
  const created: unknown = await uploaded.json();
  if (!isRecord(created) || typeof created.id !== 'number' || typeof created.uuid !== 'string') {
    throw new Error('asset pack upload response without id/uuid');
  }
  const stored = await request.get(`${apiUrl}/asset-packs/${created.uuid}`);
  const body = await readJson(stored, 'GET asset pack');
  if (!isRecord(body) || !Array.isArray(body.objects)) throw new Error('asset pack response without objects');
  const item = body.objects.find((entry) => isRecord(entry) && entry.id === objectId);
  if (!isRecord(item)) throw new Error(`uploaded pack has no object ${objectId}`);
  const width = item.width;
  const height = item.height;
  const dataUrl = item.dataURL;
  const category = item.category;
  const sizeOk = typeof width === 'number' && typeof height === 'number' && width > 0;
  const textOk = typeof dataUrl === 'string' && typeof category === 'string';
  if (!sizeOk || !textOk) throw new Error(`uploaded pack object ${objectId} is malformed`);
  return { packId: created.id, uuid: created.uuid, objectId, category, width, height, dataUrl };
}

function objectWrite(pack: PlacedPack, tileX: number): ObjectWrite {
  return {
    assetPackUuid: pack.uuid,
    itemId: pack.objectId,
    category: pack.category,
    tileX,
    tileY: 0,
    width: pack.width,
    height: pack.height,
    collide: false,
    dataUrl: pack.dataUrl,
    scaleFactor: 512 / pack.width,
  };
}

async function placeObject(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  data: ObjectWrite,
): Promise<number> {
  const response = await request.post(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects`, { data });
  const body = await readJson(response, 'POST objects');
  if (!isRecord(body) || typeof body.id !== 'number') throw new Error('POST objects did not return an id.');
  return body.id;
}

async function deletePrefixedObjects(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  prefix: string,
): Promise<string[]> {
  const errors: string[] = [];
  let objects: Record<string, unknown>[];
  try {
    objects = await listObjects(request, apiUrl, mapId);
  } catch (error) {
    return [error instanceof Error ? error.message : 'object list failed'];
  }
  for (const object of objects) {
    if (typeof object.id !== 'number') continue;
    if (typeof object.itemId !== 'string' || !object.itemId.startsWith(prefix)) continue;
    const response = await request.delete(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${object.id}`);
    if (!response.ok()) errors.push(`object ${object.id} cleanup failed: HTTP ${response.status()}.`);
  }
  return errors;
}

async function deleteAssetPack(request: APIRequestContext, apiUrl: string, packId: number): Promise<string[]> {
  const response = await request.delete(`${apiUrl}/asset-packs/${packId}`);
  if (response.ok()) return [];
  return [`asset pack ${packId} cleanup failed: HTTP ${response.status()}.`];
}

/** Owner places one prefixed object. The member's POST, PATCH and DELETE must all be forbidden. */
async function expectMemberObjectWritesDenied(
  member: APIRequestContext,
  owner: APIRequestContext,
  apiUrl: string,
  mapId: string,
  pack: PlacedPack,
): Promise<void> {
  let cleanupErrors: string[] = [];
  try {
    const ownedId = await placeObject(owner, apiUrl, mapId, objectWrite(pack, 0));
    const posted = await member.post(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects`, {
      data: objectWrite(pack, 1),
    });
    expect(posted.status()).toBe(403);
    const patched = await member.patch(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${ownedId}`, {
      data: { tileX: 2 },
    });
    expect(patched.status()).toBe(403);
    const removed = await member.delete(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${ownedId}`);
    expect(removed.status()).toBe(403);
  } finally {
    cleanupErrors = await deletePrefixedObjects(owner, apiUrl, mapId, pack.objectId);
  }
  if (cleanupErrors.length > 0) throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`);
}

function signaturesOf(value: unknown): ZoneSignature[] {
  if (!Array.isArray(value)) return [];
  return sortSignatures(value.filter(isRecord).map(zoneSignature));
}

function adminZones(map: Record<string, unknown>): ZoneSignature[] {
  const rooms = Array.isArray(map.rooms) ? map.rooms.filter(isRecord) : [];
  const zones = rooms.flatMap((room) => (Array.isArray(room.zones) ? room.zones : []));
  return signaturesOf(zones);
}

function objectCount(map: Record<string, unknown>): number {
  const counts = map._count;
  if (!isRecord(counts) || typeof counts.objects !== 'number') throw new Error('Admin map has no object count.');
  return counts.objects;
}

async function readAdminMap(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/admin/maps/${encodeURIComponent(mapId)}`);
  const body = await readJson(response, 'GET admin map');
  if (!isRecord(body)) throw new Error('GET admin map did not return a JSON object.');
  return body;
}

// Seeded users start with the onboarding wizard over the room (smoke/auth.spec.ts).
test.beforeEach(async ({ stack, seed }) => {
  await completeSeedOnboarding(stack.apiUrl, seed);
});

test('member cannot change editor state or objects', async ({ loginAs, playwright, seed, stack }, testInfo) => {
  requireIsolatedStack(stack);
  const { member, owner, mapId, tenantSlug } = requireMember(seed);
  const marker = `e2e-we-${Date.now()}`;
  const ownerRequest = await createApiRequest(playwright.request, stack.apiUrl, tenantSlug);
  const operatorRequest = await createApiRequest(playwright.request, stack.apiUrl, 'default');
  let packId: number | undefined;
  let failure: Error | undefined;
  try {
    const operatorApi = new MeetropolisApi(operatorRequest, stack.apiUrl, 'default');
    await operatorApi.login(stack.operatorEmail, stack.operatorPassword);
    const ownerApi = new MeetropolisApi(ownerRequest, stack.apiUrl, tenantSlug);
    await ownerApi.login(owner.email, passwordFor(owner));
    const pack = await uploadPrefixedPack(operatorRequest, stack.apiUrl, repoRoot(testInfo), marker);
    packId = pack.packId;
    await withUnchangedMap(ownerRequest, stack.apiUrl, mapId, async () => {
      const session = await loginAs(member);
      const response = await session.context.request.put(
        `${stack.apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state`,
        {
          data: {
            replaceZones: true,
            backgroundColor: '#010203',
            zones: [
              {
                name: marker,
                polygon: [
                  { x: 1, y: 1 },
                  { x: 2, y: 1 },
                  { x: 2, y: 2 },
                ],
              },
            ],
          },
        },
      );
      await expectStatus(response, 403, 'forbidden - admin required');
      await expectEditorMenuHidden(session.page);
      await expectMemberObjectWritesDenied(session.context.request, ownerRequest, stack.apiUrl, mapId, pack);
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error('Test failed.');
  } finally {
    const cleanupErrors = await deletePrefixedObjects(ownerRequest, stack.apiUrl, mapId, marker);
    if (packId !== undefined) cleanupErrors.push(...(await deleteAssetPack(operatorRequest, stack.apiUrl, packId)));
    await operatorRequest.dispose();
    await ownerRequest.dispose();
    if (cleanupErrors.length > 0) {
      const cleanup = `cleanup failed: ${cleanupErrors.join('; ')}`;
      if (failure) failure.message += ` | ${cleanup}`;
      else failure = new Error(cleanup);
    }
  }
  if (failure) throw failure;
});

test('non-member cannot read or write another map', async ({ freshTenant, playwright, seed, stack }) => {
  requireIsolatedStack(stack);
  const home = getSeedTenant(seed);
  const owner = home.users.owner;
  if (!owner?.password) throw new Error('The seed tenant has no owner with a password.');
  const outsider = freshTenant.users.owner;
  const ownerRequest = await createApiRequest(playwright.request, stack.apiUrl, home.slug);
  const outsiderRequest = await createApiRequest(playwright.request, stack.apiUrl, freshTenant.slug);
  try {
    await new MeetropolisApi(ownerRequest, stack.apiUrl, home.slug).login(owner.email, passwordFor(owner));
    await new MeetropolisApi(outsiderRequest, stack.apiUrl, freshTenant.slug).login(
      outsider.email,
      passwordFor(outsider),
    );
    await withUnchangedMap(ownerRequest, stack.apiUrl, home.mapId, async () => {
      await expectForeignMapDenied(outsiderRequest, stack.apiUrl, home.mapId, home.slug);
    });
  } finally {
    await outsiderRequest.dispose();
    await ownerRequest.dispose();
  }
});
test('new tenant starts from the template default map', async ({ freshTenant, playwright, stack }) => {
  requireIsolatedStack(stack);
  const operatorRequest = await createApiRequest(playwright.request, stack.apiUrl, 'default');
  const ownerRequest = await createApiRequest(playwright.request, stack.apiUrl, freshTenant.slug);
  try {
    const operatorApi = new MeetropolisApi(operatorRequest, stack.apiUrl, 'default');
    await operatorApi.login(stack.operatorEmail, stack.operatorPassword);
    const ownerApi = new MeetropolisApi(ownerRequest, stack.apiUrl, freshTenant.slug);
    await ownerApi.login(freshTenant.users.owner.email, passwordFor(freshTenant.users.owner));
    const tenant = await ownerApi.tenant();
    if (!tenant.defaultMapName) throw new Error('The new tenant has no default map name.');
    const maps = await operatorApi.adminMaps();
    const templateSummary = maps.find((map) => map.tenantSlug === 'template' && map.name === tenant.defaultMapName);
    if (!templateSummary) throw new Error(`Template tenant has no map named ${tenant.defaultMapName}.`);
    expect(freshTenant.mapId).not.toBe(templateSummary.id);
    const templateMap = await readAdminMap(operatorRequest, stack.apiUrl, templateSummary.id);
    const copiedMap = await readAdminMap(operatorRequest, stack.apiUrl, freshTenant.mapId);
    const templateZoneList = adminZones(templateMap);
    const copiedCount = objectCount(copiedMap);
    const templateCount = objectCount(templateMap);
    if (templateZoneList.length === 0 && templateCount === 0) {
      test.skip(
        true,
        'The template starter map has no zones and no objects, so a copy cannot be told apart from an empty map.',
      );
    }
    expect(adminZones(copiedMap)).toEqual(templateZoneList);
    expect(copiedCount).toBe(templateCount);
    expect(signaturesOf((await getEditorState(ownerRequest, stack.apiUrl, freshTenant.mapId)).zones)).toEqual(
      templateZoneList,
    );
    expect((await listObjects(ownerRequest, stack.apiUrl, freshTenant.mapId)).length).toBe(templateCount);
  } finally {
    await ownerRequest.dispose();
    await operatorRequest.dispose();
  }
});
