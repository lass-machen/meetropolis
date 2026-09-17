import { expect, test } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_RUN === 'true';
const it = SHOULD_RUN ? test : test.skip;

it('shows a useful body tab without a body-shape picker', async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem('i18nextLng', 'de'));
  await page.route('**/public/config', (route) =>
    route.fulfill({
      json: { publicRegistrationEnabled: true, billingEnabled: false, avatarEditorEnabled: true },
    }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      json: {
        id: 'preview-user',
        email: 'preview@example.com',
        name: 'Vorschau',
        onboardingCompleted: false,
        emailVerified: true,
        lastPosition: { x: 320, y: 240, mapName: 'default' },
      },
    }),
  );
  await page.route('**/maps', (route) => route.fulfill({ json: [] }));
  await page.route('**/avatar-packs', (route) => route.fulfill({ json: [] }));
  await page.route('**/me/avatar/custom', (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));

  await page.goto('/#/app');
  await page.getByRole('button', { name: 'Eigenen erstellen' }).click();

  await expect(page.getByRole('button', { name: 'Körper' })).toHaveClass(/sys-tabs__tab--active/);
  await expect(page.locator('.av-ed__slot-label')).toHaveText(['Hautton', 'Gesicht', 'Frisur', 'Haarfarbe']);
  await expect(page.getByText('Körperform', { exact: true })).toHaveCount(0);
  await expect(page.locator('.av-ed__slots')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor-koerper-kompakt.png'), fullPage: true });
});
