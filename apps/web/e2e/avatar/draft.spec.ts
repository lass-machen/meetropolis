import { expect, test } from '../fixtures';

import {
  composeAvatar,
  createGate,
  expectEmptyStatusRegion,
  expectInitialBodyTab,
  hairGrid,
  hairOption,
  openEditor,
  requireAvatarEditorEnabled,
  saveButton,
  settle,
  statusRegion,
} from './helpers';

/** Vier echte Regressionen des Avatar-Entwurfs: verspätetes Laden, Netzwerkausfall,
 * Status nach Änderung und Bearbeitung während des Speicherns. Keine API-Mocks. */
test.describe('Avatar-Entwurf @avatar', () => {
  test('verspätetes Laden überschreibt die neue Frisur nicht', async ({ freshTenant, loginAs, stack, request }) => {
    const { context, page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });

    const storedHair = 'buzz';
    const chosenHair = 'bob';

    // Die gespeicherte Frisur muss sich von der späteren Auswahl unterscheiden.
    const composed = await composeAvatar({
      context,
      apiUrl: stack.apiUrl,
      tenantSlug: freshTenant.slug,
      hair: storedHair,
    });
    expect(composed.status, 'der gespeicherte Avatar muss erzeugbar sein').toBe(200);

    const gate = createGate();
    await page.route('**/me/avatar/custom', async (route) => {
      await gate.promise;
      await route.continue();
    });

    try {
      await openEditor(page);
      await expect(hairGrid(page)).toBeVisible();

      const chosen = hairOption(page, chosenHair);
      await chosen.click();
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');

      // Die verzögerte Antwort kommt erst nach der neuen Auswahl an.
      const answered = page.waitForResponse((response) => response.url().includes('/me/avatar/custom'));
      const downloaded = page.waitForEvent('requestfinished', (req) => req.url().includes('/me/avatar/custom'));
      gate.release();
      const response = await answered;
      expect(response.status(), 'der verzögerte Abruf muss den gespeicherten Avatar liefern').toBe(200);
      await downloaded;
      await settle(page);

      // Die Auswahl bleibt bestehen, obwohl die alte gespeicherte Antwort ankommt.
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');
      await expect(hairOption(page, storedHair)).toHaveAttribute('aria-pressed', 'false');
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/custom');
    }
  });

  test('echter Transportausfall hinterlässt keinen speicherbaren Ersatzentwurf', async ({
    freshTenant,
    loginAs,
    stack,
    request,
  }) => {
    const { context, page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });

    const gate = createGate();
    await page.route('**/me/avatar/custom', async (route) => {
      await gate.promise;
      await route.continue();
    });

    try {
      await openEditor(page);

      // Der angehaltene Request wird nach dem Offline-Schalten weitergeleitet.
      // requestfailed belegt den echten Transportausfall.
      const failed = page.waitForEvent('requestfailed', (req) => req.url().includes('/me/avatar/custom'));
      await context.setOffline(true);
      gate.release();
      const failure = await failed;
      expect(failure.failure(), 'der angehaltene Request muss am Transport scheitern').not.toBeNull();

      // Der Editor meldet seine Nichtverfügbarkeit und bietet keinen Ersatzentwurf zum Speichern an.
      await expect(page.getByText('Editor nicht verfügbar')).toBeVisible({ timeout: 15_000 });
      expect(await saveButton(page).count(), 'kein speicherbarer Ersatzentwurf').toBe(0);
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/custom');
      await context.setOffline(false);
    }
  });

  test('eine Änderung entfernt den zuvor gespeicherten Status', async ({
    freshTenant,
    loginAs,
    stack,
    request,
  }, testInfo) => {
    const { page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });
    await openEditor(page);

    // Der Körper-Tab ist der geprüfte Anfangszustand des Editors. Die Anker
    // sind bestehende Testanker: sys-tabs__tab--active (Tabs.tsx:23) und
    // av-ed__grid--* (SlotPicker.tsx:55 sowie 100–103). Die Tabs tragen weder
    // role=tab noch aria-selected, deshalb wird die Klasse geprüft und keine
    // Produkt-A11y geändert. Reihenfolge skin/face/hair/hair_color und die
    // Farbfelder stehen in editorLayout.ts:22 und 30; der Helper hält beide
    // fest, statt sie aus dem Layout zu importieren.
    await expectInitialBodyTab(page);

    // Vor dem ersten Speichern steht die leere Statusregion schon im DOM: Sie
    // belegt keinen Platz und bleibt für Hilfstechnologie erreichbar.
    await expectEmptyStatusRegion(page, testInfo);

    const answered = page.waitForResponse(
      (response) => response.url().includes('/me/avatar/compose') && response.request().method() === 'POST',
    );
    await saveButton(page).click();
    const response = await answered;
    expect(response.status(), 'das Speichern muss tatsächlich erfolgreich sein').toBe(200);
    const body = (await response.json()) as { avatarId?: string };
    expect(body.avatarId, 'die Compose-Antwort muss die neue Avatar-ID enthalten').toMatch(/^custom:/);

    const status = statusRegion(page);
    await expect(status).toBeVisible();

    // Eine neue Änderung macht den zuvor gespeicherten Status ungültig.
    await hairOption(page, 'bob').click();
    await expect(status).toHaveText('');
  });

  test('Bearbeitung während des Speicherns bekommt keinen gespeicherten Status', async ({
    freshTenant,
    loginAs,
    stack,
    request,
  }) => {
    const { page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });
    await openEditor(page);

    const gate = createGate();
    await page.route('**/me/avatar/compose', async (route) => {
      await gate.promise;
      await route.continue();
    });

    try {
      const answered = page.waitForResponse(
        (response) => response.url().includes('/me/avatar/compose') && response.request().method() === 'POST',
      );
      await saveButton(page).click();

      // Der Entwurf ändert sich, während der echte Speicherrequest noch angehalten ist.
      await hairOption(page, 'bob').click();

      gate.release();
      const response = await answered;
      expect(response.status(), 'das Speichern muss tatsächlich erfolgreich sein').toBe(200);

      // Der aktivierte Speicherknopf belegt die Verarbeitung der Antwort;
      // der Hook beendet saving erst nach seiner Statusänderung.
      await expect(saveButton(page)).toBeEnabled({ timeout: 30_000 });

      // Der inzwischen bearbeitete Entwurf darf nicht als gespeichert erscheinen.
      await expect(statusRegion(page)).toHaveText('');
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/compose');
    }
  });
});
