/**
 * Member-assets security end-to-end specification (T10).
 *
 * Server contract (committed): GET/HEAD `/member-assets/v1/packs/<packKey>/<rest>`
 * and `/member-assets/v1/npc-media/<slug>/<npcId>/<file>` answer 401 without a
 * session, 403 without an active membership in the tenant and 404 for foreign,
 * missing or dotted paths, always with `Cache-Control: no-store`; with
 * `MEMBER_ASSETS_ENFORCE=true` the legacy `/packs/*` and `/npc-media/*` paths
 * answer 404 (no-store). A desktop origin (`tauri://localhost`) without the
 * `X-Asset-Protocol` header gets 426 with `code: 'client_update_required'` on
 * API requests, and a world join without the `assetProtocol` option closes with
 * 4426 (over matchmake HTTP: 426). The web loads images via fetch-to-blob
 * (`apps/web/src/lib/memberAssets.ts`).
 *
 * Real HTTP and browser paths only, no mocked server answers. Every test first
 * requires the enforced test stack and fails with a clear message otherwise;
 * nothing here changes stack configuration (see open points in k18-t10-e2e).
 *
 * Runs only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N and
 * loopback origins from MT_PORT_API/MT_PORT_WEB (same gate as the neighbouring
 * specs). Playwright is not executed by the authoring task; the expected red
 * statements below describe the committed basis without this series.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';
import type { APIRequestContext, Response as PageResponse, TestInfo } from '@playwright/test';

import { expect, test } from './fixtures';
import type { SeedData, TestUser } from './support/api';
import { createApiRequest, MeetropolisApi } from './support/api';
import { getSeedTenant, passwordFor } from './fixtures/helpers';
import { composeBody, hairValues, requireAvatarEditorEnabled } from './avatar/helpers';
import { provisionGuest } from './support/provisioning';

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

/** Red on the basis without this series: the route is unknown, every member-assets request answers 404. */
const MEMBER_PREFIX = '/member-assets/v1/';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Legacy byte paths must never appear on the wire except inside a member-assets URL. */
function isLegacyPackRequest(url: string): boolean {
  if (url.includes('/member-assets/')) return false;
  return url.includes('/packs/') || url.includes('/npc-media/');
}

/** Requires the isolated stack and rejects production targets outright. */
function requireIsolatedStack(stack: { apiUrl: string; baseUrl: string }): void {
  const project = process.env.MT_PROJECT ?? '';
  if (!/^mtest-\d+$/.test(project)) {
    throw new Error(`MT_PROJECT must be mtest-<number>, found: ${project || '<empty>'}.`);
  }
  const apiPort = process.env.MT_PORT_API ?? '';
  const webPort = process.env.MT_PORT_WEB ?? '';
  const targets: Array<[string, string, string]> = [
    ['E2E_API_URL', stack.apiUrl, apiPort],
    ['E2E_BASE_URL', stack.baseUrl, webPort],
  ];
  for (const [name, value, expectedPort] of targets) {
    if (expectedPort === '') throw new Error(`${name}: no expected port known (MT_PORT_API/MT_PORT_WEB).`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL.`);
    }
    if (url.protocol !== 'http:') throw new Error(`${name} must use loopback http.`);
    if (url.hostname !== 'localhost') throw new Error(`${name} must have origin localhost.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name} port ${url.port} does not match the expected test-stack port.`);
    }
  }
}

function requireSeedMember(seed: SeedData): { owner: TestUser; member: TestUser; mapId: string; tenantSlug: string } {
  const tenant = getSeedTenant(seed);
  const owner = tenant.users.owner;
  const member = tenant.users.member;
  if (!owner?.password || !member?.password) {
    throw new Error('The seed provides no owner and member with a password (see support/seed.setup.ts).');
  }
  return { owner, member, mapId: tenant.mapId, tenantSlug: tenant.slug };
}

/** Logged-in tenant API context (session cookie plus x-tenant header, like the browser). */
async function loginTenantContext(
  playwrightRequest: Parameters<typeof createApiRequest>[0],
  apiUrl: string,
  tenantSlug: string,
  email: string,
  password: string,
): Promise<APIRequestContext> {
  const context = await createApiRequest(playwrightRequest, apiUrl, tenantSlug);
  try {
    await new MeetropolisApi(context, apiUrl, tenantSlug).login(email, password);
    return context;
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

const SOURCE_MANIFEST = 'apps/server/prisma/seed-data/asset-packs/atelier-v1/holz.json';
const SOURCE_ASSET_ROOT = 'apps/web/public/assets';
const SOURCE_OBJECT_ID = 'atelier_v1_holz_armchair';

function repoRoot(testInfo: TestInfo): string {
  return path.resolve(path.dirname(testInfo.file), '..', '..', '..', '..');
}

interface UploadedPack {
  packId: number;
  uuid: string;
  memberPath: string;
  legacyPath: string;
}

/** Uploads a real pack (bundled Atelier-v1 asset) and derives both URL shapes. */
async function uploadTestPack(request: APIRequestContext, root: string): Promise<UploadedPack> {
  const manifest: unknown = JSON.parse(await readFile(path.join(root, SOURCE_MANIFEST), 'utf8'));
  if (!isRecord(manifest)) throw new Error('asset pack manifest is invalid');
  const author = manifest.author;
  if (typeof author !== 'string' || author.length === 0) throw new Error('asset pack manifest has no author');
  const objects = manifest.objects;
  if (!Array.isArray(objects)) throw new Error('asset pack manifest has no objects');
  const item = objects.find((entry) => isRecord(entry) && entry.id === SOURCE_OBJECT_ID);
  if (!isRecord(item)) throw new Error(`source object ${SOURCE_OBJECT_ID} is missing`);
  const dataUrl = item.dataURL;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('/assets/')) {
    throw new Error(`source object ${SOURCE_OBJECT_ID} has no bundled asset path`);
  }
  const assetBytes = await readFile(path.join(root, SOURCE_ASSET_ROOT, dataUrl.replace(/^\/assets\//, '')));
  const uuid = randomUUID();
  const archive = new JSZip();
  archive.file(
    'config.json',
    JSON.stringify({
      uuid,
      name: `mtest-member-assets-${uuid.slice(0, 8)}`,
      description: 'Temporary E2E pack for the member-assets security spec.',
      author,
      version: '1.0.0',
      terrain: [],
      structures: [],
      objects: [{ ...item, dataURL: `assets/${dataUrl.replace(/^\/assets\//, '')}` }],
      autotiles: [],
    }),
  );
  archive.file(`assets/${dataUrl.replace(/^\/assets\//, '')}`, assetBytes);
  const upload = await request.post(`${API_URL}/asset-packs/upload`, {
    multipart: {
      file: {
        name: `${uuid}.zip`,
        mimeType: 'application/zip',
        buffer: await archive.generateAsync({ type: 'nodebuffer' }),
      },
    },
  });
  if (!upload.ok()) throw new Error(`asset pack upload failed: HTTP ${upload.status()} ${await upload.text()}`);
  const uploadBody: unknown = await upload.json();
  if (!isRecord(uploadBody)) throw new Error('asset pack upload response is invalid');
  const packId = uploadBody.id;
  const uploadedUuid = uploadBody.uuid;
  if (typeof packId !== 'number' || typeof uploadedUuid !== 'string' || uploadedUuid.length === 0) {
    throw new Error('asset pack upload response has no id/uuid');
  }
  const readBack = await request.get(`${API_URL}/asset-packs/${uploadedUuid}`);
  if (!readBack.ok()) throw new Error(`asset pack read failed: HTTP ${readBack.status()} ${await readBack.text()}`);
  const packBody: unknown = await readBack.json();
  if (!isRecord(packBody) || !Array.isArray(packBody.objects)) throw new Error('asset pack response is invalid');
  const stored = packBody.objects.find((entry) => isRecord(entry) && entry.id === SOURCE_OBJECT_ID);
  if (!isRecord(stored) || typeof stored.dataURL !== 'string') throw new Error('uploaded pack has no stored dataURL');
  // The processor stores `/packs/<uuid>/<mapped>` (assetPacks.processor.ts); the
  // member route serves the same file below `/member-assets/v1/packs/<uuid>/<mapped>`.
  const prefix = `/packs/${uploadedUuid}/`;
  if (!stored.dataURL.startsWith(prefix)) {
    throw new Error(`unexpected stored dataURL shape ${stored.dataURL}: cannot derive the member path.`);
  }
  const rest = stored.dataURL.slice(prefix.length);
  return {
    packId,
    uuid: uploadedUuid,
    memberPath: `${MEMBER_PREFIX}packs/${uploadedUuid}/${rest}`,
    legacyPath: stored.dataURL,
  };
}

async function deleteTestPack(request: APIRequestContext, packId: number): Promise<void> {
  const response = await request.delete(`${API_URL}/asset-packs/${packId}`);
  if (!response.ok()) throw new Error(`asset pack cleanup failed: HTTP ${response.status()} ${await response.text()}`);
}

/** The whole spec requires the enforced stack: legacy bytes must already be closed. */
async function requireEnforced(request: APIRequestContext, legacyPath: string): Promise<void> {
  const probe = await request.get(`${API_URL}${legacyPath}`);
  if (probe.status() !== 404) {
    throw new Error(
      `The test stack is not enforced (GET ${legacyPath} answered ${probe.status()}, expected 404): ` +
        'start the test stack with MEMBER_ASSETS_ENFORCE=true before running this spec.',
    );
  }
  if (probe.headers()['cache-control'] !== 'no-store') {
    throw new Error('The legacy guard must answer with Cache-Control: no-store.');
  }
}

function expectImageHeaders(headers: Record<string, string>): void {
  expect(headers['content-type'], 'member bytes must arrive as an image, not JSON').toMatch(/^image\//);
  expect(headers['cache-control'], 'member bytes must not be cached').toBe('private, no-store');
}

test.describe('member assets security', () => {
  it('world load fetches pack files through /member-assets/v1 and never /packs/', async ({ stack, seed, loginAs }) => {
    // Red on the basis without this series: no /member-assets/v1 request at all,
    // the pack bytes travel directly over /packs/ (or the request 404s).
    requireIsolatedStack(stack);
    const { member } = requireSeedMember(seed);
    const { page } = await loginAs(member);
    const legacy: string[] = [];
    page.on('request', (request) => {
      if (isLegacyPackRequest(request.url())) legacy.push(request.url());
    });
    await page.reload();
    const response = await page.waitForResponse(
      (candidate) => candidate.url().includes(MEMBER_PREFIX) && candidate.ok(),
      { timeout: 90_000 },
    );
    expect(response.status(), 'at least one pack file must load through /member-assets/v1').toBe(200);
    expect(legacy, `no legacy pack request is allowed, saw: ${legacy.join(', ')}`).toEqual([]);
  });

  it('editor tileset preview loads through /member-assets/v1 and never /packs/', async ({
    stack,
    seed,
    loginAs,
    playwright,
  }, testInfo) => {
    // Red on the basis without this series: the preview request 404s because
    // /member-assets/v1 does not exist yet.
    requireIsolatedStack(stack);
    const { owner, mapId, tenantSlug } = requireSeedMember(seed);
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(api, repoRoot(testInfo));
      await requireEnforced(api, pack.legacyPath);
      const packUuid = pack.uuid;
      const key = `mtest-member-assets-${randomUUID().slice(0, 8)}`;
      const registered = await api.post(`${stack.apiUrl}/maps/${encodeURIComponent(mapId)}/tilesets`, {
        data: { key, imageUrl: pack.legacyPath, tileWidth: 16, tileHeight: 16 },
      });
      expect(registered.ok(), 'the editor tileset registration must succeed').toBe(true);

      const { page } = await loginAs(owner);
      const seen: PageResponse[] = [];
      page.on('response', (candidate) => {
        if (candidate.url().includes(`${MEMBER_PREFIX}packs/${packUuid}/`)) seen.push(candidate);
      });
      const legacy: string[] = [];
      page.on('request', (request) => {
        if (isLegacyPackRequest(request.url())) legacy.push(request.url());
      });
      await page.reload();
      await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
      await page.getByRole('menuitem', { name: /Map-Editor öffnen|Open map editor/ }).click();
      await expect(page.getByText('Map-Editor', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => seen.filter((candidate) => candidate.ok()).length, {
          timeout: 60_000,
          message: 'the tileset preview must load through /member-assets/v1 with 200.',
        })
        .toBeGreaterThan(0);
      expect(legacy, `no legacy pack request is allowed, saw: ${legacy.join(', ')}`).toEqual([]);
    } finally {
      if (pack) await deleteTestPack(api, pack.packId).catch(() => {});
      await api.dispose();
    }
  });

  it('avatar preview in settings loads through /member-assets/v1 and never /packs/', async ({
    stack,
    seed,
    loginAs,
    playwright,
    request,
  }) => {
    // Red on the basis without this series: the composed bytes are unreachable
    // (404) and the settings preview loads them directly over /packs/.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug });
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    try {
      const hair = hairValues()[0];
      if (!hair) throw new Error('The sprite catalog provides no hairstyle.');
      const composed = await api.post(`${stack.apiUrl}/me/avatar/compose`, { data: composeBody(hair) });
      expect(composed.ok(), 'the custom avatar must be composable').toBe(true);
      const composedBody: unknown = await composed.json();
      if (!isRecord(composedBody) || typeof composedBody.avatarId !== 'string') {
        throw new Error('the compose response has no avatarId');
      }
      const match = /^custom:([0-9a-f-]{36})$/i.exec(composedBody.avatarId);
      if (!match?.[1]) throw new Error(`unexpected custom avatar id ${composedBody.avatarId}`);
      const avatarUuid = match[1];
      const memberSprite = `${MEMBER_PREFIX}packs/avatars/custom/${avatarUuid}.png`;
      const stored = await api.get(`${stack.apiUrl}/${memberSprite}`);
      expect(stored.status(), 'the composed sprite must load through /member-assets/v1').toBe(200);
      expectImageHeaders(stored.headers());
      const legacyAvatar = await api.get(`${stack.apiUrl}/packs/avatars/custom/${avatarUuid}.png`);
      expect(legacyAvatar.status(), 'the legacy custom avatar path must stay closed').toBe(404);

      const { page } = await loginAs(owner);
      const legacy: string[] = [];
      page.on('request', (candidate) => {
        if (isLegacyPackRequest(candidate.url())) legacy.push(candidate.url());
      });
      await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
      await page.getByRole('menuitem', { name: /Profil|Profile/ }).click();
      await expect(page.getByRole('button', { name: 'Vorlage' })).toBeVisible({ timeout: 30_000 });
      const preview = await page.waitForResponse(
        (candidate) => candidate.url().includes(MEMBER_PREFIX) && candidate.ok(),
        { timeout: 60_000 },
      );
      expect(preview.status(), 'an avatar preview must load through /member-assets/v1').toBe(200);
      expect(legacy, `no legacy avatar request is allowed, saw: ${legacy.join(', ')}`).toEqual([]);
    } finally {
      await api.dispose();
    }
  });

  it('anonymous pack bytes are rejected with 401 and no image', async ({
    stack,
    seed,
    playwright,
    request,
  }, testInfo) => {
    // Red on the basis without this series: the route is unknown, the request answers 404.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(api, repoRoot(testInfo));
      await requireEnforced(api, pack.legacyPath);
    } finally {
      if (pack) await deleteTestPack(api, pack.packId).catch(() => {});
      await api.dispose();
    }
    if (!pack) throw new Error('pack setup failed');
    const anonymous = await request.get(`${stack.apiUrl}/${pack.memberPath}`);
    expect(anonymous.status(), 'anonymous pack bytes must be rejected').toBe(401);
    expect(anonymous.headers()['content-type'], 'a 401 must not carry image bytes').not.toMatch(/^image\//);
    expect(anonymous.headers()['cache-control']).toBe('no-store');
  });

  it('foreign tenant pack bytes answer 404 with no bytes', async ({ stack, seed, playwright }, testInfo) => {
    // Red on the basis without this series: 404 as well, but for the wrong reason
    // (unknown route). Green differs: the route exists and the pack is outside the
    // caller tenant scope, so the decision is not_found and nothing is enumerable.
    testInfo.skip(
      seed.edition !== 'ee',
      'cross-tenant isolation needs the enterprise seed with the acme and globex tenants.',
    );
    requireIsolatedStack(stack);
    const acme = seed.tenants.acme;
    const globex = seed.tenants.globex;
    if (!acme?.users.owner || !globex?.users.owner) throw new Error('the seed has no acme/globex owners.');
    const acmeApi = await loginTenantContext(
      playwright.request,
      stack.apiUrl,
      acme.slug,
      acme.users.owner.email,
      passwordFor(acme.users.owner),
    );
    const globexApi = await loginTenantContext(
      playwright.request,
      stack.apiUrl,
      globex.slug,
      globex.users.owner.email,
      passwordFor(globex.users.owner),
    );
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(acmeApi, repoRoot(testInfo));
      await requireEnforced(acmeApi, pack.legacyPath);
      const foreign = await globexApi.get(`${stack.apiUrl}/${pack.memberPath}`);
      expect(foreign.status(), 'a foreign tenant pack file must not resolve').toBe(404);
      expect(foreign.headers()['content-type'], 'a 404 must not carry image bytes').not.toMatch(/^image\//);
      expect(foreign.headers()['cache-control']).toBe('no-store');
    } finally {
      if (pack) await deleteTestPack(acmeApi, pack.packId).catch(() => undefined);
      await globexApi.dispose();
      await acmeApi.dispose();
    }
  });

  it('expired guest membership loses pack access without waiting', async ({
    stack,
    seed,
    playwright,
    db,
  }, testInfo) => {
    // Red on the basis without this series: the first request already 404s.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    const tenant = getSeedTenant(seed);
    const ownerCtx = await createApiRequest(playwright.request, stack.apiUrl, tenantSlug);
    const guestCtx = await createApiRequest(playwright.request, stack.apiUrl, tenantSlug);
    let pack: UploadedPack | undefined;
    try {
      const ownerApi = new MeetropolisApi(ownerCtx, stack.apiUrl, tenantSlug);
      await ownerApi.login(owner.email, passwordFor(owner));
      pack = await uploadTestPack(ownerCtx, repoRoot(testInfo));
      await requireEnforced(ownerCtx, pack.legacyPath);
      const guest = await provisionGuest({
        playwrightRequest: playwright.request,
        ownerApi,
        apiUrl: stack.apiUrl,
        baseUrl: stack.baseUrl,
        tenantSlug,
        email: `mtest-guest-${randomUUID().slice(0, 8)}@invalid.test`,
      });
      const guestApi = new MeetropolisApi(guestCtx, stack.apiUrl, tenantSlug);
      expect(guest.guestUrl, 'guest provisioning must return a guest link').toBeTruthy();
      await guestApi.loginGuest(guest.guestUrl ?? '');
      const allowed = await guestCtx.get(`${stack.apiUrl}/${pack.memberPath}`);
      expect(allowed.status(), 'an active guest membership must read pack bytes').toBe(200);
      expectImageHeaders(allowed.headers());
      // Expire the membership directly in the database: the authorizer reads it
      // fresh on every call, so no waiting is needed. Table and column names
      // follow apps/server/prisma/schema.prisma (model Membership, no @@map).
      await db.query('UPDATE "Membership" SET "expiresAt" = $1 WHERE "tenantId" = $2 AND "userId" = $3', [
        new Date(Date.now() - 60_000),
        tenant.tenantId,
        guest.userId,
      ]);
      const denied = await guestCtx.get(`${stack.apiUrl}/${pack.memberPath}`);
      expect(denied.status(), 'an expired guest membership must lose pack access').toBe(403);
      expect(denied.headers()['cache-control']).toBe('no-store');
    } finally {
      if (pack) await deleteTestPack(ownerCtx, pack.packId).catch(() => undefined);
      await guestCtx.dispose();
      await ownerCtx.dispose();
    }
  });

  it('legacy pack bytes stay closed with 404 and no-store', async ({ stack, seed, playwright }, testInfo) => {
    // Red on the basis without this series: the legacy path serves 200 with the image.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(api, repoRoot(testInfo));
      const legacy = await api.get(`${stack.apiUrl}/${pack.legacyPath}`);
      expect(legacy.status(), 'the legacy pack path must stay closed once enforced').toBe(404);
      expect(legacy.headers()['cache-control']).toBe('no-store');
      const legacyHead = await api.head(`${stack.apiUrl}/${pack.legacyPath}`);
      expect(legacyHead.status(), 'the legacy pack path must stay closed for HEAD as well').toBe(404);
      expect(legacyHead.headers()['cache-control']).toBe('no-store');
    } finally {
      if (pack) await deleteTestPack(api, pack.packId).catch(() => undefined);
      await api.dispose();
    }
  });

  it('byte ranges answer 206 with exactly the requested bytes', async ({ stack, seed, playwright }, testInfo) => {
    // Red on the basis without this series: the range request 404s.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(api, repoRoot(testInfo));
      await requireEnforced(api, pack.legacyPath);
      const ranged = await api.get(`${stack.apiUrl}/${pack.memberPath}`, { headers: { Range: 'bytes=0-3' } });
      expect(ranged.status(), 'a satisfiable range must answer 206').toBe(206);
      expect((await ranged.body()).length, 'bytes=0-3 must deliver exactly 4 bytes').toBe(4);
      expect(ranged.headers()['content-range'], 'the range must be announced').toMatch(/^bytes 0-3\//);
      expect(ranged.headers()['cache-control']).toBe('no-store');
    } finally {
      if (pack) await deleteTestPack(api, pack.packId).catch(() => undefined);
      await api.dispose();
    }
  });

  it('outdated desktop client gets 426 and no world join without assetProtocol', async ({
    stack,
    seed,
    playwright,
  }, testInfo) => {
    // Red on the basis without this series: the probe 404s (unknown route) and
    // the matchmake join proceeds to a seat instead of closing.
    // No test.skip here by design: when tauri://localhost is not allowlisted,
    // this test fails with the prerequisite message below instead of going green.
    requireIsolatedStack(stack);
    const { owner, tenantSlug } = requireSeedMember(seed);
    const api = await loginTenantContext(playwright.request, stack.apiUrl, tenantSlug, owner.email, passwordFor(owner));
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(api, repoRoot(testInfo));
      await requireEnforced(api, pack.legacyPath);
      const probe = await api.get(`${stack.apiUrl}/${pack.memberPath}`, {
        headers: { Origin: 'tauri://localhost' },
      });
      if (probe.status() !== 426) {
        throw new Error(
          `expected 426 for a desktop origin without X-Asset-Protocol, got ${probe.status()}: ` +
            'the test stack must list tauri://localhost in CORS_ORIGIN, otherwise the ' +
            'client-compatibility middleware does not treat the request as desktop.',
        );
      }
      const probeBody: unknown = await probe.json();
      if (!isRecord(probeBody) || probeBody.code !== 'client_update_required') {
        throw new Error('the 426 answer must carry code client_update_required.');
      }
      expect(probe.headers()['cache-control']).toBe('no-store');
      // The same gate on the world join: without the assetProtocol option the
      // room closes with 4426, which matchmaking surfaces as HTTP 426.
      const join = await api.post(`${stack.apiUrl}/matchmake/joinOrCreate/world`, {
        headers: { Origin: 'tauri://localhost', 'Content-Type': 'application/json' },
        data: {},
      });
      expect(join.status(), 'a desktop join without assetProtocol must not get a seat').toBe(426);
      expect(await join.text(), 'the join rejection must name the update code').toContain('client_update_required');
    } finally {
      if (pack) await deleteTestPack(api, pack.packId).catch(() => undefined);
      await api.dispose();
    }
  });

  it('logout revokes pack access for the old session', async ({ stack, seed, loginAs, playwright }, testInfo) => {
    // Red on the basis without this series: the in-page fetch already 404s.
    requireIsolatedStack(stack);
    const { owner, member, tenantSlug } = requireSeedMember(seed);
    const ownerApi = await loginTenantContext(
      playwright.request,
      stack.apiUrl,
      tenantSlug,
      owner.email,
      passwordFor(owner),
    );
    let pack: UploadedPack | undefined;
    try {
      pack = await uploadTestPack(ownerApi, repoRoot(testInfo));
      await requireEnforced(ownerApi, pack.legacyPath);
      const memberPath = pack.memberPath;
      const { page } = await loginAs(member);
      const loaded = await page.evaluate<{ status: number; type: string }, string>(async (url: string) => {
        const response = await fetch(url, { credentials: 'include' });
        const blob = await response.blob();
        return { status: response.status, type: blob.type };
      }, `${stack.apiUrl}/${memberPath}`);
      expect(loaded.status, 'the member session must read pack bytes before logout').toBe(200);
      expect(loaded.type).toMatch(/^image\//);
      const loggedOut = page.waitForResponse(
        (candidate) => candidate.url().includes('/auth/logout') && candidate.request().method() === 'POST',
      );
      await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
      await page.getByRole('menuitem', { name: /Abmelden|Log ?out/i }).click();
      await loggedOut;
      await expect
        .poll(
          () =>
            page.evaluate<number, string>(
              async (url: string) => (await fetch(url, { credentials: 'include' })).status,
              `${stack.apiUrl}/${memberPath}`,
            ),
          { timeout: 30_000, message: 'the old session must be rejected with 401 after logout.' },
        )
        .toBe(401);
    } finally {
      if (pack) await deleteTestPack(ownerApi, pack.packId).catch(() => undefined);
      await ownerApi.dispose();
    }
  });
});
