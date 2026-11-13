import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '../fixtures';
import { createApiRequest } from '../support/api';
import { mailProofFixture } from './mailProof.support';

test.use({ locale: 'de-DE', trace: 'off', screenshot: 'off', video: 'off' });

/** Use the actual legacy build from 1402ee5+e592dbd. */
test('keeps a failed legacy code revocation visible while the invitation remains valid @legacy', async ({
  browser,
  playwright,
  stack,
  seed,
  db,
}) => {
  const legacyBase = process.env.LEGACY_WEB_BASE_URL;
  const manifestPath = process.env.LEGACY_WEB_BUNDLE_MANIFEST;
  if (!legacyBase || !manifestPath) throw new Error('Approved legacy build evidence is missing.');
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('revision' in manifest) ||
    manifest.revision !== '1402ee5+e592dbd' ||
    !('files' in manifest) ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  )
    throw new Error('Invalid legacy bundle evidence.');
  const expected = new Map(
    Object.entries(manifest.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const verified = new Set<string>();
  const mismatches: string[] = [];
  const fixture = mailProofFixture(db, seed, stack);
  const target = await fixture.account({ member: false });
  const invitation = await fixture.invite(playwright.request, target.email);
  const owner = fixture.tenant.users.owner;
  if (!owner) throw new Error('Seed owner is missing.');
  const context = await browser.newContext({
    baseURL: legacyBase,
    locale: 'de-DE',
    extraHTTPHeaders: { 'X-Tenant': fixture.tenant.slug },
  });
  const targetRequest = await createApiRequest(playwright.request, stack.apiUrl, fixture.tenant.slug);
  try {
    const login = await context.request.post(`${stack.apiUrl}/auth/login`, {
      data: { email: owner.email, password: owner.password ?? stack.userPassword },
    });
    if (!login.ok()) throw new Error('The actual owner login failed.');
    const page = await context.newPage();
    const checks: Promise<void>[] = [];
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      if (!expected.has(pathname)) return;
      checks.push(
        response.body().then((body) => {
          if (crypto.createHash('sha256').update(body).digest('hex') !== expected.get(pathname))
            mismatches.push(pathname);
          else verified.add(pathname);
        }),
      );
    });
    await page.goto(`${legacyBase}/#/app`);
    await page.getByRole('button', { name: 'Menü', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Organisation', exact: true }).click();
    await page.getByRole('button', { name: 'Einladungen', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: target.email });
    await expect(row).toBeVisible();
    const deleted = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && response.url().includes('/invites/'),
    );
    await row.getByRole('button', { name: 'Löschen', exact: true }).click();
    await page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
    const result = await deleted;
    expect(result.status()).toBe(400);
    const body: unknown = await result.json();
    expect(!!body && typeof body === 'object' && 'code' in body && body.code === 'invite_id_invalid').toBe(true);
    await expect(page.getByText('Einladung konnte nicht gelöscht werden', { exact: true })).toBeVisible();
    await expect(row).toBeVisible();
    const state = await db.query(
      'SELECT "usedAt" IS NULL AS valid, "expiresAt">now() AS unexpired FROM "Invite" WHERE "code"=$1',
      [invitation.code],
    );
    expect(state.rows[0]).toEqual({ valid: true, unexpired: true });
    const signedIn = await targetRequest.post(`${stack.apiUrl}/auth/login`, {
      data: { email: target.email, password: target.password },
    });
    expect(signedIn.status()).toBe(200);
    const accepted = await targetRequest.post(`${stack.apiUrl}/invites/accept`, { data: { code: invitation.code } });
    expect(accepted.status()).toBe(200);
    expect(await fixture.membershipCount(target.email)).toBe(1);
    await Promise.all(checks);
    expect(mismatches).toHaveLength(0);
    expect(verified.size).toBeGreaterThan(0);
  } finally {
    await context.close();
    await targetRequest.dispose();
    await fixture.cleanup();
  }
});
