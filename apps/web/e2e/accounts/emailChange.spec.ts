import { test, expect } from '../fixtures';
import { browserForTenant, confirmationLink, mailProofFixture, newEmail, openProfile } from './mailProof.support';

test.use({ locale: 'de-DE', trace: 'off', screenshot: 'off', video: 'off' });

test('pending contract: an email change shows pending confirmation and keeps the old address active', async ({
  stack,
  seed,
  db,
  loginAs,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account();
  const target = newEmail();
  fixture.trackEmail(target);
  try {
    const { page } = await loginAs(user);
    await openProfile(page);
    await page.locator('input[type="email"]').fill(target);
    await page.getByRole('button', { name: 'Mailwechsel anfordern', exact: true }).click();
    await confirmationLink(mailpit, target);
    await mailpit.waitForMail({ to: user.email, subject: 'Email change requested' });
    await expect(page.getByText(/Bestätigungslink an .* gesendet/)).toBeVisible();
    const row = await db.query(
      'SELECT "email"=$2 AS unchanged, "emailVerifiedAt" IS NOT NULL AS verified FROM "User" WHERE "id"=$1',
      [user.userId, user.email],
    );
    expect(row.rows[0]).toEqual({ unchanged: true, verified: true });
  } finally {
    await fixture.cleanup();
  }
});

test('pending contract: a separate unauthenticated browser confirms the email change and offers the next action', async ({
  browser,
  stack,
  seed,
  db,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account();
  const target = newEmail();
  fixture.trackEmail(target);
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  const mailBrowser = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const login = await context.request.post(`${stack.apiUrl}/auth/login`, {
      data: { email: user.email, password: user.password },
    });
    if (!login.ok()) throw new Error('The actual login failed.');
    const change = await context.request.patch(`${stack.apiUrl}/me`, { data: { email: target } });
    if (change.status() !== 202) throw new Error(`Email-change HTTP prerequisite: ${change.status()}`);
    const link = await confirmationLink(mailpit, target);
    await mailpit.waitForMail({ to: user.email, subject: 'Email change requested' });
    const page = await mailBrowser.newPage();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'E-Mail-Adresse geändert' })).toBeVisible();
    const row = await db.query(
      'SELECT "email"=$2 AS changed, "emailVerifiedAt" IS NOT NULL AS verified FROM "User" WHERE "id"=$1',
      [user.userId, target],
    );
    expect(row.rows[0]).toEqual({ changed: true, verified: true });
    expect(page.url().includes('token=')).toBe(false);
    await page.getByRole('button', { name: 'Weiter zur Anmeldung oder zum Büro' }).click();
    await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  } finally {
    await context.close();
    await mailBrowser.close();
    await fixture.cleanup();
  }
});

test('@stack shows delivery failure without a partial email change during a real SMTP outage and restores delivery', async ({
  stack,
  seed,
  db,
  loginAs,
  mailpit,
  stackControl,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account();
  const target = newEmail();
  fixture.trackEmail(target);
  test.setTimeout(180_000);
  let paused = false;
  try {
    const { page } = await loginAs(user);
    await openProfile(page);
    await stackControl.pause('mailpit');
    paused = true;
    await page.locator('input[type="email"]').fill(target);
    const response = page.waitForResponse(
      (response) => response.url().endsWith('/me') && response.request().method() === 'PATCH',
      { timeout: 90_000 },
    );
    await page.getByRole('button', { name: 'Mailwechsel anfordern', exact: true }).click();
    expect((await response).status()).toBe(503);
    await expect(page.getByText(/could not be delivered|Verification request failed/)).toBeVisible();
    const row = await db.query('SELECT "email"=$2 AS unchanged FROM "User" WHERE "id"=$1', [user.userId, user.email]);
    expect(row.rows[0]?.unchanged).toBe(true);
    const proof = await db.query(
      'SELECT count(*)::int AS count FROM "EmailVerification" WHERE "userId"=$1 AND "readyAt" IS NOT NULL AND "usedAt" IS NULL',
      [user.userId],
    );
    expect(proof.rows[0]?.count).toBe(0);
    await stackControl.unpause('mailpit');
    paused = false;
    await page.getByRole('button', { name: 'Mailwechsel anfordern', exact: true }).click();
    await confirmationLink(mailpit, target);
    await expect(page.getByText(/Bestätigungslink an .* gesendet/)).toBeVisible();
  } finally {
    if (paused) await stackControl.unpause('mailpit');
    await fixture.cleanup();
  }
});
