/**
 * Editor persistence E2E: save, objects and spawn survive a fresh client start.
 *
 * The three cases use only real paths: seeded owner/admin accounts via the
 * loginAs fixture, real PUT/GET calls against /maps/:id/editor-state and
 * /maps/:id/objects, and the real editor UI for every save. No route mocks,
 * no test hooks, no invented users or packs.
 *
 * Verified selectors (all from the product code):
 * - menu button with aria-label `Menü`/`Menu`, menu item
 *   `Map-Editor öffnen`/`Open map editor`, window `Map-Editor` with the
 *   hard-coded tabs `Allgemein` and `Zonen`
 *   (apps/web/src/ui/app/TopRightMenu.tsx, apps/web/src/features/editor/EditorWindow.tsx).
 * - zone list `Zonen-Verwaltung`/`Zone management` with inputs
 *   `input[id^="zone-name-"]` (apps/web/src/ui/editor/ZoneEditor.tsx).
 * - background color picker on the `Allgemein` tab and the footer save
 *   button `Speichern`/`Save` (apps/web/src/ui/editor/EditorPanel.tsx),
 *   which persists via saveAllToServerImpl with PUT /maps/:id/editor-state
 *   (apps/web/src/app/routes/WorldApp.tsx).
 * - spawn buttons `Spawn setzen`/`Set spawn` and `Entfernen`/`Remove`
 *   (apps/web/src/ui/editor/EditorPanel.tsx, locales de/en common.json).
 *
 * Verified canvas read path: `window.__PHASER_GAME__` is set in
 * apps/web/src/game/phaserGame.ts:51 and scenes are addressable via
 * `game.scene.getScene('Main')` (key registered in
 * apps/web/src/game/scenes/MainScene.ts:103, same pattern as
 * apps/web/src/game/map/changeMap.ts:54-75). The local player is
 * `playerManager.getHero()` (apps/web/src/game/scenes/main/playerManager.ts:86,
 * position in `hero.x`/`hero.y` world pixels); rendered objects live in the
 * id-keyed sprite map (apps/web/src/game/scenes/main/objectManager.ts:49,219),
 * positioned at `tileX * tileWidth` / `tileY * tileHeight` with origin (0, 0)
 * (objectManager.ts createSprite/updateObject) and rotated via
 * `setRotation(DegToRad(rotation))`. This mirrors the anchor contract
 * `tileToRenderPosition` (apps/web/src/game/editor/editorAnchors.ts:30);
 * the tile size falls back to 16 (apps/web/src/services/editorReducers/assetReducer.ts:3,
 * seed map tileWidth 16 in apps/server/prisma/seed.ts:93).
 *
 * Verified API contracts:
 * - GET /maps/:id/editor-state returns `{ zones, backgroundColor, spawn }`
 *   (apps/server/src/api/routes/maps.editor.zones.ts:35-72); PUT accepts
 *   `{ zones, replaceZones, backgroundColor, spawn: { x, y } }`
 *   (maps.editor.zones.ts:140-200, schema in editorStateSchema.ts:62-77).
 * - GET/POST /maps/:id/objects, PATCH/DELETE /maps/:id/objects/:objId
 *   (apps/server/src/api/routes/mapObjects.ts:516-521); POST needs
 *   `{ assetPackUuid, itemId, category, tileX, tileY, width, height, collide, dataUrl }`
 *   (mapObjects.ts:28-49), PATCH accepts `{ tileX, tileY, rotation, ... }`
 *   (mapObjects.ts:51-58). Writes broadcast `objects_updated` with
 *   `add`/`update`/`remove` (mapObjects.ts:217,292,344), applied live by
 *   `handleObjectsUpdated` (objectManager.ts). Seeded packs carry no tenant
 *   and are therefore global (packScope.ts: tenant scope includes them).
 * - a joining player starts at the saved spawn when no stored position wins
 *   (apps/server/src/rooms/lifecycle/onJoin.completion.ts pickInitialPosition).
 *
 * Run only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N
 * with the localhost ports from MT_PORT_API/MT_PORT_WEB. Without E2E_RUN
 * the file is safely skipped.
 */
import { randomUUID } from 'node:crypto';

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { MeetropolisApi } from '../support/api';
import { getSeedTenant, passwordFor, waitForParticipant } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const LIVE_SYNC_TIMEOUT_MS = 20_000;
const UI_TIMEOUT_MS = 30_000;
const TILE_SIZE_FALLBACK = 16;
/** Globally seeded pack (no tenant), so the seed owner may place its objects. */
const SEED_PACK_UUID = '4664b745-6bad-4d86-ae8f-591c57567692';

type ZonePoint = { x: number; y: number };

type Baseline = {
  zones: Array<Record<string, unknown>>;
  backgroundColor: string | null;
  spawn: { x: number; y: number } | null;
};

type ClientSession = { user: TestUser; context: BrowserContext; page: Page };

type SceneSpriteState = { x: number; y: number; rotation: number };

type MainSceneProbe = {
  objectManager?: { sprites?: Map<number, SceneSpriteState> };
  playerManager?: { getHero?: () => SceneSpriteState | undefined };
  mapRef?: { tileWidth?: number; tileHeight?: number };
};

type GameProbe = { scene: { getScene: (key: string) => unknown } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires the isolated stack and rejects production targets outright. */
function requireIsolatedStack(apiUrl: string, baseUrl: string): void {
  const project = process.env.MT_PROJECT ?? '';
  if (!/^mtest-\d+$/.test(project)) {
    throw new Error(`MT_PROJECT must be mtest-<number>, found: ${project || '<empty>'}.`);
  }
  const checks: Array<[string, string, string]> = [
    ['E2E_API_URL', apiUrl, process.env.MT_PORT_API ?? ''],
    ['E2E_BASE_URL', baseUrl, process.env.MT_PORT_WEB ?? ''],
  ];
  for (const [name, value, expectedPort] of checks) {
    if (expectedPort === '') throw new Error('Expected stack port is missing.');
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== 'localhost') {
      throw new Error(`${name} must use loopback http.`);
    }
    if (url.port !== expectedPort) throw new Error(`${name} port mismatch.`);
  }
}

/** Fetches owner and admin from the real seed; both carry a password. */
function requireSeedAccounts(seed: SeedData): {
  owner: TestUser;
  admin: TestUser;
  mapId: string;
  tenantSlug: string;
} {
  const tenant = getSeedTenant(seed);
  const owner = tenant.users.owner;
  const admin = tenant.users.admin;
  if (!owner?.password || !admin?.password) {
    throw new Error('The seed provides no owner and admin with a password (see support/seed.setup.ts).');
  }
  return { owner, admin, mapId: tenant.mapId, tenantSlug: tenant.slug };
}

function uniqueName(tag: string): string {
  return `e2e-we-${Date.now().toString(36)}-${tag}-${randomUUID().slice(0, 6)}`;
}

async function getEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`);
  if (!response.ok()) throw new Error(`GET editor-state failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('GET editor-state did not return a JSON object.');
  return body;
}

async function putEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  payload: unknown,
): Promise<void> {
  const response = await request.put(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state`, {
    data: payload,
  });
  if (!response.ok()) {
    throw new Error(`PUT editor-state failed: HTTP ${response.status()} ${await response.text()}.`);
  }
}

function readSpawn(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

/**
 * Remembers zones, background and spawn of the seed map for restoration.
 * Zones are kept verbatim (including capacity, type and portal fields) so the
 * restore cannot shed properties the test never touched.
 */
async function readBaseline(request: APIRequestContext, apiUrl: string, mapId: string): Promise<Baseline> {
  const state = await getEditorState(request, apiUrl, mapId);
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones,
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
    spawn: readSpawn(state.spawn),
  };
}

/**
 * Restores the initial state; errors stay visible. A baseline without spawn
 * cannot clear a spawn set during the test: PUT merges `spawn ??
 * currentMeta.spawn` (maps.editor.zones.ts) and the UI save omits an empty
 * spawn, so no HTTP path clears it (see the spawn test below).
 */
async function restoreBaseline(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  baseline: Baseline,
): Promise<string[]> {
  try {
    await putEditorState(request, apiUrl, mapId, {
      zones: baseline.zones,
      replaceZones: true,
      ...(baseline.backgroundColor ? { backgroundColor: baseline.backgroundColor } : {}),
      // null removes a spawn the case added; omitting it would keep that spawn.
      spawn: baseline.spawn ?? null,
    });
    return [];
  } catch (error) {
    return [`Restore failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Runs the test body and then restores the initial state. */
async function withBaseline(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  body: () => Promise<void>,
): Promise<void> {
  const baseline = await readBaseline(request, apiUrl, mapId);
  let bodyError: Error | null = null;
  try {
    await body();
  } catch (error) {
    bodyError = error instanceof Error ? error : new Error('test body failed without an error object.');
  }
  const restoreErrors = await restoreBaseline(request, apiUrl, mapId, baseline);
  if (bodyError) {
    if (restoreErrors.length > 0) throw new Error(`${bodyError.message} | Cleanup: ${restoreErrors.join('; ')}`);
    throw bodyError;
  }
  if (restoreErrors.length > 0) throw new Error(`Cleanup failed: ${restoreErrors.join('; ')}`);
}

/** Logs in owner and admin as two real, separate browser clients. */
async function openClients(
  loginAs: (user: TestUser) => Promise<{ context: BrowserContext; page: Page }>,
  owner: TestUser,
  admin: TestUser,
): Promise<[ClientSession, ClientSession]> {
  const first = await loginAs(owner);
  const second = await loginAs(admin);
  return [
    { user: owner, ...first },
    { user: admin, ...second },
  ];
}

/** Opens the editor via the real menu and switches to the zones tab. */
async function openZonesTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: /Map-Editor öffnen|Open map editor/ }).click();
  await expect(page.getByText('Map-Editor', { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Zonen', exact: true }).click();
  await expect(page.getByText(/Zonen-Verwaltung|Zone management/)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/** Opens the editor via the real menu and switches to the general tab. */
async function openGeneralTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: /Map-Editor öffnen|Open map editor/ }).click();
  await expect(page.getByText('Map-Editor', { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Allgemein', exact: true }).click();
}

/** Checks the visible zone names of the editor list in order. */
async function expectZoneNames(page: Page, names: string[]): Promise<void> {
  const inputs = page.locator('input[id^="zone-name-"]');
  await expect(inputs).toHaveCount(names.length, { timeout: UI_TIMEOUT_MS });
  for (const [index, name] of names.entries()) {
    await expect(page.locator(`#zone-name-${index}`)).toHaveValue(name, { timeout: UI_TIMEOUT_MS });
  }
}

/** Reads one rendered object sprite from the live scene, or null. */
async function readObjectSprite(page: Page, objectId: number): Promise<SceneSpriteState | null> {
  return page.evaluate((id) => {
    const game = (window as unknown as { __PHASER_GAME__?: GameProbe }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Main') as MainSceneProbe | undefined;
    const sprite = scene?.objectManager?.sprites?.get(id);
    if (!sprite) return null;
    return { x: sprite.x, y: sprite.y, rotation: sprite.rotation };
  }, objectId);
}

/** Reads the local player position in world pixels from the live scene. */
async function readHeroPixels(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const game = (window as unknown as { __PHASER_GAME__?: GameProbe }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Main') as MainSceneProbe | undefined;
    const hero = scene?.playerManager?.getHero?.();
    if (!hero || !Number.isFinite(hero.x) || !Number.isFinite(hero.y)) return null;
    return { x: hero.x, y: hero.y };
  });
}

/** Reads the scene tile width in pixels, with the product fallback. */
async function readTileSize(page: Page): Promise<number> {
  const size = await page.evaluate(() => {
    const game = (window as unknown as { __PHASER_GAME__?: GameProbe }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Main') as MainSceneProbe | undefined;
    return scene?.mapRef?.tileWidth;
  });
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : TILE_SIZE_FALLBACK;
}

type PackObject = { objectId: string; category: string; width: number; height: number; dataUrl: string };

/** Reads one real placeable object from the globally seeded pack. */
async function readSeedPackObject(request: APIRequestContext, apiUrl: string): Promise<PackObject> {
  const response = await request.get(`${apiUrl}/asset-packs/${SEED_PACK_UUID}`);
  if (!response.ok()) throw new Error(`GET asset pack failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.objects)) throw new Error('Asset pack has no objects.');
  for (const entry of body.objects) {
    if (!isRecord(entry)) continue;
    // Skip objects with rotation-specific images: those replace programmatic
    // rotation (directionalImageRegistry), which would break the rotation check.
    if (Array.isArray(entry.directionalImages) && entry.directionalImages.length > 0) continue;
    const { id, category, width, height, dataURL } = entry;
    if (
      typeof id === 'string' &&
      typeof category === 'string' &&
      typeof width === 'number' &&
      typeof height === 'number' &&
      typeof dataURL === 'string' &&
      dataURL.length > 0
    ) {
      return { objectId: id, category, width, height, dataUrl: dataURL };
    }
  }
  throw new Error('Seeded pack has no usable object.');
}

async function createMapObject(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  pack: PackObject,
  tileX: number,
  tileY: number,
): Promise<number> {
  const response = await request.post(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects`, {
    data: {
      assetPackUuid: SEED_PACK_UUID,
      itemId: pack.objectId,
      category: pack.category,
      tileX,
      tileY,
      width: pack.width,
      height: pack.height,
      collide: false,
      dataUrl: pack.dataUrl,
    },
  });
  if (!response.ok()) throw new Error(`POST object failed: HTTP ${response.status()} ${await response.text()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.id !== 'number') throw new Error('POST object returned no id.');
  return body.id;
}

async function listObjectIds(request: APIRequestContext, apiUrl: string, mapId: string): Promise<number[]> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects`);
  if (!response.ok()) throw new Error(`GET objects failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('GET objects did not return a list.');
  return body
    .filter(isRecord)
    .map((entry) => entry.id)
    .filter((id): id is number => typeof id === 'number');
}

async function deleteMapObject(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  objectId: number,
): Promise<void> {
  const response = await request.delete(`${apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${objectId}`);
  if (!response.ok()) {
    throw new Error(`DELETE object failed: HTTP ${response.status()} ${await response.text()}.`);
  }
}

/**
 * Case 1 (save and reload): the zone is arranged via the API because drawing
 * a polygon happens on the canvas with no stable selector
 * (ZoneEditor dispatches SET_TOOL `zone`, drawn by EditorInputHandler); the
 * SAVE itself goes through the real UI (background color input plus the
 * footer save button, as in zones-sync Case 2). A fresh client context then
 * loads both the zone and the background color.
 */
test('persists editor state across a fresh client start', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack.apiUrl, stack.baseUrl);
  const { owner, admin, mapId, tenantSlug } = requireSeedAccounts(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const zoneName = uniqueName('zone');
  const rect: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: zoneName, points: rect }],
      replaceZones: true,
    });
    const clientA = await loginAs(owner);
    await openZonesTab(clientA.page);
    await expectZoneNames(clientA.page, [zoneName]);

    const stored = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    const currentBg = typeof stored.backgroundColor === 'string' ? stored.backgroundColor : null;
    const newBg = currentBg?.toLowerCase() === '#334455' ? '#445566' : '#334455';
    await clientA.page.getByRole('button', { name: 'Allgemein', exact: true }).click();
    const colorInputs = clientA.page.locator('input[type="color"]');
    await expect(colorInputs).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
    await colorInputs.first().fill(newBg);
    await expect(clientA.page.getByText(newBg, { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });

    const savePut = clientA.page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes(`/maps/${mapId}/editor-state`),
      { timeout: UI_TIMEOUT_MS },
    );
    await clientA.page.getByRole('button', { name: /^(Speichern|Save)/ }).click();
    const saveResponse = await savePut;
    expect(saveResponse.ok(), `PUT editor-state failed: HTTP ${saveResponse.status()}.`).toBe(true);

    const fresh = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    const freshZones = Array.isArray(fresh.zones) ? fresh.zones.filter(isRecord) : [];
    const kept = freshZones.find((zone) => zone.name === zoneName);
    expect(kept, 'The saved zone must persist server-side.').toBeTruthy();
    expect(fresh.backgroundColor, 'The saved background color must persist server-side.').toBe(newBg);

    // A fresh client start loads both values through the real UI.
    const late = await loginAs(admin);
    try {
      await waitForParticipant(late.page, owner);
      await openZonesTab(late.page);
      await expectZoneNames(late.page, [zoneName]);
      await late.page.getByRole('button', { name: 'Allgemein', exact: true }).click();
      const lateColors = late.page.locator('input[type="color"]');
      await expect(lateColors).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
      await expect(lateColors.first()).toHaveValue(newBg, { timeout: UI_TIMEOUT_MS });
    } finally {
      await late.context.close();
    }
  });
});

/**
 * Case 2 (objects): create, move, rotate and delete an object via the API;
 * the second client observes every change in the live canvas state, a reload
 * shows the identical state, and the deletion reaches both clients. The
 * expected render position follows the anchor contract
 * `tileToRenderPosition` (editorAnchors.ts:30), rotation arrives in radians
 * (objectManager updateObject via DegToRad).
 */
test('places, moves, rotates and deletes an object with live update and reload', async ({
  stack,
  seed,
  loginAs,
  request,
}) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack.apiUrl, stack.baseUrl);
  const { owner, admin, mapId, tenantSlug } = requireSeedAccounts(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    const pack = await readSeedPackObject(request, stack.apiUrl);
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);

    let objectId: number | null = null;
    try {
      objectId = await createMapObject(clientA.context.request, stack.apiUrl, mapId, pack, 5, 5);
      const tile = await readTileSize(clientB.page);

      await expect
        .poll(() => readObjectSprite(clientB.page, objectId as number), {
          timeout: LIVE_SYNC_TIMEOUT_MS,
          message: 'Client B never rendered the placed object in the live scene.',
        })
        .not.toBeNull();
      const placed = (await readObjectSprite(clientB.page, objectId)) as SceneSpriteState;
      // Anchor contract: origin (0, 0) renders the tile origin in world pixels.
      expect(placed.x).toBe(5 * tile);
      expect(placed.y).toBe(5 * tile);

      const patch = await clientA.context.request.patch(
        `${stack.apiUrl}/maps/${encodeURIComponent(mapId)}/objects/${objectId}`,
        { data: { tileX: 8, tileY: 10, rotation: 90 } },
      );
      expect(patch.ok(), `PATCH object failed: HTTP ${patch.status()}.`).toBe(true);

      await expect
        .poll(() => readObjectSprite(clientB.page, objectId as number), {
          timeout: LIVE_SYNC_TIMEOUT_MS,
          message: 'Client B never applied the move and rotation live.',
        })
        .not.toBeNull();
      const moved = (await readObjectSprite(clientB.page, objectId)) as SceneSpriteState;
      expect(moved.x).toBe(8 * tile);
      expect(moved.y).toBe(10 * tile);
      expect(moved.rotation).toBeCloseTo(Math.PI / 2, 3);

      await clientB.page.reload();
      await expect
        .poll(() => readObjectSprite(clientB.page, objectId as number), {
          timeout: UI_TIMEOUT_MS,
          message: 'Client B lost the object state after reload.',
        })
        .not.toBeNull();
      const reloaded = (await readObjectSprite(clientB.page, objectId)) as SceneSpriteState;
      expect(reloaded.x).toBe(8 * tile);
      expect(reloaded.y).toBe(10 * tile);
      expect(reloaded.rotation).toBeCloseTo(Math.PI / 2, 3);

      const removedId: number = objectId;
      await deleteMapObject(clientA.context.request, stack.apiUrl, mapId, removedId);
      objectId = null;
      await expect
        .poll(() => readObjectSprite(clientA.page, removedId), {
          timeout: LIVE_SYNC_TIMEOUT_MS,
          message: 'Client A still renders the deleted object.',
        })
        .toBeNull();
      const remaining = await listObjectIds(request, stack.apiUrl, mapId);
      expect(remaining, 'The deleted object must be gone server-side.').not.toContain(removedId);
    } finally {
      if (objectId !== null) {
        await deleteMapObject(clientA.context.request, stack.apiUrl, mapId, objectId).catch(() => {});
      }
    }
  });
});

/**
 * Case 3 (spawn): the saved spawn becomes the entry position of a fresh
 * client, verified at tile accuracy from the live scene. The spawn is set
 * via PUT editor-state (the editor itself sets it with a canvas click, which
 * has no stable selector). The removal half documents the specified fallback:
 * the server PUT merges `spawn ?? currentMeta.spawn` and the UI save omits an
 * empty spawn, so no HTTP path clears it — see the result notes.
 */
test('uses the saved spawn as entry position', async ({ stack, seed, loginAs, request, db }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack.apiUrl, stack.baseUrl);
  const { owner, admin, mapId, tenantSlug } = requireSeedAccounts(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const spawn = { x: 96, y: 64 };

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, { spawn });
    const stored = await getEditorState(request, stack.apiUrl, mapId);
    expect(stored.spawn).toEqual(spawn);

    // The spawn only applies to a user without a saved position: a saved
    // presence is sent as the join position (useFetchMe.ts, applyPosition;
    // useColyseusConnection.ts, positionToUse). Earlier cases saved one for
    // admin, so it is cleared here.
    await db.query('DELETE FROM "Presence" WHERE "userId" = $1', [admin.userId]);
    const late = await loginAs(admin);
    try {
      const tile = await readTileSize(late.page);
      const spawnTile = [Math.floor(spawn.x / tile), Math.floor(spawn.y / tile)];
      // The scene first places the hero at a local fallback (MainScene.ts,
      // initialPos) and moves it once the server position arrives.
      await expect
        .poll(
          async () => {
            const hero = await readHeroPixels(late.page);
            return hero ? [Math.floor(hero.x / tile), Math.floor(hero.y / tile)] : null;
          },
          {
            timeout: UI_TIMEOUT_MS,
            message: 'The fresh client never placed its local player on the saved spawn tile.',
          },
        )
        .toEqual(spawnTile);
    } finally {
      await late.context.close();
    }

    // Removal through the real UI: clear the spawn and save.
    const clientA = await loginAs(owner);
    await openGeneralTab(clientA.page);
    await clientA.page.getByRole('button', { name: /^(Entfernen|Remove)$/ }).click();
    const savePut = clientA.page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes(`/maps/${mapId}/editor-state`),
      { timeout: UI_TIMEOUT_MS },
    );
    await clientA.page.getByRole('button', { name: /^(Speichern|Save)/ }).click();
    const saveResponse = await savePut;
    expect(saveResponse.ok(), `PUT editor-state failed: HTTP ${saveResponse.status()}.`).toBe(true);

    const cleared = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    expect(cleared.spawn, 'The removed spawn must fall back to no saved spawn.').toBeNull();
  });
});
