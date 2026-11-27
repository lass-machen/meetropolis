import crypto from 'node:crypto';
import type { APIRequest, Browser, BrowserContext, Page } from '@playwright/test';
import type { Client } from 'pg';
import type { TestStackEnv } from '../fixtures';
import type { SeedData, TestUser } from '../support/api';
import { createApiRequest, MeetropolisApi } from '../support/api';
import { getSeedTenant } from '../fixtures/helpers';
import type { MailpitClient } from '../support/mailpit';

export const newEmail = () => `fixture-account-${crypto.randomUUID()}@example.test`;
const id = () => `c${crypto.randomBytes(12).toString('hex')}`;

/**
 * The value an invite code is stored as: the server keeps only its SHA-256 hex
 * (apps/server/src/api/utils/inviteCode.ts), so a row is found by this, never by the raw code.
 */
export const storedInviteCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

/** Use real account records in the existing test database. */
export function mailProofFixture(db: Client, seed: SeedData, stack: TestStackEnv) {
  const url = new URL(stack.databaseUrl);
  // The test stack publishes each slot's database on 127.0.0.1 and passes the port as MT_PORT_DB;
  // all slot ports lie in 42000-42399, so no other local database can match.
  const assignedPort = process.env.MT_PORT_DB ?? '';
  const port = Number(url.port);
  if (
    url.hostname !== '127.0.0.1' ||
    assignedPort === '' ||
    url.port !== assignedPort ||
    !Number.isInteger(port) ||
    port < 42000 ||
    port > 42399
  )
    throw new Error('This test requires the test stack database assigned to its slot (MT_PORT_DB on 127.0.0.1).');
  const tenant = getSeedTenant(seed);
  const seedOwner = tenant.users.owner;
  if (!seedOwner) throw new Error('Seed contains no owner');
  // Bind the narrowed value so the hoisted helpers below see a defined owner.
  const owner = seedOwner;
  const emails: string[] = [];
  const extraTenants: string[] = [];
  async function account(options: { verified?: boolean; member?: boolean } = {}): Promise<TestUser> {
    const email = newEmail();
    emails.push(email);
    const userId = id();
    // Unique per account: parallel workers share the seed tenant, and loginAs finds the user
    // by display name in the presence list, which a shared name makes ambiguous.
    const displayName = `Mailbox test user ${userId.slice(-8)}`;
    const inserted = await db.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "emailVerifiedAt", "updatedAt", "onboardingCompleted")
      SELECT $1, $2, $5, "passwordHash", CASE WHEN $3 THEN now() ELSE NULL END, now(), true FROM "User" WHERE "id"=$4 RETURNING "id"`,
      [userId, email, options.verified !== false, owner.userId, displayName],
    );
    if (inserted.rowCount !== 1) throw new Error('Seed owner password hash is missing.');
    let tenantId = tenant.tenantId;
    let tenantSlug = tenant.slug;
    if (options.member === false) {
      tenantId = id();
      tenantSlug = `fixture-account-${crypto.randomUUID()}`;
      extraTenants.push(tenantId);
      await db.query('INSERT INTO "Tenant" ("id","slug","name","updatedAt") VALUES ($1,$2,$2,now())', [
        tenantId,
        tenantSlug,
      ]);
    }
    await db.query(
      'INSERT INTO "Membership" ("id","tenantId","userId","role","updatedAt") VALUES ($1,$2,$3,\'member\',now())',
      [id(), tenantId, userId],
    );
    return {
      userId,
      email,
      displayName,
      role: 'member',
      tenantSlug,
      password: owner.password ?? stack.userPassword,
    };
  }
  async function mark(user: TestUser) {
    await db.query('UPDATE "User" SET "emailVerifiedAt"=NULL WHERE "id"=$1', [user.userId]);
    await db.query('UPDATE "Membership" SET "inviteVerificationRequired"=true WHERE "userId"=$1 AND "tenantId"=$2', [
      user.userId,
      tenant.tenantId,
    ]);
    await db.query(
      `INSERT INTO "Invite" ("id","code","email","tenantId","role","usedAt","usedById","expiresAt")
      VALUES ($1,$2,$3,$4,'member',now(),$5,now()+interval '1 day')`,
      [id(), crypto.randomBytes(12).toString('hex'), user.email, tenant.tenantId, user.userId],
    );
  }
  async function invite(playwrightRequest: APIRequest, email: string) {
    if (!emails.includes(email)) emails.push(email);
    const request = await createApiRequest(playwrightRequest, stack.apiUrl, tenant.slug);
    try {
      const api = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
      await api.login(owner.email, owner.password ?? stack.userPassword);
      return await api.invite(email, 'member');
    } finally {
      await request.dispose();
    }
  }
  async function membershipCount(email: string) {
    const result = await db.query(
      'SELECT count(*)::int AS count FROM "Membership" m JOIN "User" u ON u."id"=m."userId" WHERE u."email"=$1 AND m."tenantId"=$2',
      [email, tenant.tenantId],
    );
    return Number(result.rows[0]?.count);
  }
  async function cleanup() {
    const users = await db.query('SELECT "id" FROM "User" WHERE "email"=ANY($1::text[])', [emails]);
    const ids = users.rows.map((row: { id: string }) => row.id);
    await db.query('DELETE FROM "EmailVerification" WHERE "userId"=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM "Invite" WHERE "email"=ANY($1::text[]) OR "usedById"=ANY($2::text[])', [emails, ids]);
    for (const table of ['Presence', 'PasswordReset', 'ApiToken', 'Session', 'Membership']) {
      await db.query(`DELETE FROM "${table}" WHERE "userId"=ANY($1::text[])`, [ids]);
    }
    await db.query('DELETE FROM "User" WHERE "id"=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM "Tenant" WHERE "id"=ANY($1::text[])', [extraTenants]);
  }
  return { tenant, account, mark, invite, membershipCount, cleanup, trackEmail: (email: string) => emails.push(email) };
}

export async function browserForTenant(browser: Browser, stack: TestStackEnv, slug: string): Promise<BrowserContext> {
  return browser.newContext({ baseURL: stack.baseUrl, locale: 'de-DE', extraHTTPHeaders: { 'X-Tenant': slug } });
}

export async function confirmationLink(mailpit: MailpitClient, email: string) {
  const mail = await mailpit.waitForMail({ to: email, linkPattern: /#\/verify\?token=/ });
  const link = mailpit.extractLinks(mail).find((candidate) => /#\/verify\?token=/.test(candidate));
  if (!link) throw new Error('Confirmation email contains no confirmation link.');
  return link;
}

export async function signIn(page: Page, stack: TestStackEnv, user: TestUser) {
  await page.goto(`${stack.baseUrl}/#/login`);
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(user.email);
  await page.getByLabel('Passwort', { exact: true }).fill(user.password ?? stack.userPassword);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
}

export async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Profil', exact: true }).click();
}
