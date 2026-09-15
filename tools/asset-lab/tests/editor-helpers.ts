import { expect, type Page } from '@playwright/test';
export async function choose(page: Page, slot: string, value: string): Promise<void> {
  await page.locator('#characters-tab').click();
  await page.locator(`[data-slot="${slot}"]`).click();
  await page.locator(`[data-choice="${slot}:${value}"]`).click();
  await expect(page.locator(`[data-slot="${slot}"]`)).toHaveAttribute('data-value', value);
}
