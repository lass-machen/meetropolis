import { parseDraft } from '../src/draft.ts';
import { officePresets } from '../src/office-presets.ts';
import { choose } from './editor-helpers.ts';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const shapes = ['kompakt', 'rund', 'klassisch'] as const;
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
async function download(page: Page, selector: string): Promise<Buffer> {
  if (selector === '#export-character') await page.locator('#characters-tab').click();
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  return readFile(await (await pending).path());
}
let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#figuren');
  await expect(page.locator('#game canvas')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#characters-panel')).toBeVisible();
  await page.locator('#previous-studies > summary').click();
});
test.afterEach(() => expect(errors).toEqual([]));

test('drei Formen zeigen dieselbe Auswahl und Blickrichtung, animieren und lassen sich als Vergleich exportieren', async ({
  page,
}, info) => {
  const canvases = page.locator('canvas[data-comparison]');
  await expect(canvases).toHaveCount(3);
  const snapshot = () => canvases.evaluateAll((nodes) => nodes.map((node) => (node as HTMLCanvasElement).toDataURL()));
  const moving = await snapshot();
  await expect.poll(snapshot).not.toEqual(moving);
  await page.locator('#preview-walk').click();
  await expect(page.locator('#preview-walk')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-direction="1"]').click();
  await choose(page, 'hair', 'bald');
  await choose(page, 'face', 'freundlich');
  await page.locator('[data-skin="dark"]').click();
  // Zwei Zeichenzyklen schließen die Änderungen der Bedienelemente ab.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const shape of shapes) {
    await choose(page, 'proportion', shape);
    const sheet = PNG.sync.read(await download(page, '#export-character'));
    const shown = await page.locator(`[data-comparison="${shape}"]`).evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')!;
      return Array.from({ length: 32 * 32 }, (_, i) => [
        ...ctx.getImageData(56 + (i % 32) * 4, 4 + Math.floor(i / 32) * 4, 1, 1).data,
      ]);
    });
    let visible = 0;
    for (let i = 0; i < shown.length; i++) {
      const offset = ((32 + Math.floor(i / 32)) * sheet.width + (i % 32)) * 4;
      if (sheet.data[offset + 3]) {
        expect(shown[i]).toEqual([...sheet.data.subarray(offset, offset + 4)]);
        visible++;
      }
    }
    expect(visible).toBeGreaterThan(100);
  }
  const paused = await snapshot();
  await page.locator('#characters-tab').click();
  const output = await download(page, '#export-comparison');
  const comparison = PNG.sync.read(output);
  expect([comparison.width, comparison.height]).toEqual([768, 390]);
  expect(await snapshot()).toEqual(paused);
  expect(new Set(paused).size).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-direction="0"]').click();
  await choose(page, 'hair', 'messy');
  await page.locator('[data-skin="medium"]').click();
  await choose(page, 'face', 'ruhig');
  await page.screenshot({
    path: `exports/figurenvergleich-${info.project.name}.png`,
    fullPage: true,
  });
  const image = page.waitForEvent('download');
  await page.locator('#export-comparison').click();
  await (await image).saveAs(`exports/figurenvergleich-${info.project.name}-export.png`);
});

test('jede Form lässt sich im Büro verwenden und samt Pixeln im Rezept wiederherstellen', async ({ page }) => {
  const sheets: string[] = [];
  for (const shape of shapes) {
    await page.locator('#characters-tab').click();
    await page.locator(`[data-proportion="${shape}"]`).click();
    await expect(page.locator('#room-panel')).toBeVisible();
    await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', shape);
    await expect(page.locator('#game canvas')).toHaveAttribute('data-y', officePresets.loft.spawn.y.toFixed(2));
    sheets.push(hash(PNG.sync.read(await download(page, '#export-character')).data));
  }
  expect(new Set(sheets).size).toBe(3);
  const recipe = parseDraft((await download(page, '#save-recipe')).toString());
  expect(recipe.character.proportion).toBe('klassisch');
  await page.reload();
  await page.locator('#previous-studies > summary').click();
  await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', 'klassisch');
  await choose(page, 'proportion', 'rund');
  await page.locator('#recipe-file').setInputFiles({
    name: 'form.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', 'klassisch');
  expect(hash(PNG.sync.read(await download(page, '#export-character')).data)).toBe(sheets[2]);
  delete recipe.character.proportion;
  await page.locator('#recipe-file').setInputFiles({
    name: 'bisherig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', '');
  expect(sheets).not.toContain(hash(PNG.sync.read(await download(page, '#export-character')).data));
  await page.reload();
  await page.locator('#previous-studies > summary').click();
  await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', '');
});

test('Tastatur wechselt zwischen allen drei Ansichten', async ({ page }) => {
  await page.locator('#characters-tab').focus();
  for (const [key, tab] of [
    ['ArrowRight', 'pixel'],
    ['ArrowRight', 'room'],
    ['ArrowLeft', 'pixel'],
    ['Home', 'room'],
    ['End', 'pixel'],
    ['ArrowLeft', 'characters'],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator(`#${tab}-tab`)).toBeFocused();
    await expect(page.locator(`#${tab}-tab`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`#${tab}-panel`)).toBeVisible();
  }
});

test('die drei neuen Beispiele bleiben modular, erhalten den Hautton und speichern den gewählten Stil', async ({
  page,
}, info) => {
  await page.locator('[data-skin="dark"]').click();
  const pixels: string[] = [];
  for (const [look, hat, hair, outfit] of [
    ['cap', 'cap', 'side_part', 'suit_navy'],
    ['hood', 'hood', 'bob', 'blazer_anthracite'],
    ['copper', '', 'braids', 'dress_red'],
  ]) {
    await page.locator(`[data-look="${look}"]`).click();
    await expect(page.locator('#characters-panel')).toBeVisible();
    await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', 'kompakt');
    await expect(page.locator('[data-skin="dark"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="hat"]')).toHaveAttribute('data-value', hat);
    await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', hair);
    await expect(page.locator('[data-slot="outfit"]')).toHaveAttribute('data-value', outfit);
    const recipe = parseDraft((await download(page, '#save-recipe')).toString());
    expect(recipe.character.beard_color).toBe(recipe.character.hair_color);
    pixels.push(hash(PNG.sync.read(await download(page, '#export-character')).data));
  }
  expect(new Set(pixels).size).toBe(3);
  await page.reload();
  await page.locator('#previous-studies > summary').click();
  await expect(page.locator('[data-slot="proportion"]')).toHaveAttribute('data-value', 'kompakt');
  await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', 'braids');
  expect(hash(PNG.sync.read(await download(page, '#export-character')).data)).toBe(pixels[2]);
  const swatch = page.locator('[data-hair-color="rot"]');
  expect(await swatch.evaluate((button) => (button as HTMLElement).style.getPropertyValue('--swatch'))).toBe('#dd7950');
  await choose(page, 'proportion', 'schlank');
  expect(await swatch.evaluate((button) => (button as HTMLElement).style.getPropertyValue('--swatch'))).toBe('#c25128');
  await page.locator('[data-look="cap"]').click();
  await page.locator('[data-skin="light"]').click();
  await page.locator('#characters-panel').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `exports/kompakt-${info.project.name}.png`,
    fullPage: true,
  });
});
