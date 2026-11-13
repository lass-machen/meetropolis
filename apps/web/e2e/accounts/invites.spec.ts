import crypto from 'crypto';

import type { APIRequest, APIRequestContext, Page } from '@playwright/test';

import { test, expect } from '../fixtures';
import type { TestStackEnv } from '../fixtures';
import { getSeedTenant } from '../fixtures/helpers';
import { MeetropolisApi, createApiRequest } from '../support/api';
import type { TenantSeed } from '../support/api';
import type { Client } from 'pg';
import type { SeedData } from '../support/api';
import { mailProofFixture } from './mailProof.support';

test.use({ locale: 'de-DE' });

const PASSWORD = 'Qacc-E2E-Password-1';
const APP_URL = /#\/app(?:$|\?)/;

function uniqueEmail(): string {
  return `invite-${crypto.randomUUID()}@example.test`;
}

function inviteLinkFromMail(links: string[]): string {
  const link = links.find((candidate) => candidate.includes('invite='));
  if (!link) throw new Error('Invitation email contains no invitation link.');
  return link;
}

async function loginOwner(playwright: { request: APIRequest }, stack: TestStackEnv, tenant: TenantSeed) {
  const owner = tenant.users.owner;
  if (!owner) throw new Error(`Seed tenant ${tenant.slug} contains no owner.`);
  const request = await createApiRequest(playwright.request, stack.apiUrl, tenant.slug);
  const api = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
  await api.login(owner.email, owner.password ?? stack.userPassword);
  return { api, request };
}

async function readPreview(playwright: { request: APIRequest }, apiUrl: string, code: string) {
  const request: APIRequestContext = await playwright.request.newContext();
  try {
    const res = await request.post(`${apiUrl}/public/invites/preview`, { data: { code } });
    if (!res.ok()) throw new Error(`POST /public/invites/preview: HTTP ${res.status()}.`);
    return (await res.json()) as { tenantName: string; emailMasked: string; status: string };
  } finally {
    await request.dispose();
  }
}

async function readBrowserMe(page: Page, apiUrl: string): Promise<{ tenantSlug: string }> {
  return page.evaluate(async (url: string) => {
    const res = await fetch(`${url}/auth/me`, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET /auth/me: HTTP ${res.status}.`);
    return (await res.json()) as { tenantSlug: string };
  }, apiUrl);
}

async function existingNonMemberAccount(
  stack: TestStackEnv,
  seed: SeedData,
  tenant: TenantSeed,
  db: Client,
): Promise<{ email: string; password: string; dispose: () => Promise<void> }> {
  const other = Object.values(seed.tenants).find(
    (candidate) => candidate.slug !== tenant.slug && candidate.users.owner,
  );
  const secondOwner = other?.users.owner;
  if (secondOwner) {
    return {
      email: secondOwner.email,
      password: secondOwner.password ?? stack.userPassword,
      dispose: () => Promise.resolve(),
    };
  }
  const fixture = mailProofFixture(db, seed, stack);
  try {
    const account = await fixture.account({ member: false });
    return { email: account.email, password: account.password ?? stack.userPassword, dispose: fixture.cleanup };
  } catch (error: unknown) {
    await fixture.cleanup();
    throw error;
  }
}

test.describe('invitations end to end', () => {
  test('a new user registers from the invitation mail and lands in the tenant', async ({
    browser,
    playwright,
    stack,
    seed,
    mailpit,
    db,
  }) => {
    const tenant = getSeedTenant(seed);
    const { api: ownerApi, request: ownerRequest } = await loginOwner(playwright, stack, tenant);
    try {
      const email = uniqueEmail();
      const { code } = await ownerApi.invite(email, 'member');
      const mail = await mailpit.waitForMail({ to: email, linkPattern: /invite=/ });
      expect(mail.text).toMatch(/Die Einladung ist bis .* gültig\./);
      const link = inviteLinkFromMail(mailpit.extractLinks(mail));
      const preview = await readPreview(playwright, stack.apiUrl, code);

      const context = await browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await page.goto(link);
        await expect(page.getByRole('heading', { name: `Einladung zu ${preview.tenantName}` })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByText(`Die Einladung gilt für ${preview.emailMasked}.`)).toBeVisible();
        await page.getByRole('button', { name: 'Registrieren' }).click();
        await page.getByLabel('Vorname').fill('Ada');
        await page.getByLabel('Nachname').fill('Lovelace');
        await page.getByLabel('Geschäftliche E-Mail').fill(email);
        await page.getByLabel('Passwort').fill(PASSWORD);
        await page.getByRole('button', { name: 'Weiter' }).click();
        await expect(page.getByRole('heading', { name: 'Bitte bestätige deine E-Mail-Adresse' })).toBeVisible();
        const before = await db.query(
          'SELECT count(*)::int AS count FROM "Membership" m JOIN "User" u ON u."id"=m."userId" WHERE u."email"=$1 AND m."tenantId"=$2',
          [email, tenant.tenantId],
        );
        expect(before.rows[0]?.count).toBe(0);
        const proof = await mailpit.waitForMail({ to: email, linkPattern: /#\/verify\?token=/ });
        const verifyLink = mailpit.extractLinks(proof).find((candidate) => /#\/verify\?token=/.test(candidate));
        if (!verifyLink) throw new Error('The confirmation email contains no confirmation link.');
        const mailContext = await browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE' });
        try {
          const mailPage = await mailContext.newPage();
          await mailPage.goto(verifyLink);
          await expect(mailPage.getByRole('heading', { name: 'Einladung bestätigt' })).toBeVisible();
        } finally {
          await mailContext.close();
        }
        await page.getByRole('button', { name: 'Bestätigung prüfen', exact: true }).click();
        await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
        await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
        await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
        await page.waitForURL(APP_URL);
        const me = await readBrowserMe(page, stack.apiUrl);
        expect(me.tenantSlug).toBe(tenant.slug);
      } finally {
        await context.close();
      }
    } finally {
      await ownerRequest.dispose();
    }
  });

  test('an existing account accepts the invitation after signing in', async ({
    browser,
    playwright,
    stack,
    seed,
    mailpit,
    db,
  }) => {
    const tenant = getSeedTenant(seed);
    const { api: ownerApi, request: ownerRequest } = await loginOwner(playwright, stack, tenant);
    try {
      const account = await existingNonMemberAccount(stack, seed, tenant, db);
      try {
        await ownerApi.invite(account.email, 'member');
        const mail = await mailpit.waitForMail({ to: account.email, linkPattern: /invite=/ });
        const link = inviteLinkFromMail(mailpit.extractLinks(mail));

        const context = await browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE' });
        try {
          const page = await context.newPage();
          await page.goto(link);
          await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible({ timeout: 30_000 });
          await page.getByRole('button', { name: 'Anmelden' }).click();
          await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
          await page.getByLabel('E-Mail-Adresse').fill(account.email);
          await page.getByLabel('Passwort').fill(account.password);
          await page.getByRole('button', { name: 'Anmelden' }).click();
          await page.waitForURL(APP_URL);
          const me = await readBrowserMe(page, stack.apiUrl);
          expect(me.tenantSlug).toBe(tenant.slug);
        } finally {
          await context.close();
        }
      } finally {
        await account.dispose();
      }
    } finally {
      await ownerRequest.dispose();
    }
  });

  test('an expired invitation cannot be accepted', async ({ browser, playwright, stack, seed, db }) => {
    const tenant = getSeedTenant(seed);
    const { api: ownerApi, request: ownerRequest } = await loginOwner(playwright, stack, tenant);
    try {
      const email = uniqueEmail();
      const { code } = await ownerApi.invite(email, 'member');
      await db.query(
        `UPDATE "Invite" SET "expiresAt" = now() - interval '1 minute' WHERE "tenantId" = $1 AND "email" = $2`,
        [tenant.tenantId, email],
      );

      const context = await browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await page.goto(`${stack.baseUrl.replace(/\/+$/, '')}/#/?invite=${code}`);
        await expect(page.getByText('Diese Einladung ist abgelaufen. Bitte um eine neue Einladung.')).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByRole('button', { name: 'Einladung annehmen' })).toHaveCount(0);
      } finally {
        await context.close();
      }
    } finally {
      await ownerRequest.dispose();
    }
  });

  test('a revoked invitation is gone', async ({ browser, playwright, stack, seed, mailpit }) => {
    const tenant = getSeedTenant(seed);
    const { api: ownerApi, request: ownerRequest } = await loginOwner(playwright, stack, tenant);
    try {
      const email = uniqueEmail();
      await ownerApi.invite(email, 'member');
      const mail = await mailpit.waitForMail({ to: email, linkPattern: /invite=/ });
      const link = inviteLinkFromMail(mailpit.extractLinks(mail));

      const listRes = await ownerRequest.get(`${stack.apiUrl}/invites`);
      if (!listRes.ok()) throw new Error(`GET /invites: HTTP ${listRes.status()}.`);
      const entries = (await listRes.json()) as Array<{ id?: unknown; email?: unknown }>;
      const entry = entries.find(
        (candidate) => typeof candidate.email === 'string' && candidate.email.toLowerCase() === email,
      );
      if (!entry || typeof entry.id !== 'string') throw new Error('GET /invites does not contain the invitation.');
      const removal = await ownerRequest.delete(`${stack.apiUrl}/invites/${encodeURIComponent(entry.id)}`);
      expect(removal.status()).toBe(200);

      const context = await browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE' });
      try {
        const page = await context.newPage();
        await page.goto(link);
        await expect(page.getByText('Diese Einladung gibt es nicht oder sie wurde widerrufen.')).toBeVisible({
          timeout: 30_000,
        });
      } finally {
        await context.close();
      }
    } finally {
      await ownerRequest.dispose();
    }
  });
});
