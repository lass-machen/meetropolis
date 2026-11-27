import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';

import { test } from '../fixtures';
import type { TestStackEnv } from '../fixtures';

import axe from 'axe-core';
import type { AxeResults } from 'axe-core';

export type Theme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['light', 'dark'];

export type AxeGate = 'report' | 'enforce';

/**
 * Phase 0 only reports serious and critical findings, the run stays green. From phase 3
 * on this is the hard gate: switch the constant to 'enforce'.
 */
export const AXE_GATE: AxeGate = 'report';

const MAX_DIFF_PIXEL_RATIO = 0.01;

/**
 * Surfaces that draw themselves differently on every frame (world canvas,
 * video tiles, times, avatars and the roster line with the last-seen time of a
 * member who is not in the room) are hidden by this stylesheet, relative to the
 * visual suite. Playwright paints a mask box above every other layer, so masking
 * the canvas also covered the HUD and the dialogs that sit on top of the world;
 * a hidden surface leaves everything above it visible.
 */
// Resolved next to this module, so the suite finds it under the visual config
// (rootDir e2e/visual) and under the root config (rootDir e2e) alike.
export const SNAPSHOT_STYLE_PATH = fileURLToPath(new URL('./snapshot.css', import.meta.url));

interface AxeBrowserApi {
  run: (context?: Document) => Promise<AxeResults>;
}

interface AxeWindow extends Window {
  axe?: AxeBrowserApi;
}

/**
 * The theme is the app's own override (the key the theme provider reads), not
 * a stylesheet of the test.
 */
export async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    // The init script also runs for the empty document, which has no storage.
    if (window.location.protocol === 'about:') return;
    window.localStorage.setItem('ui:theme:override', value);
    window.localStorage.setItem('i18nextLng', 'de');
  }, theme);
}

/**
 * Open an auth surface in a fixed theme. The theme is the app's own override
 * (localStorage key of the theme provider), not a stylesheet of the test.
 */
export async function openSurface(page: Page, theme: Theme, hash: string): Promise<void> {
  await applyTheme(page, theme);
  await page.goto(hash, { waitUntil: 'domcontentloaded' });
  await page.locator('.pub-auth-layout__form-inner').waitFor({ state: 'visible' });
}

/**
 * The "password forgotten" form has no own hash route: useHashRoute knows
 * login, register, invite, guest-auth, reset-pw and connect, and the request
 * form is a view switch inside the login view. The trigger is the button next
 * to the password label, addressed through the password field.
 */
export function forgotPasswordTrigger(page: Page): Locator {
  return page.locator('input[name="password"]').locator('xpath=../..').locator('button[type="button"]').first();
}

export async function openForgotSurface(page: Page, theme: Theme): Promise<void> {
  await openSurface(page, theme, '/#/login');
  await forgotPasswordTrigger(page).click();
  await expect(page.locator('form h2')).toBeVisible();
  await expect(page.locator('form input[name="password"]')).toHaveCount(0);
}

/** Id of the style element that freezes the moving parts of the page. */
const STABILIZE_STYLE_ID = 'visual-stabilize-style';

const STABILIZE_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

/**
 * Bring the page into the state a baseline is taken from: fonts loaded, images
 * complete and really there, nothing moving. A theme switch still runs its
 * colour transitions, so the animations are frozen before the axe run and not
 * only by the screenshot option afterwards - axe would otherwise measure the
 * colours of a running transition.
 */
export async function prepareSurface(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await waitForImages(page);
  await page.evaluate(
    ({ id, css }) => {
      if (!document.getElementById(id)) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
      }
      for (const animation of document.getAnimations()) {
        if (animation.playState !== 'finished') animation.cancel();
      }
    },
    { id: STABILIZE_STYLE_ID, css: STABILIZE_CSS },
  );
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * An image that is finished but has no natural width did not load. That is
 * reported by name instead of being hidden: a baseline with a missing picture
 * is worthless.
 */
async function waitForImages(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((image) => {
        if (!image.complete) return false;
        const source = image.currentSrc || image.getAttribute('src') || '';
        return source !== '' && image.naturalWidth === 0;
      })
      .map((image) => image.currentSrc || image.getAttribute('src') || ''),
  );
  if (broken.length > 0) {
    throw new Error(`Image source not loadable: ${broken.join(', ')}`);
  }
}

export interface SurfaceScreenshotOptions {
  animations: 'disabled';
  caret: 'hide';
  fullPage: boolean;
  maxDiffPixelRatio: number;
  mask: Locator[];
  stylePath?: string;
}

export function surfaceScreenshotOptions(): SurfaceScreenshotOptions {
  return {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
    mask: [],
    stylePath: SNAPSHOT_STYLE_PATH,
  };
}

export async function captureSurface(page: Page, name: string): Promise<void> {
  await prepareSurface(page);
  await expect(page).toHaveScreenshot(`${name}.png`, surfaceScreenshotOptions());
}

/**
 * Run axe in the real page. The full result becomes a test attachment, the
 * serious and critical findings are reported as annotations. Nothing is
 * filtered out of the result and no rule is switched off.
 */
export async function runAxe(page: Page, testInfo: TestInfo, gate: AxeGate = AXE_GATE): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => {
    const api = (window as AxeWindow).axe;
    if (!api) throw new Error('axe-core was not injected into the page.');
    return api.run();
  });
  await testInfo.attach('axe-results.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const summary = blocking.map(
    (violation) => `${violation.id} [${violation.impact}] ${violation.help} (${violation.nodes.length} nodes)`,
  );
  await testInfo.attach('axe-serious-critical.txt', {
    body: summary.length > 0 ? summary.join('\n') : 'none',
    contentType: 'text/plain',
  });
  for (const line of summary) {
    testInfo.annotations.push({ type: 'a11y', description: line });
  }
  if (gate === 'enforce') expect(summary).toEqual([]);
}

/**
 * The suite boundary. The root test config finds every spec file as well,
 * and an EE or Brand build must not write into the OSS baseline folder. Both
 * guards say what to do instead of failing the run.
 *
 * The two guards are separate hooks on purpose: the first one needs no
 * fixture, so a run under the root config skips without a slot environment.
 *
 * The guards are registered on the test object they belong to: the auth specs
 * use the shared test object, the app specs their own extended one
 * (visualActor.ts). Both get the same two guards in the same order.
 */
export interface OssVisualGuardTarget {
  beforeEach(inner: (args: { stack: TestStackEnv }, testInfo: TestInfo) => unknown): void;
  skip(condition: boolean, description?: string): void;
}

export function guardOssVisualSuite(target: OssVisualGuardTarget = test): void {
  target.beforeEach(({}, testInfo) => {
    if (testInfo.project.metadata.ossVisualSuite !== true) {
      target.skip(
        true,
        'Eigene Config nutzen: playwright test --config=e2e/visual/playwright.config.ts (metadata.ossVisualSuite).',
      );
    }
  });

  target.beforeEach(({ stack }) => {
    if (stack.edition !== 'oss') {
      target.skip(true, 'OSS-Visuals: no EE/brand baselines are created in the EE slot.');
    }
  });
}
