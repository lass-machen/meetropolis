import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { TestStackEnv } from '../fixtures';
import { appRouteUrl, waitForParticipant } from '../fixtures/helpers';

import type { VisualActor } from './visualActor';
import { applyTheme, type Theme } from './visualHelpers';

/**
 * The world with HUD and roster: the common starting surface of every app
 * baseline. The roster shows the participants of the room. The actor is
 * already logged in - the context of the test carries the session, so there
 * is no second login here.
 */
export async function openWorld(page: Page, stack: TestStackEnv, actor: VisualActor, theme: Theme): Promise<void> {
  await applyTheme(page, theme);
  await page.goto(appRouteUrl(stack.baseUrl, 'app'), { waitUntil: 'domcontentloaded' });
  await waitForParticipant(page, actor.user);
  await expect(page.locator('.onb-modal')).toBeHidden();
}

/**
 * The menu of the world header. The button is the one with the menu icon; the
 * entries are addressed by their icon as well, because their labels are
 * translated. The icon names of the app (Icon.tsx) map to the classes of the
 * icon library: menu, pen-ruler (PenTool) and building (Building2).
 */
export async function openTopRightMenu(page: Page): Promise<void> {
  await page.locator('button:has(svg.lucide-menu)').click();
  await expect(page.locator('div[role="menu"]')).toBeVisible();
}

/**
 * The map editor. The standard tab is "general" (the category the editor
 * service starts with), and only that tab carries the background colour
 * input.
 */
export async function openMapEditor(page: Page): Promise<void> {
  await openTopRightMenu(page);
  await page.locator('div[role="menu"] button[role="menuitem"]:has(svg.lucide-pen-tool)').click();
  await expect(page.locator('input[type="color"]')).toBeVisible();
}

/** The organization settings of the tenant (the building entry of the menu). */
export async function openTenantSettings(page: Page): Promise<void> {
  await openTopRightMenu(page);
  await page.locator('div[role="menu"] button[role="menuitem"]:has(svg.lucide-building-2)').click();
  await expect(page.locator('.sys-modal')).toBeVisible();
}

/**
 * The tabs of the organization settings. The guest tab only exists with
 * billing, so the OSS modal carries exactly these three. The index is the
 * position of the tab in that list, the key is the name of the snapshot.
 */
export const TENANT_SETTINGS_TABS = [
  { key: 'general', index: 0 },
  { key: 'members', index: 1 },
  { key: 'invites', index: 2 },
] as const;

export async function selectTenantSettingsTab(page: Page, index: number): Promise<void> {
  const tabs = page.locator('.sys-modal .sys-tabs__tab');
  await tabs.nth(index).click();
  await expect(tabs.nth(index)).toHaveClass(/sys-tabs__tab--active/);
}
