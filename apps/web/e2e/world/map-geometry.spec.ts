/**
 * Map geometry E2E: walls, floors, map bounds and large maps.
 *
 * The four cases use only real paths: owner and admin accounts from the real
 * seed, real browser clients via the loginAs fixture, real HTTP calls against
 * PATCH /maps/:id/paint-rect, GET /maps/:id/chunks, PATCH /maps/:id/resize and
 * GET /maps/:id/state-v2, plus real keyboard input (arrow keys). There are no
 * route mocks, no test hook injection and no invented users or tokens.
 *
 * Verified server contracts (derived from the routes, IDs not assumed):
 * - PATCH /maps/:id/paint-rect accepts { layer, rect, tileRefId?, values?,
 *   erase?, autotile? } with layer in editor_ground, editor_walls, collision,
 *   ground, walls, walls_auto (apps/server/src/api/routes/maps.paint.schema.ts:3-23,
 *   semantics :27-44) and is handled in maps.paint.ts:14. Painting walls also
 *   reconciles collision tiles (maps.paint.service.ts:110).
 * - GET /maps/:id/chunks?layer=&keys= answers { chunks } with base64 rows per
 *   key (apps/server/src/api/routes/maps.ts:18, maps.read.ts:191-251).
 * - PATCH /maps/:id/resize accepts width/height between 8 and 512
 *   (apps/server/src/api/routes/maps.editor.resize.ts:11-15), handled in :70.
 * - The move handler drops positions outside the map pixel bounds
 *   (apps/server/src/rooms/handlers/playerHandlers.ts:84, bounds :22-30).
 * - GET /maps/:id/state-v2 answers { mapMeta, tilesetRegistry,
 *   autotilePalette, layerIndex } with width/height in tiles
 *   (apps/server/src/api/routes/maps.read.ts:125-182).
 *
 * Verified scene access (read-only, no product change):
 * - The game instance is exposed as window.__PHASER_GAME__
 *   (apps/web/src/game/phaserGame.ts:51), the scene key is 'Main'
 *   (apps/web/src/game/scenes/MainScene.ts:103).
 * - The local hero is owned by the private player manager and read at runtime
 *   via scene.playerManager.getHero() (playerManager.ts:86); scene.hero
 *   (MainScene.ts:65) is never assigned, so it is only a fallback.
 * - Tilemap layers are public scene fields: editorGround, wallsLayer,
 *   collisionLayer (MainScene.ts:46-48). The client renders ground chunks into
 *   editorGround, walls into wallsLayer, collision with putTileAt(1) plus
 *   setCollision (apps/web/src/game/map/chunks.ts:165-211). Any nonzero tile
 *   reference renders a visible tile (apps/web/src/lib/mapV2.ts:208-213).
 * - Loaded chunk keys live in the public scene.loadedChunks set
 *   (MainScene.ts:52); collision reads collisionLayer.getTileAt
 *   (collisionManager.ts:64) with the manager created in MainScene.ts:185.
 * - Movement uses cursor keys (MainScene.ts:263, playerManager.ts:165-187);
 *   the hero collides with the physics world bounds set to the map size
 *   (sceneInitializer.ts:112, playerManager.ts:53). The camera follows the
 *   hero (MainScene.ts:182) and camera moves reload visible chunks
 *   (MainScene.ts:652-656).
 *
 * Run only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N
 * as well as origin localhost with the ports from MT_PORT_API/MT_PORT_WEB for
 * API and base URL (names and localhost form from the test stack script).
 * Without E2E_RUN, the file is safely skipped.
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { MeetropolisApi } from '../support/api';
import { getSeedTenant, passwordFor } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const LIVE_SYNC_TIMEOUT_MS = 20_000;
const SCENE_TIMEOUT_MS = 60_000;
const WALL_TILE_REF_ID = 7;
const FLOOR_TILE_REF_ID = 3;
const LARGE_MAP_TILES = 256;

type TileRect = { x0: number; y0: number; x1: number; y1: number };

type MapDims = { width: number; height: number; tileWidth: number; tileHeight: number; chunkSize: number };

type SceneTileRef = { layer: string; tx: number; ty: number };

type SceneSnapshot = {
  heroX: number | null;
  heroY: number | null;
  camX: number | null;
  camY: number | null;
  loadedChunkKeys: string[];
  present: boolean[];
};

type StackEnv = { apiUrl: string; baseUrl: string };

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
    if (numeric === 80 || numeric === 443) throw new Error(`${name} must not use a default fallback port.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name} port ${url.port} does not match ${portName}=${expectedPort}.`);
    }
  }
}

/** Fetches owner and admin from the real seed; both are created with a password per seed.setup.ts. */
function requireOwnerAndAdmin(seed: SeedData): {
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

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is not a number.`);
  return value;
}

async function getMapDims(request: APIRequestContext, apiUrl: string, mapId: string): Promise<MapDims> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/state-v2?t=${Date.now()}`);
  if (!response.ok()) throw new Error(`GET state-v2 failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.mapMeta)) throw new Error('GET state-v2 returned no mapMeta object.');
  return {
    width: asNumber(body.mapMeta.width, 'mapMeta.width'),
    height: asNumber(body.mapMeta.height, 'mapMeta.height'),
    tileWidth: asNumber(body.mapMeta.tileWidth, 'mapMeta.tileWidth'),
    tileHeight: asNumber(body.mapMeta.tileHeight, 'mapMeta.tileHeight'),
    chunkSize: typeof body.mapMeta.chunkSize === 'number' ? body.mapMeta.chunkSize : 32,
  };
}

async function patchPaintRect(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  payload: Record<string, unknown>,
): Promise<{ updates: unknown[] }> {
  const response = await request.patch(`${apiUrl}/maps/${encodeURIComponent(mapId)}/paint-rect`, {
    data: payload,
  });
  if (!response.ok()) {
    throw new Error(`PATCH paint-rect failed: HTTP ${response.status()} ${await response.text()}.`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.updates)) {
    throw new Error('PATCH paint-rect returned no updates array.');
  }
  return { updates: body.updates };
}

async function getChunks(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  layer: string,
  keys: string[],
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ layer, keys: keys.join(',') });
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/chunks?${params.toString()}`);
  if (!response.ok()) throw new Error(`GET chunks failed: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.chunks)) throw new Error('GET chunks returned no chunks object.');
  return body.chunks;
}

async function patchResize(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request.patch(`${apiUrl}/maps/${encodeURIComponent(mapId)}/resize`, {
    data: payload,
  });
  if (!response.ok()) {
    throw new Error(`PATCH resize failed: HTTP ${response.status()} ${await response.text()}.`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('PATCH resize returned no JSON object.');
  return body;
}

function chunkKeysForRect(rect: TileRect, chunkSize: number): string[] {
  const keys = new Set<string>();
  const cx0 = Math.floor(rect.x0 / chunkSize);
  const cx1 = Math.floor(rect.x1 / chunkSize);
  const cy0 = Math.floor(rect.y0 / chunkSize);
  const cy1 = Math.floor(rect.y1 / chunkSize);
  for (let cx = cx0; cx <= cx1; cx += 1) {
    for (let cy = cy0; cy <= cy1; cy += 1) {
      keys.add(`${cx}:${cy}`);
    }
  }
  return [...keys];
}

function tilesForRect(layer: string, rect: TileRect): SceneTileRef[] {
  const tiles: SceneTileRef[] = [];
  for (let ty = rect.y0; ty <= rect.y1; ty += 1) {
    for (let tx = rect.x0; tx <= rect.x1; tx += 1) {
      tiles.push({ layer, tx, ty });
    }
  }
  return tiles;
}

/** Reads hero position, camera scroll and tile presence from the live scene in one round trip. */
async function sceneSnapshot(page: Page, tiles: SceneTileRef[]): Promise<SceneSnapshot> {
  const raw: unknown = await page.evaluate((wanted: SceneTileRef[]) => {
    const holder = window as unknown as Record<string, unknown>;
    const game = holder.__PHASER_GAME__ as { scene: { getScene: (key: string) => unknown } } | undefined;
    const scene = game?.scene.getScene('Main') as Record<string, unknown> | undefined;
    const manager = scene?.playerManager as { getHero?: () => unknown } | undefined;
    const hero = (manager?.getHero?.() ?? scene?.hero) as { x?: unknown; y?: unknown } | undefined;
    const loaded = scene?.loadedChunks as { forEach?: (callback: (value: unknown) => void) => void } | undefined;
    const keys: string[] = [];
    try {
      loaded?.forEach?.((value: unknown) => {
        if (typeof value === 'string') keys.push(value);
      });
    } catch {
      /* ignore */
    }
    const cameras = scene?.cameras as { main?: { scrollX?: unknown; scrollY?: unknown } } | undefined;
    const present = wanted.map((tile) => {
      try {
        const layer = scene?.[tile.layer] as { getTileAt?: (tx: number, ty: number) => unknown } | undefined;
        const found = layer?.getTileAt?.(tile.tx, tile.ty) as { index?: unknown } | null | undefined;
        return !!found && found.index !== -1;
      } catch {
        return false;
      }
    });
    return {
      heroX: typeof hero?.x === 'number' ? hero.x : null,
      heroY: typeof hero?.y === 'number' ? hero.y : null,
      camX: typeof cameras?.main?.scrollX === 'number' ? cameras.main.scrollX : null,
      camY: typeof cameras?.main?.scrollY === 'number' ? cameras.main.scrollY : null,
      loadedChunkKeys: keys,
      present,
    };
  }, tiles);
  if (!isRecord(raw)) throw new Error('The scene snapshot did not return a JSON object.');
  const heroX = typeof raw.heroX === 'number' ? raw.heroX : null;
  const heroY = typeof raw.heroY === 'number' ? raw.heroY : null;
  const camX = typeof raw.camX === 'number' ? raw.camX : null;
  const camY = typeof raw.camY === 'number' ? raw.camY : null;
  const loadedChunkKeys = Array.isArray(raw.loadedChunkKeys)
    ? raw.loadedChunkKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const present = Array.isArray(raw.present) ? raw.present.map((entry) => entry === true) : [];
  return { heroX, heroY, camX, camY, loadedChunkKeys, present };
}

async function waitForScene(page: Page): Promise<SceneSnapshot> {
  let latest: SceneSnapshot = { heroX: null, heroY: null, camX: null, camY: null, loadedChunkKeys: [], present: [] };
  await expect
    .poll(
      async () => {
        latest = await sceneSnapshot(page, []);
        return latest.heroX !== null && latest.loadedChunkKeys.length > 0 ? 'ready' : 'waiting';
      },
      { timeout: SCENE_TIMEOUT_MS, message: 'The game scene never became interactive (no hero, no chunks).' },
    )
    .toBe('ready');
  return latest;
}

/**
 * Finds the first fully empty tile rect of the given size around a start tile.
 * Only rects inside the map are considered; every candidate tile is read from
 * the given scene layers. Returns null when no empty rect fits.
 */
async function findEmptyRect(
  page: Page,
  args: {
    layers: string[];
    width: number;
    height: number;
    startTx: number;
    startTy: number;
    maxRadius: number;
    mapTilesX: number;
    mapTilesY: number;
  },
): Promise<TileRect | null> {
  const raw: unknown = await page.evaluate(
    (options: {
      layers: string[];
      width: number;
      height: number;
      startTx: number;
      startTy: number;
      maxRadius: number;
      mapTilesX: number;
      mapTilesY: number;
    }) => {
      const holder = window as unknown as Record<string, unknown>;
      const game = holder.__PHASER_GAME__ as { scene: { getScene: (key: string) => unknown } } | undefined;
      const scene = game?.scene.getScene('Main') as Record<string, unknown> | undefined;
      const isEmpty = (tx: number, ty: number): boolean => {
        for (const layerName of options.layers) {
          try {
            const layer = scene?.[layerName] as { getTileAt?: (x: number, y: number) => unknown } | undefined;
            const found = layer?.getTileAt?.(tx, ty) as { index?: unknown } | null | undefined;
            if (found && found.index !== -1) return false;
          } catch {
            return false;
          }
        }
        return true;
      };
      for (let radius = 0; radius <= options.maxRadius; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const x0 = options.startTx + dx;
            const y0 = options.startTy + dy;
            const x1 = x0 + options.width - 1;
            const y1 = y0 + options.height - 1;
            if (x0 < 0 || y0 < 0 || x1 >= options.mapTilesX || y1 >= options.mapTilesY) continue;
            let empty = true;
            for (let ty = y0; ty <= y1 && empty; ty += 1) {
              for (let tx = x0; tx <= x1 && empty; tx += 1) {
                if (!isEmpty(tx, ty)) empty = false;
              }
            }
            if (empty) return { x0, y0, x1, y1 };
          }
        }
      }
      return null;
    },
    { ...args },
  );
  if (raw === null) return null;
  if (!isRecord(raw)) throw new Error('The empty-rect probe did not return a rect.');
  const rect = {
    x0: asNumber(raw.x0, 'rect.x0'),
    y0: asNumber(raw.y0, 'rect.y0'),
    x1: asNumber(raw.x1, 'rect.x1'),
    y1: asNumber(raw.y1, 'rect.y1'),
  };
  return rect;
}

async function holdKey(page: Page, key: 'ArrowRight' | 'ArrowLeft' | 'ArrowUp', ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/**
 * Case for matrix row 3 (walls) and row 8 (collision): a painted wall rect is
 * visible to a fresh client and blocks keyboard movement, while the opposite
 * direction still moves.
 */
test('painted wall persists and blocks movement', async ({ stack, seed, loginAs, request }, testInfo) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const dims = await getMapDims(request, stack.apiUrl, mapId);

  const clientA = await loginAs(owner);
  try {
    const first = await waitForScene(clientA.page);
    if (first.heroX === null || first.heroY === null) throw new Error('The hero has no position after scene start.');
    const startTx = Math.floor(first.heroX / dims.tileWidth);
    const startTy = Math.floor(first.heroY / dims.tileHeight);
    const rect = await findEmptyRect(clientA.page, {
      layers: ['wallsLayer', 'collisionLayer'],
      width: 2,
      height: 3,
      startTx: startTx + 2,
      startTy: startTy - 1,
      maxRadius: 10,
      mapTilesX: dims.width,
      mapTilesY: dims.height,
    });
    if (!rect) {
      throw new Error('No empty 2x3 wall area near the hero: the test refuses to overwrite seed tiles.');
    }
    const keys = chunkKeysForRect(rect, dims.chunkSize);

    const beforeWalls = await getChunks(request, stack.apiUrl, mapId, 'walls', keys);
    const beforeCollision = await getChunks(request, stack.apiUrl, mapId, 'collision', keys);
    await testInfo.attach('secured-chunks-before', {
      body: JSON.stringify({ layer: 'walls+collision', keys, beforeWalls, beforeCollision }, null, 2),
      contentType: 'application/json',
    });

    const painted = await patchPaintRect(request, stack.apiUrl, mapId, {
      layer: 'walls',
      rect,
      tileRefId: WALL_TILE_REF_ID,
    });
    expect(painted.updates.length, 'The paint call must store wall chunks.').toBeGreaterThan(0);
    const stored = await getChunks(request, stack.apiUrl, mapId, 'walls', keys);
    expect(Object.keys(stored).length, 'The wall chunks must be readable back from the server.').toBeGreaterThan(0);

    await clientA.page.reload();
    const reloaded = await waitForScene(clientA.page);
    if (reloaded.heroX === null || reloaded.heroY === null) {
      throw new Error('The hero has no position after reload.');
    }
    const clientB = await loginAs(admin);
    try {
      await waitForScene(clientB.page);
      const seen = await sceneSnapshot(clientB.page, [
        ...tilesForRect('wallsLayer', rect),
        ...tilesForRect('collisionLayer', rect),
      ]);
      const wallTiles = seen.present.slice(0, (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1));
      const collisionTiles = seen.present.slice(wallTiles.length);
      expect(wallTiles.every(Boolean), 'A fresh client must see every painted wall tile.').toBe(true);
      expect(collisionTiles.every(Boolean), 'Painted walls must reconcile into collision tiles.').toBe(true);

      const wallLeftPx = rect.x0 * dims.tileWidth;
      const before = { x: reloaded.heroX, y: reloaded.heroY };
      await holdKey(clientA.page, 'ArrowRight', 900);
      const blocked = await sceneSnapshot(clientA.page, []);
      if (blocked.heroX === null) throw new Error('The hero position was lost while pushing against the wall.');
      expect(blocked.heroX, 'Pushing against the wall must move the hero towards it.').toBeGreaterThan(before.x + 8);
      expect(blocked.heroX, 'The hero must not cross the painted wall.').toBeLessThan(wallLeftPx - 2);
      await holdKey(clientA.page, 'ArrowLeft', 700);
      const freed = await sceneSnapshot(clientA.page, []);
      if (freed.heroX === null) throw new Error('The hero position was lost while moving away from the wall.');
      expect(freed.heroX, 'Moving away from the wall must still work.').toBeLessThan(blocked.heroX - 8);
    } finally {
      await clientB.context.close();
    }

    const erased = await patchPaintRect(request, stack.apiUrl, mapId, { layer: 'walls', rect, erase: true });
    expect(erased.updates.length, 'Erasing the wall must touch chunks.').toBeGreaterThan(0);
    const cleared = await getChunks(request, stack.apiUrl, mapId, 'walls', keys);
    expect(Object.keys(cleared).length, 'The wall rect must be empty again after cleanup.').toBe(0);
  } finally {
    await clientA.context.close();
  }
});

/** Case for matrix row 3 (floors): a painted floor tile survives a full reload. */
test('floor paint persists across reload', async ({ stack, seed, loginAs, request }, testInfo) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const dims = await getMapDims(request, stack.apiUrl, mapId);

  const client = await loginAs(owner);
  try {
    const first = await waitForScene(client.page);
    if (first.heroX === null || first.heroY === null) throw new Error('The hero has no position after scene start.');
    const rect = await findEmptyRect(client.page, {
      layers: ['editorGround'],
      width: 2,
      height: 2,
      startTx: Math.floor(first.heroX / dims.tileWidth),
      startTy: Math.floor(first.heroY / dims.tileHeight),
      maxRadius: 12,
      mapTilesX: dims.width,
      mapTilesY: dims.height,
    });
    if (!rect) {
      throw new Error('No empty 2x2 floor area near the hero: the test refuses to overwrite seed tiles.');
    }
    const keys = chunkKeysForRect(rect, dims.chunkSize);
    const before = await getChunks(request, stack.apiUrl, mapId, 'ground', keys);
    await testInfo.attach('secured-chunks-before', {
      body: JSON.stringify({ layer: 'ground', keys, before }, null, 2),
      contentType: 'application/json',
    });

    const painted = await patchPaintRect(request, stack.apiUrl, mapId, {
      layer: 'ground',
      rect,
      tileRefId: FLOOR_TILE_REF_ID,
    });
    expect(painted.updates.length, 'The paint call must store ground chunks.').toBeGreaterThan(0);

    await client.page.reload();
    await waitForScene(client.page);
    const seen = await sceneSnapshot(client.page, tilesForRect('editorGround', rect));
    expect(
      seen.present.every(Boolean),
      'Every painted floor tile must still be in the ground layer after reload.',
    ).toBe(true);
    const stored = await getChunks(request, stack.apiUrl, mapId, 'ground', keys);
    expect(Object.keys(stored).length, 'The ground chunks must be readable back from the server.').toBeGreaterThan(0);

    await patchPaintRect(request, stack.apiUrl, mapId, { layer: 'ground', rect, erase: true });
    const cleared = await getChunks(request, stack.apiUrl, mapId, 'ground', keys);
    expect(Object.keys(cleared).length, 'The floor rect must be empty again after cleanup.').toBe(0);
  } finally {
    await client.context.close();
  }
});

/**
 * Case for matrix row 8 (bounds): walking into the map edge keeps the hero
 * inside the map pixel bounds reported by state-v2.
 */
test('out-of-bounds move is not applied', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const dims = await getMapDims(request, stack.apiUrl, mapId);
  const widthPx = dims.width * dims.tileWidth;
  const heightPx = dims.height * dims.tileHeight;

  const client = await loginAs(owner);
  try {
    const first = await waitForScene(client.page);
    if (first.heroX === null || first.heroY === null) throw new Error('The hero has no position after scene start.');
    const heroTx = Math.floor(first.heroX / dims.tileWidth);
    const heroTy = Math.floor(first.heroY / dims.tileHeight);

    const rowTiles: SceneTileRef[] = [];
    for (let tx = 0; tx < dims.width; tx += 1) {
      rowTiles.push({ layer: 'collisionLayer', tx, ty: heroTy });
    }
    const row = await sceneSnapshot(client.page, rowTiles);
    const blockedAt = (tx: number): boolean => row.present[tx] === true;
    let rightClear = 0;
    for (let tx = heroTx + 1; tx < dims.width && !blockedAt(tx); tx += 1) rightClear += 1;
    let leftClear = 0;
    for (let tx = heroTx - 1; tx >= 0 && !blockedAt(tx); tx -= 1) leftClear += 1;
    const direction: 'ArrowRight' | 'ArrowLeft' | null =
      rightClear >= 3 ? 'ArrowRight' : leftClear >= 3 ? 'ArrowLeft' : null;
    if (!direction) {
      throw new Error('No clear corridor of 3 tiles to either map edge: the test refuses a blocked walk.');
    }

    const startX = first.heroX;
    await client.page.keyboard.down(direction);
    try {
      const samples: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        const snap = await sceneSnapshot(client.page, []);
        if (snap.heroX === null || snap.heroY === null) throw new Error('The hero position was lost while walking.');
        expect(snap.heroX, 'The hero must stay inside the map width.').toBeGreaterThanOrEqual(0);
        expect(snap.heroX, 'The hero must stay inside the map width.').toBeLessThanOrEqual(widthPx);
        expect(snap.heroY, 'The hero must stay inside the map height.').toBeGreaterThanOrEqual(0);
        expect(snap.heroY, 'The hero must stay inside the map height.').toBeLessThanOrEqual(heightPx);
        samples.push(snap.heroX);
        const count = samples.length;
        const moved = Math.abs(samples[count - 1] - startX);
        const stalled = count >= 3 && Math.abs(samples[count - 1] - samples[count - 3]) < 1;
        if (moved > dims.tileWidth && stalled) break;
        await client.page.waitForTimeout(500);
      }
      const count = samples.length;
      expect(Math.abs(samples[count - 1] - startX), 'The hero must have walked before stalling.').toBeGreaterThan(
        dims.tileWidth,
      );
      expect(
        Math.abs(samples[count - 1] - samples[count - 3]),
        'The hero must stall at the map edge instead of leaving it.',
      ).toBeLessThan(1);
    } finally {
      await client.page.keyboard.up(direction);
    }
  } finally {
    await client.context.close();
  }
});

/**
 * Case for matrix row 12 (large maps): a resized large map loads an
 * interactive scene and streams more chunks while the hero moves. No timing
 * budget is asserted; the measured load time is reported as an annotation and
 * the hard expectation is only that loading and streaming work without errors.
 */
test('large map loads and streams chunks', async ({ stack, seed, loginAs, request }, testInfo) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const dims = await getMapDims(request, stack.apiUrl, mapId);

  const target = dims.width >= LARGE_MAP_TILES && dims.height >= LARGE_MAP_TILES ? 128 : LARGE_MAP_TILES;
  const resized = await patchResize(request, stack.apiUrl, mapId, { width: target, height: target });
  expect(resized.newWidth, 'The map must accept the large size.').toBe(target);
  try {
    const pageErrors: string[] = [];
    const client = await loginAs(owner);
    try {
      client.page.on('pageerror', (error) => {
        pageErrors.push(error instanceof Error ? error.message : String(error));
      });
      const startedAt = Date.now();
      const first = await waitForScene(client.page);
      const readyMs = Date.now() - startedAt;
      testInfo.annotations.push({ type: 'large-map-ready-ms', description: String(readyMs) });
      const initialCount = first.loadedChunkKeys.length;
      testInfo.annotations.push({ type: 'large-map-chunks-initial', description: String(initialCount) });
      if (first.heroX === null || first.heroY === null) throw new Error('The hero has no position on the large map.');

      const heroTx = Math.floor(first.heroX / dims.tileWidth);
      const heroTy = Math.floor(first.heroY / dims.tileHeight);
      const rowTiles: SceneTileRef[] = [];
      for (let tx = 0; tx < target; tx += 1) {
        rowTiles.push({ layer: 'collisionLayer', tx, ty: heroTy });
      }
      const row = await sceneSnapshot(client.page, rowTiles);
      let rightClear = 0;
      for (let tx = heroTx + 1; tx < target && row.present[tx] !== true; tx += 1) rightClear += 1;
      let leftClear = 0;
      for (let tx = heroTx - 1; tx >= 0 && row.present[tx] !== true; tx -= 1) leftClear += 1;
      const direction: 'ArrowRight' | 'ArrowLeft' | null =
        rightClear >= 6 ? 'ArrowRight' : leftClear >= 6 ? 'ArrowLeft' : null;
      if (!direction) {
        throw new Error('No clear corridor of 6 tiles on the large map: the test refuses a blocked walk.');
      }

      await client.page.keyboard.down(direction);
      try {
        await expect
          .poll(
            async () => {
              const snap = await sceneSnapshot(client.page, []);
              if (snap.heroX === null) return 'waiting';
              return Math.abs(snap.heroX - (first.heroX as number)) > dims.tileWidth * 4 ? 'moved' : 'waiting';
            },
            { timeout: LIVE_SYNC_TIMEOUT_MS, message: 'The hero never walked on the large map.' },
          )
          .toBe('moved');
      } finally {
        await client.page.keyboard.up(direction);
      }
      const after = await sceneSnapshot(client.page, []);
      const beforeKeys = new Set(first.loadedChunkKeys);
      const newKeys = after.loadedChunkKeys.filter((key) => !beforeKeys.has(key));
      const afterCount = after.loadedChunkKeys.length;
      testInfo.annotations.push({ type: 'large-map-chunks-after-move', description: String(afterCount) });
      testInfo.annotations.push({ type: 'large-map-chunks-new', description: newKeys.join(',') });
      expect(after.loadedChunkKeys.length, 'Chunks must stay loaded while moving.').toBeGreaterThan(0);
      expect(newKeys.length, 'Moving the hero must stream additional chunks.').toBeGreaterThan(0);
      expect(pageErrors, `The large map must load without page errors: ${pageErrors.join('; ')}`).toEqual([]);
    } finally {
      await client.context.close();
    }
  } finally {
    const restored = await patchResize(request, stack.apiUrl, mapId, { width: dims.width, height: dims.height });
    expect(restored.newWidth, 'The map size must be restored after the test.').toBe(dims.width);
  }
});
