import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from '@playwright/test';
import type { ElementHandle, Locator, Page, TestInfo } from '@playwright/test';

import { openMapEditor, openTenantSettings, openWorld, selectTenantSettingsTab } from './appVisualHelpers';
import { test } from './visualActor';
import { THEMES, prepareSurface, surfaceScreenshotOptions } from './visualHelpers';

const MENU_BUTTON = 'button:has(svg.lucide-menu)';
const EDITOR_WINDOW = 'div[style*="z-index: 35"]';
const COLOR_INPUT = 'input[type="color"]';
const MEMBERS_TAB_INDEX = 1;

type Box = { x: number; y: number; width: number; height: number };

function roundedBox(box: Box | null): Box | null {
  if (!box) return null;
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

async function handleVisibility(canvas: ElementHandle<SVGElement | HTMLElement>): Promise<string> {
  return canvas.evaluate((element) => {
    if (!element.isConnected) {
      throw new Error('The world canvas was detached from the document during capture.');
    }
    return getComputedStyle(element).visibility;
  });
}

async function uniqueTargetBox(target: Locator): Promise<Box> {
  await expect(target).toHaveCount(1);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('The target of the masking regression has no visible area.');
  }
  return box;
}

async function assertTargetUnchanged(target: Locator, box: Box): Promise<void> {
  await expect(target).toHaveCount(1);
  await expect(target).toBeVisible();
  expect(roundedBox(await target.boundingBox())).toEqual(roundedBox(box));
}

async function compareSurfaceWithReferenceStyle(page: Page, testInfo: TestInfo, target: Locator): Promise<void> {
  await prepareSurface(page);

  const visibleCanvas = page.locator('canvas:visible').first();
  await expect(visibleCanvas).toBeVisible();
  const canvas = await visibleCanvas.elementHandle();
  if (!canvas) {
    throw new Error('The visible world canvas could not be captured.');
  }

  try {
    const box = await uniqueTargetBox(target);
    const clip: Box = { x: box.x, y: box.y, width: box.width, height: box.height };
    expect(await handleVisibility(canvas)).toBe('visible');

    const reference = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
      clip,
      style: await readFile(path.resolve(testInfo.config.rootDir, 'snapshot.css'), 'utf8'),
    });

    expect(await handleVisibility(canvas)).toBe('visible');
    await assertTargetUnchanged(target, box);

    const { maxDiffPixelRatio: _tolerance, stylePath, ...options } = surfaceScreenshotOptions();
    const actual = await page.screenshot({
      ...options,
      fullPage: false,
      clip,
      ...(stylePath ? { style: await readFile(path.resolve(testInfo.config.rootDir, stylePath), 'utf8') } : {}),
    });

    expect(await handleVisibility(canvas)).toBe('visible');
    await assertTargetUnchanged(target, box);

    const identical = reference.equals(actual);
    if (!identical) {
      await testInfo.attach('masking-reference.png', { body: reference, contentType: 'image/png' });
      await testInfo.attach('masking-actual.png', { body: actual, contentType: 'image/png' });
    }
    expect(identical).toBe(true);
  } finally {
    await canvas.dispose();
  }
}

for (const theme of THEMES) {
  test.describe(`masking (${theme})`, () => {
    test.use({ colorScheme: theme });

    test('world menu button stays visible under the mask', async ({ page, stack, visualActor }, testInfo) => {
      await openWorld(page, stack, visualActor, theme);
      await compareSurfaceWithReferenceStyle(page, testInfo, page.locator(MENU_BUTTON));
    });

    test('map editor stays visible under the mask', async ({ page, stack, visualActor }, testInfo) => {
      await openWorld(page, stack, visualActor, theme);
      await openMapEditor(page);
      await compareSurfaceWithReferenceStyle(
        page,
        testInfo,
        page.locator(EDITOR_WINDOW).filter({ has: page.locator(COLOR_INPUT) }),
      );
    });

    test('members modal stays visible under the mask', async ({ page, stack, visualActor }, testInfo) => {
      await openWorld(page, stack, visualActor, theme);
      await openTenantSettings(page);
      await selectTenantSettingsTab(page, MEMBERS_TAB_INDEX);
      await compareSurfaceWithReferenceStyle(page, testInfo, page.locator('.sys-modal'));
    });
  });
}
