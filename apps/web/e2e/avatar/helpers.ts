import catalog from '@meetropolis/shared/sprite/catalog.json' with { type: 'json' };

import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';

import { expect } from '../fixtures';

/** Gemeinsame Hilfen für echte Avatar-E2E: eigene Testmandanten und Sitzungen.
 * Requests werden nur verzögert und weitergeleitet, nie vom Test beantwortet. */

/** Die Konfigurationsfelder des echten Sprite-Katalogs. */
const fields = catalog.compose.config_fields;

/** Frisuren in der vom Editor verwendeten Katalogreihenfolge. */
export function hairValues(): string[] {
  return fields.hair.values;
}

/** Positionszugriff über die stabile Teil-ID. Der Pflichtslot hat keine „keine“-Option;
 * seine Beschriftungen verwenden derzeit unübersetzte, verschönerte Katalogwerte. */
export function hairIndex(value: string): number {
  const index = hairValues().indexOf(value);
  if (index < 0) throw new Error(`Frisur „${value}“ fehlt im Katalog.`);
  return index;
}

/** Die zugängliche Frisurgruppe bei fest eingestellter deutscher Locale. */
export function hairGrid(page: Page) {
  return page.getByRole('group', { name: 'Frisur' });
}

/** Die Frisuroption zum unveränderten Katalogwert. */
export function hairOption(page: Page, value: string) {
  return hairGrid(page).getByRole('button').nth(hairIndex(value));
}

/** Gültiges Rezept aus den Katalogdefaults mit der gewünschten Frisur. */
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

/** Erzeugt einen gespeicherten Avatar über die echte Compose-API. */
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

/** Prüft die echte Feature-Verfügbarkeit vor dem UI-Ablauf; kein Config-Mock. */
export async function requireAvatarEditorEnabled(args: {
  request: APIRequestContext;
  apiUrl: string;
  tenantSlug: string;
}): Promise<void> {
  const response = await args.request.get(`${args.apiUrl.replace(/\/+$/, '')}/public/config`, {
    headers: { 'x-tenant': args.tenantSlug },
  });
  expect(response.ok(), 'GET /public/config muss erfolgreich antworten').toBe(true);
  const body = (await response.json()) as { avatarEditorEnabled?: boolean };
  expect(body.avatarEditorEnabled, 'Der Teststack muss mit --avatar-editor gestartet werden.').toBe(true);
}

/** Der Speicherknopf des Editors, angesprochen über seine zugängliche
 *  Bezeichnung in der fest eingestellten deutschen Locale. */
export function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Avatar speichern', exact: true });
}

/** Die Statusregion in der Vorschau. Sie bleibt auch ohne Meldung im DOM,
 *  deshalb wird ihr Inhalt geprüft und nicht ihre Anzahl. */
export function statusRegion(page: Page) {
  return page.locator('.av-ed__preview').getByRole('status');
}

/** Prüft die leere Statusregion vor dem ersten Speichern: Sie muss vorhanden
 *  sein, keinen Platz im Layout belegen und für Hilfstechnologie erreichbar
 *  bleiben (nicht ausgeblendet, nicht aria-hidden). */
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
  expect(layout.display, 'die leere Statusregion darf nicht ausgeblendet sein').not.toBe('none');
  expect(layout.visibility, 'die leere Statusregion darf nicht unsichtbar sein').not.toBe('hidden');
  expect(layout.ariaHidden, 'die leere Statusregion darf nicht aria-hidden sein').toBeNull();
}

/** Die vier Pflicht-Gruppen des Körper-Tabs in geprüfter Reihenfolge: Feldname
 *  und Rasterklasse. Reihenfolge und Klassen sind der fest verdrahtete
 *  Vertrag und werden bewusst nicht aus dem Editor-Layout importiert — sonst
 *  vergleichte der Test das Produkt nur noch mit sich selbst. */
const BODY_TAB_GROUPS = [
  { field: 'skin', gridClass: 'av-ed__grid--swatch' },
  { field: 'face', gridClass: 'av-ed__grid--sprite' },
  { field: 'hair', gridClass: 'av-ed__grid--sprite' },
  { field: 'hair_color', gridClass: 'av-ed__grid--swatch' },
] as const;

/** Prüft den Anfangszustand des frisch geöffneten Editors: drei Kategorie-Tabs,
 *  davon der erste aktiv, sichtbare Slots und die vier Pflicht-Gruppen des
 *  Körper-Tabs in fester Reihenfolge. Sprachunabhängig: geprüft werden nur
 *  Klassen, Rollen und Zahlen aus dem echten Katalog, keine übersetzten
 *  Beschriftungen. */
export async function expectInitialBodyTab(page: Page): Promise<void> {
  // Der Editorrahmen ist der Elterncontainer von .av-ed; dort liegen die Tabs.
  const editor = page.locator('.av-ed').locator('xpath=..');
  const tabs = editor.locator('.sys-tabs__tab');
  await expect(tabs, 'der Editor hat genau drei Kategorie-Tabs').toHaveCount(3);
  await expect(editor.locator('.sys-tabs__tab.sys-tabs__tab--active'), 'genau ein Kategorie-Tab ist aktiv').toHaveCount(
    1,
  );
  await expect(tabs.first(), 'der erste Kategorie-Tab ist aktiv').toHaveClass(/sys-tabs__tab--active/);

  const slots = editor.locator('.av-ed__slots');
  await expect(slots, 'die Slots des Körper-Tabs sind sichtbar').toBeVisible();

  const groups = slots.getByRole('group');
  await expect(groups, 'der Körper-Tab zeigt genau vier Pflicht-Gruppen').toHaveCount(BODY_TAB_GROUPS.length);

  for (const [index, group] of BODY_TAB_GROUPS.entries()) {
    const element = groups.nth(index);
    await expect(element, `${group.field} nutzt das Raster ${group.gridClass}`).toHaveClass(
      new RegExp(`av-ed__grid ${group.gridClass}`),
    );
    expect(fields[group.field].required, `${group.field} ist ein Pflichtfeld`).toBe(true);
    // Ohne „keine“-Option: die Gruppe zeigt genau die Katalogwerte des Feldes.
    const options = fields[group.field].values.length;
    await expect(element.getByRole('button'), `${group.field} zeigt genau ${options} Katalogoptionen`).toHaveCount(
      options,
    );
  }
}

/** Öffnet den Editor im Onboarding. Der Fixture-Context existiert bereits; deshalb
 *  wird die deutsche Locale vor dem Neuladen ausdrücklich gesetzt. */
export async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('i18nextLng', 'de'));
  await page.reload();
  const open = page.getByRole('button', { name: 'Eigenen erstellen' });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(saveButton(page)).toBeVisible({ timeout: 30_000 });
}

/** Hält einen Request bis zur ausdrücklichen Freigabe durch den Test an. */
export function createGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

/** Begrenztes UI-Verarbeitungsfenster nach abgeschlossenem Download, damit die
 * negative Prüfung nicht vor der verspäteten Zustandsänderung grün wird. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
}
