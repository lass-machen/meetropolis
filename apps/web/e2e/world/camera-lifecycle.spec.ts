/**
 * Camera lifecycle across editor and map lifecycle (P10b follow-up).
 *
 * A scene shutdown clears the Phaser main camera; asynchronous loaders that
 * resolve afterwards must not report camera errors. This case drives the real
 * product through open, save, close and reopen of the editor, a reload that
 * races the boot-time editor-state load, and (when the seed offers more than
 * one map) a map change, then requires an active main scene with a present
 * main camera and no collected error mentioning the camera.
 *
 * Verified selectors (all from the product code, not invented):
 * - menu button with aria-label „Menü“/„Menu“
 *   (apps/web/src/ui/app/TopRightMenu.tsx:427, locales de/en common.json:5).
 * - menu item „Map-Editor öffnen“/„Open map editor“
 *   (TopRightMenu.tsx:310-316, common.json:10).
 * - editor window „Map-Editor“ (apps/web/src/features/editor/EditorWindow.tsx:206),
 *   close control „×“ (EditorWindow.tsx:235-254, the only such button).
 * - background color picker on the General tab
 *   (apps/web/src/ui/editor/EditorPanel.tsx:172-188) and footer save
 *   „Speichern“/„Save“ (ui/editor/EditorPanel.tsx:428-447), which sends
 *   PUT /maps/:id/editor-state (apps/web/src/app/routes/WorldApp.tsx:313-351).
 * - map switch „Map wechseln“ select (apps/web/src/ui/hud/MapSwitcher.tsx:26-43),
 *   rendered only when more than one map is available (MapSwitcher.tsx:15),
 *   switching via apps/web/src/game/map/changeMap.ts.
 *
 * Verified runtime handles (read-only, no hooks or mocks):
 * - game handle `window.__PHASER_GAME__` (apps/web/src/game/phaserGame.ts:51),
 *   main scene key 'Main' (apps/web/src/game/scenes/MainScene.ts:103).
 *
 * This case creates no zones, objects or packs; it only flips the background
 * color through the real UI and restores the seed baseline afterwards.
 *
 * Run only against the isolated stack: E2E_RUN=true, MT_PROJECT=mtest-N as
 * well as origin localhost with the ports from MT_PORT_API/MT_PORT_WEB for API and
 * base URL (names and localhost form from the test stack script). Without
 * E2E_RUN, the file is safely skipped.
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { MeetropolisApi } from '../support/api';
import { getSeedTenant, passwordFor } from '../fixtures/helpers';

const SHOULD_RUN = process.env.E2E_RUN === 'true';

test.skip(!SHOULD_RUN, 'E2E_RUN=true required: this spec only runs against the isolated test stack.');

const UI_TIMEOUT_MS = 30_000;

type Baseline = { zones: unknown[]; backgroundColor: string | null };

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
    if (url.port !== expectedPort) {
      throw new Error(`${name}-Port ${url.port} does not match ${portName}=${expectedPort}.`);
    }
  }
}

/** Fetches owner and map from the real seed; the owner carries a password per seed.setup.ts. */
function requireOwnerAndMap(seed: SeedData): { owner: TestUser; mapId: string } {
  const tenant = getSeedTenant(seed);
  const owner = tenant.users.owner;
  if (!owner?.password) {
    throw new Error('The seed provides no owner with a password (see support/seed.setup.ts).');
  }
  return { owner, mapId: tenant.mapId };
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

/** Remembers zones and background of the seed map for restoration in finally. */
async function readBaseline(request: APIRequestContext, apiUrl: string, mapId: string): Promise<Baseline> {
  const state = await getEditorState(request, apiUrl, mapId);
  return {
    zones: Array.isArray(state.zones) ? state.zones : [],
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
    return [`Restore failed: ${error instanceof Error ? error.message : String(error)}`];
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

/** Opens the editor via the real menu. */
async function openEditor(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menü|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: /Map-Editor öffnen|Open map editor/ }).click();
  await expect(page.getByText('Map-Editor', { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/** Reads main-scene liveness and main-camera presence without touching internals. */
async function readMainSceneState(page: Page): Promise<{ active: boolean; hasMainCamera: boolean } | null> {
  return page.evaluate(() => {
    const holder = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene(key: string): unknown } };
    };
    const game = holder.__PHASER_GAME__;
    if (!game) return null;
    const scene = game.scene.getScene('Main') as {
      cameras?: { main?: unknown };
      sys?: { isActive?: () => boolean };
    } | null;
    if (!scene) return null;
    return {
      active: typeof scene.sys?.isActive === 'function' ? scene.sys.isActive() : false,
      hasMainCamera: scene.cameras?.main !== undefined && scene.cameras?.main !== null,
    };
  });
}

test('keeps the main camera usable across editor and map lifecycle', async ({ stack, seed, loginAs, request }) => {
  test.setTimeout(180_000);
  requireIsolatedStack(stack);
  const { owner, mapId } = requireOwnerAndMap(seed);
  // The editor-state routes need a session; the bare request fixture has none.
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, owner.tenantSlug);
  await ownerApi.login(owner.email, passwordFor(owner));

  await withBaseline(request, stack.apiUrl, mapId, async () => {
    const { page } = await loginAs(owner);

    const signals: string[] = [];
    page.on('pageerror', (error) => {
      signals.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') signals.push(`console: ${message.text()}`);
    });

    await expect(page.locator('canvas')).toBeVisible({ timeout: UI_TIMEOUT_MS });

    await openEditor(page);
    const stored = await getEditorState(request, stack.apiUrl, mapId);
    const currentBg = typeof stored.backgroundColor === 'string' ? stored.backgroundColor : null;
    const newBg = currentBg?.toLowerCase() === '#334455' ? '#445566' : '#334455';
    await page.getByRole('button', { name: 'Allgemein', exact: true }).click();
    const colorInputs = page.locator('input[type="color"]');
    await expect(colorInputs).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
    await colorInputs.first().fill(newBg);
    await expect(page.getByText(newBg, { exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });

    const savePut = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes(`/maps/${mapId}/editor-state`),
      { timeout: UI_TIMEOUT_MS },
    );
    await page.getByRole('button', { name: /^(Speichern|Save)/ }).click();
    const saveResponse = await savePut;
    expect(saveResponse.ok(), `PUT editor-state failed: HTTP ${saveResponse.status()}.`).toBe(true);

    const closeButton = page.getByRole('button', { name: '×' });
    await expect(closeButton).toHaveCount(1, { timeout: UI_TIMEOUT_MS });
    await closeButton.click();
    await expect(page.getByText('Map-Editor', { exact: true })).toBeHidden({ timeout: UI_TIMEOUT_MS });

    await openEditor(page);
    await page.reload();
    await expect(page.locator('canvas')).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect.poll(() => readMainSceneState(page), { timeout: UI_TIMEOUT_MS }).not.toBeNull();

    const switcher = page.locator('select[title="Map wechseln"]');
    if ((await switcher.count()) > 0) {
      const options = switcher.locator('option');
      const optionCount = await options.count();
      const current = await switcher.inputValue();
      const otherIndex = (await options.nth(0).getAttribute('value')) === current && optionCount > 1 ? 1 : 0;
      await switcher.selectOption({ index: otherIndex });
      await expect.poll(() => readMainSceneState(page), { timeout: UI_TIMEOUT_MS }).not.toBeNull();
    }

    const state = await readMainSceneState(page);
    expect(state, 'The main scene must exist after the lifecycle.').not.toBeNull();
    expect(state?.active, 'The main scene must be active after the lifecycle.').toBe(true);
    expect(state?.hasMainCamera, 'The main camera must be present after the lifecycle.').toBe(true);

    const cameraHits = signals.filter((signal) => signal.includes('setBackgroundColor') || signal.includes('cameras'));
    expect(cameraHits, `No camera error may surface during the lifecycle: ${cameraHits.join(' | ')}`).toEqual([]);
  });
});
