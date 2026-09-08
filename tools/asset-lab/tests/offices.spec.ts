import type { officeRecipe as makeOfficeRecipe } from '../src/pack.ts';
import { parseDraft } from '../src/draft.ts';
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { officeList, officePresets } from '../src/office-presets.ts';
import { clickWorld } from './room-helpers.ts';

test('drei Offices erhalten Figur und Pixeländerungen und werden im Rezept wiederhergestellt', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#figuren');
  await page.locator('[data-skin="dark"]').click();
  await page.locator('[data-compact-look="copper"]').click();
  await expect(page.locator('[data-skin="dark"]')).toHaveAttribute('aria-pressed', 'true');
  const hair = await page.locator('[data-slot="hair"]').getAttribute('data-value');
  const previews = await page
    .locator('[data-office-id] canvas')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLCanvasElement).toDataURL()));
  expect(new Set(previews).size).toBe(3);
  for (const office of officeList) {
    await page.locator(`[data-office-id="${office.id}"]`).click();
    await expect(page.locator('#game canvas')).toHaveAttribute('data-office', office.id);
    await expect(page.locator('#editor-room-name')).toHaveText(office.name);
    await expect(page.locator('[data-slot="hair"]')).toHaveAttribute('data-value', hair!);
    await expect(page.locator('[data-skin="dark"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#game canvas')).toHaveAttribute('data-y', office.spawn.y.toFixed(2));
  }
  const exported = page.waitForEvent('download');
  await page.locator('#export-draft').click();
  const zip = await JSZip.loadAsync(await readFile(await (await exported).path()));
  const room = PNG.sync.read(await zip.file('raum.png')!.async('nodebuffer'));
  expect([room.width, room.height]).toEqual([1440, 896]);
  const officeRecipe = JSON.parse(await zip.file('raum-rezept.json')!.async('string')) as ReturnType<
    typeof makeOfficeRecipe
  >;
  expect(officeRecipe.id).toBe('campus');
  expect(officeRecipe.workplaces).toHaveLength(24);
  const save = page.waitForEvent('download');
  await page.locator('#save-recipe').click();
  const recipe = parseDraft(await readFile(await (await save).path(), 'utf8'));
  expect(recipe.schema).toBe('meetropolis-asset-lab/v2');
  expect(recipe.office).toBe('campus');
  expect(recipe.character.skin).toBe('dark');
  await page.reload();
  await expect(page.locator('[data-office-id="campus"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#game canvas')).toHaveAttribute('data-office', 'campus');
  const oldRecipe: Omit<typeof recipe, 'schema' | 'office'> & { schema: string; office?: typeof recipe.office } = {
    ...recipe,
    schema: 'meetropolis-asset-lab/v1',
    edits: { holz: { desk: { '0,0': '#ff00aa' } } },
  };
  delete oldRecipe.office;
  await page.locator('#recipe-file').setInputFiles({
    name: 'alt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldRecipe)),
  });
  await expect(page.locator('[data-office-id="loft"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-skin="dark"]')).toHaveAttribute('aria-pressed', 'true');
  const restored = page.waitForEvent('download');
  await page.locator('#save-recipe').click();
  const migrated = parseDraft(await readFile(await (await restored).path(), 'utf8'));
  expect(migrated.edits).toEqual(oldRecipe.edits);
  expect(migrated.character).toEqual(recipe.character);
  await page.locator('[data-office-id="campus"]').click();
  await page.locator('[data-office-id="loft"]').click();
  const switched = page.waitForEvent('download');
  await page.locator('#save-recipe').click();
  const afterSwitch = parseDraft(await readFile(await (await switched).path(), 'utf8'));
  expect(afterSwitch.edits).toEqual(oldRecipe.edits);
  expect(afterSwitch.character).toEqual(recipe.character);
  await page.screenshot({
    path: `exports/offices-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Office-Auswahl hält Tastaturfokus und führt über den Editor ins Büro', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-office-id="loft"]').focus();
  await page.keyboard.press('ArrowRight');
  const studio = page.locator('[data-office-id="studio"]');
  await expect(studio).toHaveAttribute('aria-checked', 'true');
  await expect(studio).toBeFocused();
  await expect(page.locator('[data-office-id][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-office-id="loft"]')).toBeFocused();
  await page.locator('[data-office-action="design"]').click();
  await expect(page.locator('#characters-panel')).toBeVisible();
  await expect(page.locator('[data-stage="character"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#avatar-room-preview')).toBeVisible();
  await page.locator('[data-office-action="enter"]').click();
  await expect(page.locator('#game canvas')).toBeFocused();
  await expect(page.locator('[data-stage="room"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#zone-name')).toHaveText('Ankommen');
  await page.setViewportSize({ width: 320, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Kamera folgt im Campus und Klickziele stimmen auch in der Übersicht', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-office-id="campus"]').click();
  await page.locator('[data-office-action="enter"]').click();
  const canvas = page.locator('#game canvas');
  const beforeX = Number(await canvas.getAttribute('data-camera-x'));
  const nearby = officePresets.campus.workplaces.find((p) => p.id === 'campus-team-c-5-desk')!;
  const target = await clickWorld(page, nearby.approach);
  await expect.poll(async () => Number(await canvas.getAttribute('data-x'))).toBeCloseTo(target.x, 1);
  await expect.poll(async () => Number(await canvas.getAttribute('data-y'))).toBeCloseTo(target.y, 1);
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-x'))).toBeGreaterThan(beforeX + 20);
  await page.locator('#overview').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeLessThan(1);
  const meeting = officePresets.campus.zones.find((z) => z.kind === 'meeting')!;
  const overviewTarget = await clickWorld(page, meeting.entry);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-x')), {
      timeout: 15_000,
    })
    .toBeCloseTo(overviewTarget.x, 1);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-y')), {
      timeout: 15_000,
    })
    .toBeCloseTo(overviewTarget.y, 1);
  await expect(page.locator('#zone-name')).toHaveText(meeting.name);
  await canvas.screenshot({ path: `exports/campus-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
