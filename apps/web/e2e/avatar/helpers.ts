import catalog from '@meetropolis/shared/sprite/catalog.json' with { type: 'json' };

import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';

import { expect } from '../fixtures';

/** Shared helpers for real avatar E2E: own test tenants and sessions.
 * Requests are only delayed and forwarded, never answered by the test. */

/** The configuration fields of the real sprite catalog. */
const fields = catalog.compose.config_fields;

/** Hairstyles in the catalog order used by the editor. */
export function hairValues(): string[] {
  return fields.hair.values;
}

/** Position access via the stable part ID. The mandatory slot has no "none" option;
 * its labels currently use untranslated, polished catalog values. */
export function hairIndex(value: string): number {
  const index = hairValues().indexOf(value);
  if (index < 0) throw new Error(`Frisur „${value}“ fehlt im Katalog.`);
  return index;
}

/** The accessible hairstyle group with a fixed German locale. */
export function hairGrid(page: Page) {
  return page.getByRole('group', { name: 'Frisur' });
}

/** The hairstyle option for the unchanged catalog value. */
export function hairOption(page: Page, value: string) {
  return hairGrid(page).getByRole('button').nth(hairIndex(value));
}

/** Valid recipe from the catalog defaults with the desired hairstyle. */
export function composeBody(hair: string): Record<string, string> {
  return {
    skin: fields.skin.values[0],
    hair,
    hair_color: fields.hair_color.values[0],
    outfit: fields.outfit.default,
    face: fields.face.default,
    proportion: fields.proportion.default,
    top: fields.top.values[0],
    pants: fields.pants.values[0],
    shoes: fields.shoes.values[0],
  };
}

/** Creates a saved avatar via the real compose API. */
export async function composeAvatar(args: {
  context: BrowserContext;
  apiUrl: string;
  tenantSlug: string;
  hair: string;
}): Promise<{ status: number; body: unknown }> {
  const response = await args.context.request.post(`${args.apiUrl.replace(/\/+$/, '')}/me/avatar/compose`, {
    headers: { 'x-tenant': args.tenantSlug },
    data: composeBody(args.hair),
  });
  return { status: response.status(), body: await response.json() };
}

/** Checks real feature availability before the UI flow; no config mock. */
export async function requireAvatarEditorEnabled(args: {
  request: APIRequestContext;
  apiUrl: string;
  tenantSlug: string;
}): Promise<void> {
  const response = await args.request.get(`${args.apiUrl.replace(/\/+$/, '')}/public/config`, {
    headers: { 'x-tenant': args.tenantSlug },
  });
  expect(response.ok(), 'GET /public/config must respond successfully').toBe(true);
  const body = (await response.json()) as { avatarEditorEnabled?: boolean };
  expect(body.avatarEditorEnabled, 'The test stack must be started with --avatar-editor.').toBe(true);
}

/** The editor's save button, addressed via its accessible
 *  label in the fixed German locale. */
export function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Avatar speichern', exact: true });
}

/** The status region in the preview. It stays in the DOM even without a message,
 *  so its content is checked and not its count. */
export function statusRegion(page: Page) {
  return page.locator('.av-ed__preview').getByRole('status');
}

/** Checks the empty status region before the first save: it must exist,
 *  take no layout space, and stay reachable for assistive technology,
 *  and be neither hidden nor aria-hidden. */
export async function expectEmptyStatusRegion(page: Page, testInfo: TestInfo): Promise<void> {
  const region = statusRegion(page);
  await expect(region).toHaveCount(1);
  const layout = await region.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      ariaHidden: element.getAttribute('aria-hidden'),
    };
  });
  await testInfo.attach('status-region-layout', {
    body: JSON.stringify(layout, null, 2),
    contentType: 'application/json',
  });
  expect(layout.height, 'die leere Statusregion darf keinen Platz belegen').toBe(0);
  expect(layout.display, 'the empty status region must not be hidden').not.toBe('none');
  expect(layout.visibility, 'the empty status region must not be invisible').not.toBe('hidden');
  expect(layout.ariaHidden, 'the empty status region must not be aria-hidden').toBeNull();
}

/** The four mandatory groups of the body tab in verified order: field name
 *  and grid class. Order and classes are the hard-wired
 *  contract and are deliberately not imported from the editor layout — otherwise
 *  the test would only compare the product with itself. */
const BODY_TAB_GROUPS = [
  { field: 'skin', gridClass: 'av-ed__grid--swatch' },
  { field: 'face', gridClass: 'av-ed__grid--sprite' },
  { field: 'hair', gridClass: 'av-ed__grid--sprite' },
  { field: 'hair_color', gridClass: 'av-ed__grid--swatch' },
] as const;

/** Checks the initial state of the freshly opened editor: three category tabs,
 *  of which the first is active, visible slots and the four mandatory groups of the
 *  body tabs in fixed order. Language-independent: only
 *  classes, roles and numbers from the real catalog are checked, not translated
 *  Beschriftungen. */
export async function expectInitialBodyTab(page: Page): Promise<void> {
  // The editor frame is the parent container of .av-ed; the tabs live there.
  const editor = page.locator('.av-ed').locator('xpath=..');
  const tabs = editor.locator('.sys-tabs__tab');
  await expect(tabs, 'the editor has exactly three category tabs').toHaveCount(3);
  await expect(editor.locator('.sys-tabs__tab.sys-tabs__tab--active'), 'exactly one category tab is active').toHaveCount(
    1,
  );
  await expect(tabs.first(), 'the first category tab is active').toHaveClass(/sys-tabs__tab--active/);

  const slots = editor.locator('.av-ed__slots');
  await expect(slots, 'the slots of the body tab are visible').toBeVisible();

  const groups = slots.getByRole('group');
  await expect(groups, 'the body tab shows exactly four mandatory groups').toHaveCount(BODY_TAB_GROUPS.length);

  for (const [index, group] of BODY_TAB_GROUPS.entries()) {
    const element = groups.nth(index);
    await expect(element, `${group.field} uses the grid ${group.gridClass}`).toHaveClass(
      new RegExp(`av-ed__grid ${group.gridClass}`),
    );
    expect(fields[group.field].required, `${group.field} is a required field`).toBe(true);
    // Without a "none" option: the group shows exactly the field's catalog values.
    const options = fields[group.field].values.length;
    await expect(element.getByRole('button'), `${group.field} zeigt genau ${options} Katalogoptionen`).toHaveCount(
      options,
    );
  }
}

/** Opens the editor in onboarding. The fixture context already exists, so
 *  explicitly sets the German locale before the reload. */
export async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('i18nextLng', 'de'));
  await page.reload();
  const open = page.getByRole('button', { name: 'Eigenen erstellen' });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(saveButton(page)).toBeVisible({ timeout: 30_000 });
}

/** Holds a request until the test explicitly releases it. */
export function createGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

/** Bounded UI processing window after the download completes, so that the
 * the negative check does not turn green before the delayed state change. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
}
