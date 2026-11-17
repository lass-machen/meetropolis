/**
 * Two-client E2E for the open finding (zone synchronization).
 *
 * The three cases use only real paths: authenticated owner-
 * and admin accounts from the real seed, real browser clients via the
 * loginAs fixture, real PUT/GET calls against /maps/:id/editor-state and real
 * UI controls of the editor. There are no route mocks, no
 * test hook injection and no invented users or tokens.
 *
 * Verified selectors (all from the product code, not invented):
 * - menu button with aria-label „Menü“/„Menu“
 *   (apps/web/src/ui/app/TopRightMenu.tsx:427, locales de/en common.json:5).
 * - menu item „Map-Editor öffnen“/„Open map editor“
 *   (TopRightMenu.tsx:310-316, common.json:10).
 * - Editorfenster „Map-Editor“ (apps/web/src/features/editor/EditorWindow.tsx:206)
 *   with hard-coded tabs „Allgemein“ and „Zonen“ (EditorWindow.tsx:106-114).
 * - zone list „Zonen-Verwaltung“/„Zone management“ with inputs
 *   `input[id^="zone-name-"]` (apps/web/src/ui/editor/ZoneEditor.tsx:31,217)
 *   and empty state „Noch keine Zonen …“/„No zones yet …“ (ZoneEditor.tsx:313).
 * - background color picker on the General tab
 *   (apps/web/src/ui/editor/EditorPanel.tsx:172-188) and footer save
 *   „Speichern“/„Save“ (ui/editor/EditorPanel.tsx:428-447). The Save button
 *   calls via
 *   EditorWindow → WorldShell (WorldShell.tsx:209) calls saveAllToServerImpl, which
 *   sends PUT /maps/:id/editor-state with replaceZones:true
 *   (apps/web/src/app/routes/WorldApp.tsx:313-351).
 *
 * Verified API contracts (derived from the routes, IDs not assumed):
 * - GET /maps/:id/editor-state returns { zones: [{ name, polygon, … }],
 *   backgroundColor, spawn } (apps/server/src/api/routes/maps.editor.zones.ts:34-72).
 * - PUT /maps/:id/editor-state akzeptiert { zones, replaceZones, backgroundColor }
 *   (maps.editor.zones.ts:74-83) and replaces on zones:[] or
 *   replaceZones:true replaces the entire zone state (maps.editor.zones.ts:116-148).
 *
 * Run only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N
 * as well as origin localhost with the ports from MT_PORT_API/MT_PORT_WEB for API and
 * base URL (names and localhost form from the test stack script). Without
 * E2E_RUN, the file is safely skipped; for the three cases there is no
 * weiteren Skips.
 */
import { randomUUID } from 'node:crypto';

import type { APIRequestContext, BrowserContext, Page, Response as PageResponse } from '@playwright/test';

import { expect, test } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { MeetropolisApi } from '../support/api';
import { getSeedTenant, passwordFor, waitForParticipant } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const LIVE_SYNC_TIMEOUT_MS = 20_000;
const UI_TIMEOUT_MS = 30_000;

type ZonePoint = { x: number; y: number };

type BaselineZone = {
  name: string;
  capacity: number | null;
  polygon: ZonePoint[];
  type: string | null;
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
};

type Baseline = { zones: BaselineZone[]; backgroundColor: string | null };

type ClientSession = { user: TestUser; context: BrowserContext; page: Page };

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
  // Port names and localhost form come from the test stack script.
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
    if (numeric === 80 || numeric === 443) throw new Error(`${name} darf keinen Standard-Fallback-Port nutzen.`);
    if (url.port !== expectedPort) {
      throw new Error(`${name}-Port ${url.port} does not match ${portName}=${expectedPort}.`);
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

function uniqueZoneName(tag: string): string {
  return `qwe7-${tag}-${randomUUID().slice(0, 8)}`;
}

function asPoints(value: unknown): ZonePoint[] {
  if (!Array.isArray(value)) return [];
  const points: ZonePoint[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      points.push({ x: entry[0], y: entry[1] });
    } else if (isRecord(entry) && typeof entry.x === 'number' && typeof entry.y === 'number') {
      points.push({ x: entry.x, y: entry.y });
    }
  }
  return points;
}

/** Reads geometry from the modern (points) and legacy (polygon / polygon.points) shape. */
function zonePoints(zone: Record<string, unknown>): ZonePoint[] {
  const direct = asPoints(zone.points ?? zone.polygon);
  if (direct.length > 0) return direct;
  return asPoints(isRecord(zone.polygon) ? zone.polygon.points : undefined);
}

function zoneNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.zones)) return [];
  return body.zones.filter(isRecord).map((zone) => (typeof zone.name === 'string' ? zone.name : ''));
}

/**
 * Builds a data-minimal snapshot: only zone names, geometry and
 * background. No IDs, no customer data, no auth traces.
 */
function snapshotState(state: Record<string, unknown>): {
  zones: Array<{ name: string; geometry: ZonePoint[] }>;
  backgroundColor: string | null;
} {
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones: zones.map((zone) => ({
      name: typeof zone.name === 'string' ? zone.name : '',
      geometry: zonePoints(zone),
    })),
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
  };
}

async function getEditorState(
  request: APIRequestContext,
  apiUrl: string,
  mapId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${apiUrl}/maps/${encodeURIComponent(mapId)}/editor-state?t=${Date.now()}`);
  if (!response.ok()) throw new Error(`GET editor-state scheiterte: HTTP ${response.status()}.`);
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
    throw new Error(`PUT editor-state scheiterte: HTTP ${response.status()} ${await response.text()}.`);
  }
}

/** Remembers zones and background of the seed map for restoration in finally. */
async function readBaseline(request: APIRequestContext, apiUrl: string, mapId: string): Promise<Baseline> {
  const state = await getEditorState(request, apiUrl, mapId);
  const zones = Array.isArray(state.zones) ? state.zones.filter(isRecord) : [];
  return {
    zones: zones.map((zone) => ({
      name: typeof zone.name === 'string' ? zone.name : 'Zone',
      capacity: typeof zone.capacity === 'number' ? zone.capacity : null,
      polygon: zonePoints(zone),
      type: typeof zone.type === 'string' ? zone.type : null,
      portalTarget: typeof zone.portalTarget === 'string' ? zone.portalTarget : null,
      portalSpawnX: typeof zone.portalSpawnX === 'number' ? zone.portalSpawnX : null,
      portalSpawnY: typeof zone.portalSpawnY === 'number' ? zone.portalSpawnY : null,
    })),
    backgroundColor: typeof state.backgroundColor === 'string' ? state.backgroundColor : null,
  };
}

/** Restores only the own initial state; errors remain visible. */
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
    });
    return [];
  } catch (error) {
    return [`Wiederherstellung scheiterte: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/**
 * Runs the test body and then restores the initial state.
 * Errors from body and cleanup are combined, never swallowed.
 */
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
    if (restoreErrors.length > 0) {
      throw new Error(`${bodyError.message} | Cleanup: ${restoreErrors.join('; ')}`);
    }
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

/** Checks the visible zone names of the editor list in order. */
async function expectZoneListNames(page: Page, names: string[]): Promise<void> {
  const inputs = page.locator('input[id^="zone-name-"]');
  await expect(inputs).toHaveCount(names.length, { timeout: UI_TIMEOUT_MS });
  for (const [index, name] of names.entries()) {
    await expect(page.locator(`#zone-name-${index}`)).toHaveValue(name, { timeout: UI_TIMEOUT_MS });
  }
}

async function expectZoneListEmpty(page: Page): Promise<void> {
  await expect(page.locator('input[id^="zone-name-"]')).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
  await expect(page.getByText(/Noch keine Zonen|No zones yet/)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/**
 * Case 1 (live update): B saves a new zone state
 * via its authenticated request context while A stays open. The
 * Test listens on page A for real GET editor-state responses and requires,
 * that at least one contains the B state and the visible editor list the
 * takes over the new name. An assertion about pixel-exact overlay or
 * AV effect is deliberately not asserted.
 */
test('Case 1: open zone list picks up the foreign zone state live', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const nameB = uniqueZoneName('b');
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];
  const rectB: ZonePoint[] = [
    { x: 48, y: 48 },
    { x: 80, y: 48 },
    { x: 80, y: 80 },
    { x: 48, y: 80 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Mutual presence proves two real clients in the same room;
    // the unique zone names additionally verify the shared seed map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);

    const seenBodies: unknown[] = [];
    const onResponse = (response: PageResponse): void => {
      if (response.request().method() !== 'GET') return;
      if (!response.url().includes(`/maps/${mapId}/editor-state`)) return;
      void response
        .json()
        .then((body: unknown) => {
          seenBodies.push(body);
        })
        .catch(() => {});
    };
    clientA.page.on('response', onResponse);
    try {
      // B saves the new state via its authenticated context (no canvas intervention).
      await putEditorState(clientB.context.request, stack.apiUrl, mapId, {
        zones: [{ name: nameB, points: rectB }],
        replaceZones: true,
      });
      await expect
        .poll(() => seenBodies.some((body) => zoneNames(body).includes(nameB)), {
          timeout: LIVE_SYNC_TIMEOUT_MS,
          message: 'Case 1: page A never reloaded the B state via GET editor-state (no live update).',
        })
        .toBe(true);
    } finally {
      clientA.page.off('response', onResponse);
    }
    await expectZoneListNames(clientA.page, [nameB]);
  });
});

/**
 * Case 2 (overwrite protection): A stays on the initial state A
 * open throughout. B saves state B; A verifies the saved B state
 * afterwards via a fresh GET through its own authenticated context
 * (name and geometry exact), without reloading the editor. Only afterwards
 * A changes only the background color via the real color input and clicks
 * Save. The final fresh GET must contain B names and B geometry as well as
 * the new background color. Both snapshots are kept as
 * test artifacts, the last one before the assertions.
 */
test('Case 2: background save keeps the foreign zone state', async ({ stack, seed, loginAs, request }, testInfo) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const nameB = uniqueZoneName('b');
  const rectB: ZonePoint[] = [
    { x: 48, y: 48 },
    { x: 80, y: 48 },
    { x: 80, y: 80 },
    { x: 48, y: 80 },
  ];
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Mutual presence proves two real clients in the same room;
    // the unique zone names additionally verify the shared seed map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);

    // B saves the new state via its authenticated context.
    await putEditorState(clientB.context.request, stack.apiUrl, mapId, {
      zones: [{ name: nameB, points: rectB }],
      replaceZones: true,
    });

    // A stays open and verifies the stored B state via a fresh GET.
    const stored = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    const storedZones = Array.isArray(stored.zones) ? stored.zones.filter(isRecord) : [];
    const storedB = storedZones.find((zone) => zone.name === nameB);
    expect(storedB, 'The server must have stored the B state.').toBeTruthy();
    expect(storedB ? zonePoints(storedB) : [], 'The stored B state must carry the B geometry.').toEqual(rectB);
    await testInfo.attach('gespeicherter-b-stand', {
      body: JSON.stringify(snapshotState(stored), null, 2),
      contentType: 'application/json',
    });

    // A changes only the background color via the real color input.
    const currentBg = typeof stored.backgroundColor === 'string' ? stored.backgroundColor : null;
    const newBg = currentBg?.toLowerCase() === '#334455' ? '#445566' : '#334455';
    await clientA.page.getByRole('button', { name: 'Allgemein', exact: true }).click();
    const colorInputs = clientA.page.locator('input[type="color"]');
    await expect(colorInputs).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
    await colorInputs.first().fill(newBg);
    await expect(clientA.page.getByText(newBg, { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });

    // A saves via the real footer button and waits for the real PUT response.
    const savePut = clientA.page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes(`/maps/${mapId}/editor-state`),
      { timeout: UI_TIMEOUT_MS },
    );
    await clientA.page.getByRole('button', { name: /^(Speichern|Save)/ }).click();
    const saveResponse = await savePut;
    expect(saveResponse.ok(), `PUT editor-state scheiterte: HTTP ${saveResponse.status()}.`).toBe(true);

    const fresh = await getEditorState(clientA.context.request, stack.apiUrl, mapId);
    await testInfo.attach('beweisschnappschuss', {
      body: JSON.stringify(snapshotState(fresh), null, 2),
      contentType: 'application/json',
    });
    const freshZones = Array.isArray(fresh.zones) ? fresh.zones.filter(isRecord) : [];
    const kept = freshZones.find((zone) => zone.name === nameB);
    expect(kept, "The B state must be preserved after A's background save.").toBeTruthy();
    expect(kept ? zonePoints(kept) : [], 'The B geometry must remain unchanged.').toEqual(rectB);
    expect(fresh.backgroundColor, 'The new background color must be saved.').toBe(newBg);
  });
});

/**
 * Case 3 (delete last zone live): B replaces the state with
 * zones:[]. The fresh server GET must be empty, and the visible
 * zone lists of both continuously open clients must be empty afterwards.
 * No reload and no other remount replaces the
 * live synchronization. Pixel or AV effect is not claimed.
 */
test('Case 3: emptied zone list reaches both open clients live', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const nameA = uniqueZoneName('a');
  const rectA: ZonePoint[] = [
    { x: 16, y: 16 },
    { x: 48, y: 16 },
    { x: 48, y: 48 },
    { x: 16, y: 48 },
  ];

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    await putEditorState(request, stack.apiUrl, mapId, {
      zones: [{ name: nameA, points: rectA }],
      replaceZones: true,
    });
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    // Mutual presence proves two real clients in the same room;
    // the unique zone names additionally verify the shared seed map.
    await waitForParticipant(clientA.page, clientB.user);
    await waitForParticipant(clientB.page, clientA.user);
    await openZonesTab(clientA.page);
    await openZonesTab(clientB.page);
    await expectZoneListNames(clientA.page, [nameA]);
    await expectZoneListNames(clientB.page, [nameA]);
    await putEditorState(clientB.context.request, stack.apiUrl, mapId, { zones: [] });

    const fresh = await getEditorState(request, stack.apiUrl, mapId);
    const freshZones = Array.isArray(fresh.zones) ? fresh.zones : [];
    expect(freshZones, 'The server must return no zones after zones:[].').toHaveLength(0);

    // Both clients stay open: the live deletion must empty their visible lists.
    await expectZoneListEmpty(clientA.page);
    await expectZoneListEmpty(clientB.page);
  });
});

type ArrowKey = 'ArrowRight' | 'ArrowDown' | 'ArrowLeft' | 'ArrowUp';

type ScenePose = {
  x: number;
  y: number;
  tile: number;
  mapName: string;
  direction: 'up' | 'down' | 'left' | 'right';
  remotes: Array<{ x: number; y: number }>;
};

const ARROW_KEYS: ArrowKey[] = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];

/**
 * Reads the live Main scene through window.__PHASER_GAME__
 * (apps/web/src/game/phaserGame.ts:51). Scene key is 'Main'
 * (apps/web/src/game/scenes/MainScene.ts:103). The hero is
 * playerManager.getHero() (MainScene.ts:35, playerManager.ts:86); remote
 * sprites come from remotePlayersManager.getAllRemotes()
 * (remotePlayersManager.ts:245) after updateRemotePlayer
 * (apps/web/src/game/bridge.ts:217, playerHandlers.ts:214). Tile size is
 * mapRef.tileWidth (MainScene.ts:45), otherwise 16 (MainScene.ts:123).
 */
async function readScenePose(page: Page): Promise<ScenePose | null> {
  return page.evaluate(() => {
    const isObj = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const game = window.__PHASER_GAME__;
    if (!isObj(game) || !isObj(game.scene) || typeof game.scene.getScene !== 'function') return null;
    const scene: unknown = (game.scene.getScene as (key: string) => unknown)('Main');
    if (!isObj(scene)) return null;
    const mapRef = isObj(scene.mapRef) ? scene.mapRef : null;
    const tile = mapRef && typeof mapRef.tileWidth === 'number' && mapRef.tileWidth > 0 ? mapRef.tileWidth : 16;
    const mapName = typeof scene.currentMapName === 'string' ? scene.currentMapName : '';
    const playerManager = isObj(scene.playerManager) ? scene.playerManager : null;
    if (!playerManager || typeof playerManager.getHero !== 'function') return null;
    const hero: unknown = (playerManager.getHero as () => unknown)();
    if (!isObj(hero) || typeof hero.x !== 'number' || typeof hero.y !== 'number') return null;
    let direction: 'up' | 'down' | 'left' | 'right' = 'down';
    if (typeof playerManager.getCurrentDirection === 'function') {
      const rawDirection: unknown = (playerManager.getCurrentDirection as () => unknown)();
      if (rawDirection === 'up' || rawDirection === 'down' || rawDirection === 'left' || rawDirection === 'right') {
        direction = rawDirection;
      }
    }
    const remotes: Array<{ x: number; y: number }> = [];
    const remoteManager = isObj(scene.remotePlayersManager) ? scene.remotePlayersManager : null;
    if (remoteManager && typeof remoteManager.getAllRemotes === 'function') {
      const all: unknown = (remoteManager.getAllRemotes as () => unknown)();
      if (all instanceof Map) {
        for (const sprite of all.values()) {
          if (isObj(sprite) && typeof sprite.x === 'number' && typeof sprite.y === 'number') {
            remotes.push({ x: sprite.x, y: sprite.y });
          }
        }
      }
    }
    return { x: hero.x, y: hero.y, tile, mapName, direction, remotes };
  });
}

async function requireScenePose(page: Page): Promise<ScenePose> {
  let pose: ScenePose | null = null;
  await expect
    .poll(
      async () => {
        pose = await readScenePose(page);
        return pose !== null;
      },
      { timeout: UI_TIMEOUT_MS, message: 'Main scene hero was not readable via window.__PHASER_GAME__.' },
    )
    .toBe(true);
  if (!pose) throw new Error('Main scene hero was not readable via window.__PHASER_GAME__.');
  return pose;
}

/** Arrow keys drive the hero (MainScene.ts:263, playerManager.ts:165). A blocked direction returns null. */
async function holdArrowUntil(
  page: Page,
  key: ArrowKey,
  done: (pose: ScenePose) => boolean,
): Promise<ScenePose | null> {
  await page.locator('canvas').first().click();
  await page.keyboard.down(key);
  let matched: ScenePose | null = null;
  try {
    await expect
      .poll(
        async () => {
          const pose = await readScenePose(page);
          if (!pose || !done(pose)) return false;
          matched = pose;
          return true;
        },
        { timeout: 2_500 },
      )
      .toBe(true);
  } catch {
    return null;
  } finally {
    await page.keyboard.up(key);
  }
  return matched;
}

async function moveHeroUntil(page: Page, done: (pose: ScenePose) => boolean): Promise<ScenePose> {
  for (const key of ARROW_KEYS) {
    const pose = await holdArrowUntil(page, key, done);
    if (pose) return pose;
  }
  throw new Error('Arrow keys did not reach the required hero position.');
}

function zoneHalfExtent(tile: number): number {
  return tile * 6;
}

function heroInsideZoneRect(pose: { x: number; y: number }, rect: ZonePoint[]): boolean {
  const xs = rect.map((point) => point.x);
  const ys = rect.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return pose.x > minX && pose.x < maxX && pose.y > minY && pose.y < maxY;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function zoneRectAround(center: { x: number; y: number }, half: number): ZonePoint[] {
  return [
    { x: center.x - half, y: center.y - half },
    { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half },
    { x: center.x - half, y: center.y + half },
  ];
}

function participantButton(page: Page, user: TestUser) {
  const escaped = user.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('complementary').getByRole('button', { name: new RegExp(escaped, 'i') });
}

/** Puts the hero back so a later test does not inherit a saved position (useGameInitialization.ts:85). */
async function restorePlayerPosition(page: Page, apiUrl: string, pose: ScenePose): Promise<string[]> {
  try {
    const response = await page.context().request.post(`${apiUrl}/auth/position`, {
      data: {
        x: Math.round(pose.x),
        y: Math.round(pose.y),
        direction: pose.direction,
        ...(pose.mapName ? { mapName: pose.mapName } : {}),
      },
    });
    if (!response.ok()) return [`POST /auth/position failed: HTTP ${response.status()}.`];
    return [];
  } catch (error) {
    return [`POST /auth/position failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function trackEditorStateGets(page: Page, mapId: string): { sawZone: (name: string) => boolean; stop: () => void } {
  const bodies: unknown[] = [];
  const onResponse = (response: PageResponse): void => {
    if (response.request().method() !== 'GET') return;
    if (!response.url().includes(`/maps/${mapId}/editor-state`)) return;
    void response
      .json()
      .then((body: unknown) => {
        bodies.push(body);
      })
      .catch(() => {});
  };
  page.on('response', onResponse);
  return {
    sawZone: (name: string) => bodies.some((body) => zoneNames(body).includes(name)),
    stop: () => page.off('response', onResponse),
  };
}

/**
 * Local zone membership is ZoneManager.current (zoneManager.ts:15, update at
 * :35), refreshed only on local movement (useGameInitialization.ts:208) and
 * shown as hud.zone (HudPanel.tsx:83, useHudTicker.ts:47). The other client
 * drops a participant who stands in a different zone (useParticipants.ts:86).
 */
async function nudgeInsideZone(page: Page, rect: ZonePoint[]): Promise<void> {
  const start = await requireScenePose(page);
  if (!heroInsideZoneRect(start, rect)) throw new Error('Hero is outside the zone before the membership nudge.');
  await moveHeroUntil(
    page,
    (pose) => Math.hypot(pose.x - start.x, pose.y - start.y) > 2 && heroInsideZoneRect(pose, rect),
  );
}

/**
 * Entering and leaving: a zone is placed around client B. B steps inside so
 * the HUD shows the name, and both participant lists drop the other user.
 * B then walks out; the HUD name disappears and both lists show each other.
 */
test('entering and leaving a zone updates both clients', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));
  const zoneName = `e2e-we-${Date.now().toString(36)}`;

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    const origin = await requireScenePose(clientB.page);
    const positionErrors: string[] = [];
    try {
      await waitForParticipant(clientA.page, clientB.user);
      await waitForParticipant(clientB.page, clientA.user);
      const poseA = await requireScenePose(clientA.page);
      let poseB = await requireScenePose(clientB.page);
      const half = zoneHalfExtent(poseB.tile);
      if (chebyshev(poseA, poseB) <= half + poseB.tile) {
        poseB = await moveHeroUntil(clientB.page, (pose) => chebyshev(poseA, pose) > half + pose.tile);
      }
      const rect = zoneRectAround(poseB, half);
      const watchA = trackEditorStateGets(clientA.page, mapId);
      const watchB = trackEditorStateGets(clientB.page, mapId);
      try {
        await putEditorState(request, stack.apiUrl, mapId, {
          zones: [{ name: zoneName, points: rect }],
          replaceZones: true,
        });
        await expect
          .poll(() => watchA.sawZone(zoneName) && watchB.sawZone(zoneName), {
            timeout: LIVE_SYNC_TIMEOUT_MS,
            message: 'Both clients must reload the zone via GET editor-state.',
          })
          .toBe(true);
      } finally {
        watchA.stop();
        watchB.stop();
      }

      await nudgeInsideZone(clientB.page, rect);
      try {
        await expect(clientB.page.getByText(zoneName, { exact: true })).toBeVisible({ timeout: 3_000 });
      } catch {
        await nudgeInsideZone(clientB.page, rect);
        await expect(clientB.page.getByText(zoneName, { exact: true })).toBeVisible({
          timeout: LIVE_SYNC_TIMEOUT_MS,
        });
      }
      await expect(clientA.page.getByText(zoneName, { exact: true })).toHaveCount(0);
      await expect(participantButton(clientA.page, clientB.user)).toBeHidden({ timeout: LIVE_SYNC_TIMEOUT_MS });
      await expect(participantButton(clientB.page, clientA.user)).toBeHidden({ timeout: LIVE_SYNC_TIMEOUT_MS });

      await moveHeroUntil(clientB.page, (pose) => !heroInsideZoneRect(pose, rect));
      await expect(clientB.page.getByText(zoneName, { exact: true })).toHaveCount(0, {
        timeout: LIVE_SYNC_TIMEOUT_MS,
      });
      await expect(participantButton(clientA.page, clientB.user)).toBeVisible({ timeout: LIVE_SYNC_TIMEOUT_MS });
      await expect(participantButton(clientB.page, clientA.user)).toBeVisible({ timeout: LIVE_SYNC_TIMEOUT_MS });
    } finally {
      positionErrors.push(...(await restorePlayerPosition(clientB.page, stack.apiUrl, origin)));
    }
    if (positionErrors.length > 0) throw new Error(positionErrors.join('; '));
  });
});

/**
 * Remote avatar: B walks at least one tile. A must show a remote sprite on
 * that tile (remotePlayersManager.ts:96 applies the server position).
 */
test('remote avatar mirrors movement', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, admin, mapId, tenantSlug } = requireOwnerAndAdmin(seed);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    const [clientA, clientB] = await openClients(loginAs, owner, admin);
    const origin = await requireScenePose(clientB.page);
    const positionErrors: string[] = [];
    try {
      await waitForParticipant(clientA.page, clientB.user);
      await waitForParticipant(clientB.page, clientA.user);
      const before = await requireScenePose(clientB.page);
      await moveHeroUntil(clientB.page, (pose) => Math.hypot(pose.x - before.x, pose.y - before.y) >= pose.tile);
      const settled = await requireScenePose(clientB.page);
      expect(Math.hypot(settled.x - before.x, settled.y - before.y)).toBeGreaterThanOrEqual(before.tile);
      const tolerance = Math.max(settled.tile / 2, 8);
      await expect
        .poll(
          async () => {
            const watcher = await readScenePose(clientA.page);
            if (!watcher) return false;
            return watcher.remotes.some(
              (remote) => Math.hypot(remote.x - settled.x, remote.y - settled.y) <= tolerance,
            );
          },
          {
            timeout: LIVE_SYNC_TIMEOUT_MS,
            message: 'Client A did not place a remote sprite on client B tile.',
          },
        )
        .toBe(true);
    } finally {
      positionErrors.push(...(await restorePlayerPosition(clientB.page, stack.apiUrl, origin)));
    }
    if (positionErrors.length > 0) throw new Error(positionErrors.join('; '));
  });
});
