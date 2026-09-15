import { parseDraft } from '../src/draft.ts';
import { test, expect } from '@playwright/test';
import { choose } from './editor-helpers.ts';
test('Live-Editor zeigt echte Varianten ohne Dropdowns und hält Tastaturfokus', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#figuren');
  await expect(page.locator('select')).toHaveCount(0);
  const braids = page.locator('[data-choice="hair:braids"]');
  const snapshot = () => braids.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const brown = await snapshot();
  await page.locator('[data-hair-color="rot"]').click();
  expect(await snapshot()).not.toBe(brown);
  await braids.focus();
  await page.keyboard.press('Enter');
  await expect(braids).toBeFocused();
  await expect(braids).toHaveAttribute('aria-pressed', 'true');
  const front = await snapshot();
  await page.locator('[data-direction="3"]').click();
  expect(await snapshot()).not.toBe(front);
  await page.locator('[data-slot="hair"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-slot="face"]')).toBeFocused();
  await expect(page.locator('[data-slot="face"]')).toHaveAttribute('aria-selected', 'true');
  await choose(page, 'glasses', 'round');
  await choose(page, 'beard', 'vollbart');
  await page.locator('[data-direction="0"]').click();
  await page.locator('[data-slot="glasses"]').click();
  await page.screenshot({
    path: `exports/editor-geprueft-${info.project.name}.png`,
    fullPage: true,
  });
  const stage = (await page.locator('.editor-model .avatar-stage').boundingBox())!;
  const directions = (await page.locator('.editor-model .directions').boundingBox())!;
  expect(directions.y).toBeGreaterThanOrEqual(stage.y + stage.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('neue Grundkörper, Startlooks und Zubehör bleiben im Rezept erhalten', async ({ page }) => {
  await page.goto('/#figuren');
  for (const proportion of ['kompakt', 'kompakt_weich', 'kompakt_markant', 'kompakt_kraeftig']) {
    await choose(page, 'proportion', proportion);
    await expect(page.locator(`[data-choice="proportion:${proportion}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('[data-compact-look="studio"]').click();
  await choose(page, 'hat', 'cat');
  await choose(page, 'beard', 'handlebar');
  const state = parseDraft(await page.evaluate(() => localStorage.getItem('meetropolis-asset-lab-v1')!));
  expect(state.character.proportion).toBe('kompakt_weich');
  expect(state.character.hat).toBe('cat');
  expect(state.character.beard).toBe('handlebar');
  expect(state.character.hair).toBe('bob');
  await page.reload();
  await page.locator('#characters-tab').click();
  await page.locator('[data-slot="hat"]').click();
  await expect(page.locator('[data-choice="hat:cat"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Direktlink öffnet die Figuren auch in einer bereits geladenen Werkstatt', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pixel-tab').click();
  await expect(page.locator('#pixel-panel')).toBeVisible();
  await page.goto('/#figuren');
  await expect(page.locator('#characters-panel')).toBeVisible();
  await expect(page.locator('#characters-tab')).toHaveAttribute('aria-selected', 'true');
});
