import { parseDraft } from '../src/draft.ts';
import { officePresets } from '../src/office-presets.ts';
import { buildAssets, assetCollisionFootprint } from '../src/assets.ts';
import { clickWorld } from './room-helpers.ts';
import { choose } from './editor-helpers.ts';
import { test, expect, type Page, type Download } from '@playwright/test';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

let errors: string[];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#game canvas')).toHaveAttribute('data-ready', 'true');
});
test.afterEach(() => expect(errors).toEqual([]));

async function downloaded(page: Page, selector: string): Promise<Download> {
  if (selector === '#export-character') await page.locator('#characters-tab').click();
  const result = page.waitForEvent('download');
  await page.locator(selector).click();
  return result;
}
async function bytes(download: Download): Promise<Buffer> {
  return readFile(await download.path());
}

test('Stile, Gesicht, Haare und Accessoires verändern exportierte Pixel', async ({ page }, info) => {
  const canvas = page.locator('#asset-library [data-asset="sofa"] canvas');
  const first = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator('[data-theme="abend"]').click();
  await expect(page.locator('[data-theme="abend"]')).toHaveAttribute('aria-pressed', 'true');
  const changed = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(changed).not.toBe(first);
  await page.locator('#characters-tab').click();
  await page.locator('[data-skin="dark"]').click();
  await choose(page, 'face', 'freundlich');
  await choose(page, 'hair', 'curly');
  await page.locator('[data-hair-color="rot"]').click();
  await choose(page, 'beard', 'vollbart');
  await choose(page, 'hat', 'cap');
  await choose(page, 'glasses', 'round');
  const firstSheet = PNG.sync.read(await bytes(await downloaded(page, '#export-character')));
  expect([firstSheet.width, firstSheet.height]).toEqual([128, 256]);
  await choose(page, 'hat', 'hood');
  await expect(page.locator('[data-slot="hair"]')).toBeDisabled();
  await expect(page.locator('#hood-note')).toBeVisible();
  await choose(page, 'hat', '');
  await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', 'curly');
  const secondSheet = PNG.sync.read(await bytes(await downloaded(page, '#export-character')));
  expect(secondSheet.data).not.toEqual(firstSheet.data);
  await page.reload();
  await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', 'curly');
  await expect(page.locator('[data-slot="face"]')).toHaveAttribute('data-value', 'freundlich');
  await expect(page.locator('[data-theme="abend"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `exports/atelier-${info.project.name}.png`,
    fullPage: true,
  });
});

test('Pixelstrich, Rückgängig, Rezept und Pack verwenden dieselben Daten', async ({ page }, info) => {
  await page.locator('[data-asset="compact_desk"]').click();
  await expect(page.locator('#pixel-panel')).toBeVisible();
  const preview = page.locator('[data-office-id="loft"] canvas');
  const originalPreview = await preview.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const canvas = page.locator('#pixel-canvas');
  const draw = async (): Promise<void> => {
    const rect = (await canvas.boundingBox())!;
    await canvas.click({
      position: { x: rect.width / 96, y: rect.height / 64 },
    });
  };
  await draw();
  expect(await preview.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(originalPreview);
  let pixels = PNG.sync.read(await bytes(await downloaded(page, '#export-asset')));
  expect([...pixels.data.subarray(0, 4)]).toEqual([215, 149, 111, 255]);
  await page.locator('#undo-pixel').click();
  expect(await preview.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(originalPreview);
  pixels = PNG.sync.read(await bytes(await downloaded(page, '#export-asset')));
  expect(pixels.data[3]).toBe(0);
  await draw();
  const recipeDownload = await downloaded(page, '#save-recipe');
  const recipe = parseDraft((await bytes(recipeDownload)).toString('utf8'));
  expect(recipe.edits.holz?.compact_desk?.['0,0']).toBe('#d7956f');
  const draftDownload = await downloaded(page, '#export-draft');
  const zip = await JSZip.loadAsync(await bytes(draftDownload));
  const packed = PNG.sync.read(await zip.file('assets/compact_desk.png')!.async('nodebuffer'));
  expect([...packed.data.subarray(0, 4)]).toEqual([215, 149, 111, 255]);
  const inner = await JSZip.loadAsync(await zip.file('atelier-holz.mepack')!.async('nodebuffer'));
  expect(PNG.sync.read(await inner.file('assets/compact_desk.png')!.async('nodebuffer')).data).toEqual(packed.data);
  expect(zip.file('figur-MIT-LICENSE.txt')).not.toBeNull();
  expect(await zip.file('LICENSE.txt')!.async('string')).toContain('MIT License');
  await page.reload();
  await page.locator('[data-asset="compact_desk"]').click();
  pixels = PNG.sync.read(await bytes(await downloaded(page, '#export-asset')));
  expect(pixels.data).toEqual(packed.data);
  await page.locator('#reset-asset').click();
  await page.locator('#recipe-file').setInputFiles({
    name: 'rezept.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.locator('#message')).toContainText('wiederhergestellt');
  pixels = PNG.sync.read(await bytes(await downloaded(page, '#export-asset')));
  expect(pixels.data).toEqual(packed.data);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `exports/pixeleditor-${info.project.name}.png`,
    fullPage: true,
  });
});

test('echte Bewegung stoppt an Möbeln, Klickpfade umgehen sie und Formularfokus bleibt frei', async ({ page }) => {
  const canvas = page.locator('#game canvas');
  const office = officePresets.loft;
  const shelf = office.placements.find((item) => item.id === 'loft-shelf')!;
  const foot = assetCollisionFootprint(shelf.asset, buildAssets('holz')[shelf.asset])!;
  const stopY = shelf.y + foot.y + foot.h + 3;
  await canvas.focus();
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Number(await canvas.getAttribute('data-y'))).toBeLessThanOrEqual(stopY + 2);
  // Die Bewegung verwirft kollidierende Teilschritte von höchstens zwei Pixeln.
  // Auch unter weiter gehaltener Taste muss die Figur vor dem Möbel stehen bleiben.
  const positions = await canvas.evaluate(async (node: HTMLCanvasElement) => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(Number(node.dataset.y));
    }
    return samples;
  });
  await page.keyboard.up('ArrowUp');
  expect(Math.min(...positions)).toBeGreaterThanOrEqual(stopY);
  expect(Math.max(...positions)).toBeLessThanOrEqual(stopY + 2);
  expect(new Set(positions.slice(-10)).size).toBe(1);
  await page.locator('#reset-position').click();
  await expect(canvas).toHaveAttribute('data-y', office.spawn.y.toFixed(2));
  await page.locator('#overview').click();
  const desk = office.placements.find((item) => item.asset === 'compact_desk')!;
  const target = await clickWorld(page, { x: desk.x + 32, y: desk.y + 8 });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-x')), {
      timeout: 15_000,
    })
    .toBeCloseTo(target.x, 1);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-y')), {
      timeout: 15_000,
    })
    .toBeCloseTo(target.y, 1);
  await page.locator('#characters-tab').click();
  await page.locator('[data-slot="face"]').focus();
  const before = await canvas.getAttribute('data-y');
  await page.keyboard.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-y', before!);
  await page.locator('#room-tab').click();
  await page.locator('#guides').check();
  await page.locator('#pixel-tab').click();
  await page.locator('#room-tab').click();
  await expect(canvas).toBeVisible();
});

test('ungültiges Rezept meldet den Fehler und erhält den aktuellen Entwurf', async ({ page }) => {
  await choose(page, 'face', 'wach');
  await page.locator('#recipe-file').setInputFiles({
    name: 'defekt.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schema":"falsch"}'),
  });
  await expect(page.locator('#message')).toContainText('Unbekannte Rezeptversion');
  await expect(page.locator('[data-slot="face"]')).toHaveAttribute('data-value', 'wach');
});
