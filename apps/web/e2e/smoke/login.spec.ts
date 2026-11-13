import { test, expect } from '../fixtures';
import type { SeedData } from '../support/api';

test.use({ locale: 'en-US' });

function seededTenant(seed: SeedData) {
  const tenant = seed.tenants.acme ?? seed.tenants.default ?? Object.values(seed.tenants)[0];
  if (!tenant) throw new Error('Seed-Datei enthält keinen Mandanten.');
  return tenant;
}

test('seed member signs in through the UI @smoke', async ({ page, seed, stack }) => {
  const member = seededTenant(seed).users.member;
  if (!member?.password) throw new Error('Seed-Mandant enthält keinen Member mit Passwort.');

  const loginUrl = new URL(stack.baseUrl);
  loginUrl.hash = '/login';
  await page.goto(loginUrl.toString());
  const loginForm = page.locator('form');
  await loginForm.locator('input[name="email"]').fill(member.email);
  await loginForm.locator('input[name="password"]').fill(member.password);
  await loginForm.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByRole('complementary').getByText(/Test Member/i)).toBeVisible();
});
