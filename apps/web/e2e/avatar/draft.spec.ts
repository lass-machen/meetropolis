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

test.use({ locale: 'de-DE' });

/** Four real regressions of the avatar draft: delayed loading, network failure,
 * Status after a change and editing during saving. No API mocks. */
test.describe('Avatar-Entwurf @avatar', () => {
  test('delayed loading does not overwrite the new hairstyle', async ({ freshTenant, loginAs, stack, request }) => {
    const { context, page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });

    const storedHair = 'buzz';
    const chosenHair = 'bob';

    // The saved hairstyle must differ from the later selection.
    const composed = await composeAvatar({
      context,
      apiUrl: stack.apiUrl,
      tenantSlug: freshTenant.slug,
      hair: storedHair,
    });
    expect(composed.status, 'the saved avatar must be creatable').toBe(200);

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

      // The delayed response arrives only after the new selection.
      const answered = page.waitForResponse((response) => response.url().includes('/me/avatar/custom'));
      const downloaded = page.waitForEvent('requestfinished', (req) => req.url().includes('/me/avatar/custom'));
      gate.release();
      const response = await answered;
      expect(response.status(), 'the delayed fetch must return the saved avatar').toBe(200);
      await downloaded;
      await settle(page);

      // The selection stays in place even though the old saved response arrives.
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');
      await expect(hairOption(page, storedHair)).toHaveAttribute('aria-pressed', 'false');
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/custom');
    }
  });

  test('a real transport failure leaves no saveable replacement draft', async ({
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

      // The held request is forwarded after switching offline.
      // requestfailed confirms the real transport failure.
      const failed = page.waitForEvent('requestfailed', (req) => req.url().includes('/me/avatar/custom'));
      await context.setOffline(true);
      gate.release();
      const failure = await failed;
      expect(failure.failure(), 'the held request must fail at the transport level').not.toBeNull();

      // The editor reports its unavailability and offers no replacement draft to save.
      await expect(page.getByText('Editor nicht verfügbar')).toBeVisible({ timeout: 15_000 });
      expect(await saveButton(page).count(), 'no saveable replacement draft').toBe(0);
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/custom');
      await context.setOffline(false);
    }
  });

  test('a change removes the previously saved status', async ({
    freshTenant,
    loginAs,
    stack,
    request,
  }, testInfo) => {
    const { page } = await loginAs(freshTenant.users.owner);
    await requireAvatarEditorEnabled({ request, apiUrl: stack.apiUrl, tenantSlug: freshTenant.slug });
    await openEditor(page);

    // The body tab is the verified initial state of the editor. The anchors
    // are existing test anchors: sys-tabs__tab--active (Tabs.tsx:23) and
    // av-ed__grid--* (SlotPicker.tsx:55 as well as 100–103). The tabs carry neither
    // role=tab still aria-selected, so the class is checked and no
    // product A11y change. Order skin/face/hair/hair_color and the
    // color fields are in editorLayout.ts:22 and 30; the helper keeps both
    // hard-coded instead of importing them from the layout.
    await expectInitialBodyTab(page);

    // Before the first save, the empty status region is already in the DOM: it
    // occupies no space and stays reachable for assistive technology.
    await expectEmptyStatusRegion(page, testInfo);

    const answered = page.waitForResponse(
      (response) => response.url().includes('/me/avatar/compose') && response.request().method() === 'POST',
    );
    await saveButton(page).click();
    const response = await answered;
    expect(response.status(), 'the save must actually succeed').toBe(200);
    const body = (await response.json()) as { avatarId?: string };
    expect(body.avatarId, 'the compose response must contain the new avatar ID').toMatch(/^custom:/);

    const status = statusRegion(page);
    await expect(status).toBeVisible();

    // A new change invalidates the previously saved status.
    await hairOption(page, 'bob').click();
    await expect(status).toHaveText('');
  });

  test('editing during saving gets no saved status', async ({
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

      // The draft changes while the real save request is still held.
      await hairOption(page, 'bob').click();

      gate.release();
      const response = await answered;
      expect(response.status(), 'the save must actually succeed').toBe(200);

      // The enabled save button confirms that the response is being processed;
      // the hook ends saving only after its status change.
      await expect(saveButton(page)).toBeEnabled({ timeout: 30_000 });

      // The meanwhile edited draft must not appear as saved.
      await expect(statusRegion(page)).toHaveText('');
    } finally {
      gate.release();
      await page.unroute('**/me/avatar/compose');
    }
  });
});
