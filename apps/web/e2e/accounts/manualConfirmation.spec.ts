import { createApiRequest, MeetropolisApi } from '../support/api';
import { test, expect } from '../fixtures';
import { browserForTenant, mailProofFixture, newEmail } from './mailProof.support';

test.use({ locale: 'de-DE', trace: 'off', screenshot: 'off', video: 'off' });

test('manual confirmation: registration waits for a super admin, who confirms it in the admin overlay, then sign-in reaches the tenant', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
  loginAs,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const email = newEmail();
  fixture.trackEmail(email);
  const operator = seed.operator;
  const operatorRequest = await createApiRequest(playwright.request, stack.apiUrl, operator.tenantSlug);
  try {
    const operatorApi = new MeetropolisApi(operatorRequest, stack.apiUrl, operator.tenantSlug);
    await operatorApi.login(operator.email, operator.password ?? stack.operatorPassword);
    const pending = await operatorRequest.get(`${stack.apiUrl}/admin/pending-confirmations`);
    test.skip(
      pending.status() === 409,
      'Requires a server with manual account confirmation enabled and no delivering mail provider.',
    );
    if (!pending.ok()) throw new Error(`GET /admin/pending-confirmations: HTTP ${pending.status()}.`);
    const invite = await operatorApi.invite(email, 'member');

    const context = await browserForTenant(browser, stack, operator.tenantSlug);
    try {
      const page = await context.newPage();
      await page.goto(`${stack.baseUrl}/#/?invite=${invite.code}`);
      await page.getByRole('button', { name: 'Registrieren', exact: true }).click();
      await page.getByLabel('Vorname').fill('Manual');
      await page.getByLabel('Nachname').fill('Testperson');
      await page.getByLabel('Geschäftliche E-Mail').fill(email);
      await page.getByLabel('Passwort', { exact: true }).fill(stack.userPassword);
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
      await expect(
        page.getByText('Dein Konto wartet auf die Bestätigung durch eine Administratorin oder einen Administrator.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Bestätigungsmail erneut anfordern' })).toHaveCount(0);
      expect(await fixture.membershipCount(email)).toBe(0);

      const admin = await loginAs(operator);
      await admin.page.getByRole('button', { name: 'Menü', exact: true }).click();
      await admin.page.getByRole('menuitem', { name: 'Admin', exact: true }).click();
      await admin.page.getByRole('button', { name: 'Offene Bestätigungen', exact: true }).click();
      const row = admin.page.getByRole('row').filter({ hasText: email });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Bestätigen', exact: true }).click();
      await expect(row).toHaveCount(0);

      await page.getByRole('button', { name: 'Zur Anmeldung', exact: true }).click();
      await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
      await page.getByLabel('Passwort', { exact: true }).fill(stack.userPassword);
      await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
      await page.waitForURL(/#\/app(?:$|\?)/);
      const me = await context.request.get(`${stack.apiUrl}/auth/me`);
      expect(me.status()).toBe(200);
      const granted: unknown = await me.json();
      expect(
        !!granted &&
          typeof granted === 'object' &&
          'tenantSlug' in granted &&
          granted.tenantSlug === operator.tenantSlug &&
          'role' in granted &&
          granted.role === 'member',
      ).toBe(true);
    } finally {
      await context.close();
    }
  } finally {
    await operatorRequest.dispose();
    await fixture.cleanup();
  }
});
