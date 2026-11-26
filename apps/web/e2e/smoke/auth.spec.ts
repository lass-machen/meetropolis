import { test, expect } from '../fixtures';
import { createSeedTenantUsers } from '../fixtures/tenant';

test.use({ locale: 'en-US' });

test('member with wrong password sees an error and stays on login @smoke', async ({
  page,
  seed,
  stack,
  playwright,
}, testInfo) => {
  const [member] = await createSeedTenantUsers(playwright.request, stack, seed, testInfo.testId, ['member']);
  if (!member?.password) throw new Error('Seed tenant has no member with a password.');

  const loginUrl = new URL(stack.baseUrl);
  loginUrl.hash = '/login';
  await page.goto(loginUrl.toString());
  const loginForm = page.locator('form');
  await loginForm.locator('input[name="email"]').fill(member.email);
  await loginForm.locator('input[name="password"]').fill('wrong-password-12345!');
  await loginForm.locator('button[type="submit"]').click();

  // Server: 401 invalid_credentials (apps/server/src/api/routes/auth.signin.ts),
  // Client: apiError.invalid_credentials -> "Invalid credentials".
  await expect(page.getByText('Invalid credentials')).toBeVisible();
  await expect(page).not.toHaveURL(/#\/app$/);
});

test('member signs in and out through the UI @smoke', async ({ page, seed, stack, playwright }, testInfo) => {
  const [member] = await createSeedTenantUsers(playwright.request, stack, seed, testInfo.testId, ['member']);
  if (!member?.password) throw new Error('Seed tenant has no member with a password.');

  const loginUrl = new URL(stack.baseUrl);
  loginUrl.hash = '/login';
  await page.goto(loginUrl.toString());
  const loginForm = page.locator('form');
  await loginForm.locator('input[name="email"]').fill(member.email);
  await loginForm.locator('input[name="password"]').fill(member.password);
  await loginForm.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/#\/app$/);
  await expect(page.getByRole('complementary').getByText(member.displayName)).toBeVisible();

  // First sign-in of a fresh user: the onboarding wizard (WorldShell, onboardingCompleted
  // false) covers the room until "Get started" (onboarding.cta) completes it.
  const welcome = page.getByRole('heading', { name: `Welcome, ${member.displayName}!` });
  await expect(welcome).toBeVisible();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await welcome.waitFor({ state: 'detached' });

  // Sign out: menu button (topRightMenu.menu) -> "Log out" (topRightMenu.logout).
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await expect(page).toHaveURL(/#\/login/);
  await expect(page.locator('form input[name="email"]')).toBeVisible();

  // Without a valid session GET /auth/me answers 401 (handleAuthMe).
  const meResponse = await page.request.get(`${stack.apiUrl}/auth/me`);
  expect(meResponse.status()).toBe(401);
});
