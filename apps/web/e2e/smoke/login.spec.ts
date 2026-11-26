import { test, expect } from '../fixtures';
import { createSeedTenantUsers } from '../fixtures/tenant';

test.use({ locale: 'en-US' });

test('seed member signs in through the UI @smoke', async ({ page, seed, stack, playwright }, testInfo) => {
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
});
