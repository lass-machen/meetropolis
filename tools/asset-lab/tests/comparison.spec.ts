import { parseDraft } from '../src/draft.ts';
import { choose } from './editor-helpers.ts';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

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
});
test.afterEach(() => expect(errors).toEqual([]));

test('die Körperform ist fest und die übrigen Merkmale bleiben editierbar', async ({ page }, info) => {
  await expect(page.locator('[data-slot="proportion"]')).toHaveCount(0);
  await expect(page.locator('[data-choice^="proportion:"]')).toHaveCount(0);
  await expect(page.locator('#previous-studies')).toHaveCount(0);
  await page.locator('#preview-walk').click();
  await expect(page.locator('#preview-walk')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-direction="1"]').click();
  await choose(page, 'hair', 'bald');
  await choose(page, 'face', 'freundlich');
  await page.locator('[data-skin="dark"]').click();
  const sheet = PNG.sync.read(await download(page, '#export-character'));
  expect([sheet.width, sheet.height]).toEqual([128, 256]);
  const recipe = parseDraft((await download(page, '#save-recipe')).toString());
  expect(recipe.character).toMatchObject({ proportion: 'kompakt', hair: 'bald', face: 'freundlich', skin: 'dark' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `exports/kompakt-editor-${info.project.name}.png`,
    fullPage: true,
  });
});

test('ein Rezept mit früherer Körperform wird auf kompakt normalisiert', async ({ page }) => {
  const compactSheet = hash(PNG.sync.read(await download(page, '#export-character')).data);
  const recipe = JSON.parse((await download(page, '#save-recipe')).toString()) as {
    character: Record<string, unknown>;
  };
  recipe.character.proportion = 'klassisch';
  await page.locator('#recipe-file').setInputFiles({
    name: 'form.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  const normalized = parseDraft((await download(page, '#save-recipe')).toString());
  expect(normalized.character.proportion).toBe('kompakt');
  expect(hash(PNG.sync.read(await download(page, '#export-character')).data)).toBe(compactSheet);
  delete recipe.character.proportion;
  await page.locator('#recipe-file').setInputFiles({
    name: 'bisherig.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  expect(parseDraft((await download(page, '#save-recipe')).toString()).character.proportion).toBe('kompakt');
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
    await page.locator(`[data-compact-look="${look}"]`).click();
    await expect(page.locator('#characters-panel')).toBeVisible();
    await expect(page.locator('[data-slot="proportion"]')).toHaveCount(0);
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
  await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', 'braids');
  expect(hash(PNG.sync.read(await download(page, '#export-character')).data)).toBe(pixels[2]);
  const swatch = page.locator('[data-hair-color="rot"]');
  expect(await swatch.evaluate((button) => (button as HTMLElement).style.getPropertyValue('--swatch'))).toBe('#dd7950');
  await page.locator('[data-compact-look="cap"]').click();
  await page.locator('[data-skin="light"]').click();
  await page.locator('#characters-panel').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `exports/kompakt-${info.project.name}.png`,
    fullPage: true,
  });
});
