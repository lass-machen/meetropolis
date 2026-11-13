import { createApiRequest, MeetropolisApi } from '../support/api';
import { test, expect } from '../fixtures';
import { browserForTenant, confirmationLink, mailProofFixture, newEmail, signIn } from './mailProof.support';

test.use({ locale: 'de-DE', trace: 'off', screenshot: 'off', video: 'off' });

test('pending contract: a new registration stays outside the world until separate mailbox proof', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const email = newEmail();
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const invite = await fixture.invite(playwright.request, email);
    const invitation = await mailpit.waitForMail({ to: email, linkPattern: /invite=/ });
    const link = mailpit.extractLinks(invitation).find((candidate) => candidate.includes('invite='));
    if (!link) throw new Error('Invitation email is missing.');
    const page = await context.newPage();
    let registrations = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/auth/register')) registrations++;
    });
    await page.goto(link);
    await page.getByRole('button', { name: 'Registrieren', exact: true }).click();
    await page.getByLabel('Vorname').fill('Mailbox');
    await page.getByLabel('Nachname').fill('Testperson');
    await page.getByLabel('Geschäftliche E-Mail').fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(stack.userPassword);
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    const verifyLink = await confirmationLink(mailpit, email);
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    expect(registrations).toBe(1);
    expect(await fixture.membershipCount(email)).toBe(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    const mailBrowser = await browserForTenant(browser, stack, fixture.tenant.slug);
    try {
      const mailPage = await mailBrowser.newPage();
      await mailPage.goto(verifyLink);
      await expect(mailPage.getByRole('heading', { name: 'Einladung bestätigt' })).toBeVisible();
      expect(await fixture.membershipCount(email)).toBe(1);
      const used = await db.query('SELECT "usedAt" IS NOT NULL AS used FROM "Invite" WHERE "code"=$1', [invite.code]);
      expect(used.rows[0]?.used).toBe(true);
    } finally {
      await mailBrowser.close();
    }
    await page.getByRole('button', { name: 'Bestätigung prüfen', exact: true }).click();
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
        granted.tenantSlug === fixture.tenant.slug &&
        'role' in granted &&
        granted.role === 'member',
    ).toBe(true);
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

test('pending contract: an existing unverified account keeps its invitation after acceptance and reload', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account({ verified: false, member: false });
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const invitation = await fixture.invite(playwright.request, user.email);
    const page = await context.newPage();
    await page.goto(`${stack.baseUrl}/#/?invite=${invitation.code}`);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(user.email);
    await page.getByLabel('Passwort', { exact: true }).fill(user.password!);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await confirmationLink(mailpit, user.email);
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    expect(await fixture.membershipCount(user.email)).toBe(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    expect(await page.evaluate(() => !!sessionStorage.getItem('meetropolis.pendingInvite'))).toBe(true);
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

test('pending contract: a marked legacy membership requires proof after a correct login', async ({
  browser,
  stack,
  seed,
  db,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account();
  await fixture.mark(user);
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const page = await context.newPage();
    await signIn(page, stack, user);
    await confirmationLink(mailpit, user.email);
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    const result = await db.query('SELECT "inviteVerificationRequired" FROM "Membership" WHERE "userId"=$1', [
      user.userId,
    ]);
    expect(result.rows[0]?.inviteVerificationRequired).toBe(true);
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

test('pending contract: an existing marked session opens pending confirmation', async ({
  browser,
  stack,
  seed,
  db,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account();
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const login = await context.request.post(`${stack.apiUrl}/auth/login`, {
      data: { email: user.email, password: user.password },
    });
    if (!login.ok()) throw new Error(`Actual session creation: HTTP ${login.status()}`);
    await fixture.mark(user);
    const page = await context.newPage();
    await page.goto(`${stack.baseUrl}/#/app`);
    await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
    expect((await context.request.get(`${stack.apiUrl}/auth/me`)).status()).toBe(409);
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

test('accepts an invitation for a verified matching account without granting its role early', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const user = await fixture.account({ member: false });
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const invite = await fixture.invite(playwright.request, user.email);
    const login = await context.request.post(`${stack.apiUrl}/auth/login`, {
      data: { email: user.email, password: user.password },
    });
    expect(login.status()).toBe(200);
    expect(await fixture.membershipCount(user.email)).toBe(0);
    const accepted = await context.request.post(`${stack.apiUrl}/invites/accept`, { data: { code: invite.code } });
    expect(accepted.status()).toBe(200);
    expect(await fixture.membershipCount(user.email)).toBe(1);
    const me = await context.request.get(`${stack.apiUrl}/auth/me`);
    expect(me.status()).toBe(200);
    const body: unknown = await me.json();
    expect(!!body && typeof body === 'object' && 'tenantSlug' in body && body.tenantSlug === fixture.tenant.slug).toBe(
      true,
    );
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

test('shows the actual resend cooldown without automatically retrying the request', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
  mailpit,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const email = newEmail();
  const context = await browserForTenant(browser, stack, fixture.tenant.slug);
  try {
    const invite = await fixture.invite(playwright.request, email);
    const registered = await context.request.post(`${stack.apiUrl}/auth/register`, {
      data: { code: invite.code, email, password: stack.userPassword },
    });
    expect(registered.status()).toBe(409);
    await confirmationLink(mailpit, email);
    const page = await context.newPage();
    await page.goto(`${stack.baseUrl}/#/verify-pending`);
    let count = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/auth/verify/request')) count++;
    });
    const response = page.waitForResponse((response) => response.url().endsWith('/auth/verify/request'));
    await page.getByRole('button', { name: 'Bestätigungsmail erneut anfordern' }).click();
    expect((await response).status()).toBe(429);
    await expect(page.getByRole('status')).toContainText('Sekunden');
    expect(count).toBe(1);
    await expect(page.getByRole('button', { name: 'Bestätigungsmail erneut anfordern' })).toBeDisabled();
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});

for (const action of ['expire', 'revoke']) {
  test(`grants no access after ${action} during pending verification`, async ({
    browser,
    playwright,
    stack,
    seed,
    db,
    mailpit,
  }) => {
    const fixture = mailProofFixture(db, seed, stack);
    const email = newEmail();
    const context = await browserForTenant(browser, stack, fixture.tenant.slug);
    const mailBrowser = await browserForTenant(browser, stack, fixture.tenant.slug);
    try {
      const invite = await fixture.invite(playwright.request, email);
      expect(
        (
          await context.request.post(`${stack.apiUrl}/auth/register`, {
            data: { code: invite.code, email, password: stack.userPassword },
          })
        ).status(),
      ).toBe(409);
      const link = await confirmationLink(mailpit, email);
      if (action === 'expire')
        await db.query(
          `UPDATE "EmailVerification" SET "expiresAt"=now()-interval '1 second' WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email"=$1)`,
          [email],
        );
      else await db.query('DELETE FROM "Invite" WHERE "code"=$1', [invite.code]);
      const page = await mailBrowser.newPage();
      await page.goto(link);
      await expect(
        page.getByText(
          'Dieser Link ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere eine neue Bestätigung an.',
        ),
      ).toBeVisible();
      expect(await fixture.membershipCount(email)).toBe(0);
    } finally {
      await context.close();
      await mailBrowser.close();
      await fixture.cleanup();
    }
  });
}

test('fixture contract: completes new registration and existing-account acceptance through the real mailbox', async ({
  playwright,
  stack,
  seed,
  db,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  try {
    for (const existing of [false, true]) {
      const account = existing ? await fixture.account({ verified: false, member: false }) : null;
      const email = account?.email ?? newEmail();
      const invite = await fixture.invite(playwright.request, email);
      const context = await createApiRequest(playwright.request, stack.apiUrl, fixture.tenant.slug);
      try {
        // This context deliberately starts without an authenticated cookie.
        const api = new MeetropolisApi(context, stack.apiUrl, fixture.tenant.slug);
        const me = await api.registerWithInvite({
          code: invite.code,
          email,
          name: 'Mailbox test user',
          password: account?.password ?? stack.userPassword,
        });
        expect(me.tenantSlug).toBe(fixture.tenant.slug);
        expect(me.role).toBe('member');
        expect(await fixture.membershipCount(email)).toBe(1);
        const verified = await db.query(
          'SELECT "emailVerifiedAt" IS NOT NULL AS verified FROM "User" WHERE "email"=$1',
          [email],
        );
        expect(verified.rows[0]?.verified).toBe(true);
      } finally {
        await context.dispose();
      }
    }
  } finally {
    await fixture.cleanup();
  }
});

test('fixture contract: rejects wrong credentials before accepting an existing account invitation', async ({
  playwright,
  stack,
  seed,
  db,
}) => {
  const fixture = mailProofFixture(db, seed, stack);
  const account = await fixture.account({ verified: false, member: false });
  const invite = await fixture.invite(playwright.request, account.email);
  const context = await createApiRequest(playwright.request, stack.apiUrl, fixture.tenant.slug);
  try {
    const api = new MeetropolisApi(context, stack.apiUrl, fixture.tenant.slug);
    await expect(
      api.registerWithInvite({
        code: invite.code,
        email: account.email,
        name: 'Mailbox test user',
        password: 'incorrect-password',
      }),
    ).rejects.toThrow('/auth/login: HTTP 401.');
    expect(await fixture.membershipCount(account.email)).toBe(0);
    const unchanged = await db.query('SELECT "usedAt" IS NULL AS unused FROM "Invite" WHERE "code"=$1', [invite.code]);
    expect(unchanged.rows[0]?.unused).toBe(true);
  } finally {
    await context.dispose();
    await fixture.cleanup();
  }
});
