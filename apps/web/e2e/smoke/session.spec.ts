import { test, expect } from '../fixtures';
import { createSeedTenantUsers } from '../fixtures/tenant';
import { waitForParticipant } from '../fixtures/helpers';

const CHROMIUM_ONLY = 'Runs on chromium and chrome only for now.';

function chromiumOnly(projectName: string): void {
  test.skip(!['chromium', 'chrome'].includes(projectName), CHROMIUM_ONLY);
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('second sign-in takes over the first session @smoke', async ({ loginAs, seed, stack, playwright }, testInfo) => {
  chromiumOnly(testInfo.project.name);
  const [member] = await createSeedTenantUsers(playwright.request, stack, seed, testInfo.testId, ['member']);
  if (!member) throw new Error('Seed tenant could not create a fresh member.');

  const a = await loginAs(member);
  const b = await loginAs(member);

  // a shows the takeover overlay (no auto-reconnect), b stays connected.
  await expect(a.page.getByText('Signed in on another device')).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByRole('button', { name: 'Reconnect here' })).toBeVisible({ timeout: 30_000 });
  await waitForParticipant(b.page, member);
});

test('offline client reconnects and roster recovers @smoke', async ({ roomUsers }, testInfo) => {
  chromiumOnly(testInfo.project.name);
  const [a, b] = await roomUsers(2, { tenant: 'seed' });
  if (!a || !b) throw new Error('roomUsers did not return two users.');

  const rosterButton = (displayName: string) =>
    b.page.getByRole('complementary').getByRole('button', { name: new RegExp(escapedRegex(displayName), 'i') });

  await a.context.setOffline(true);
  // While A is offline, B's roster moves A to the offline section
  // (the OnlineRow button disappears, only the OfflineRow div with lastSeen/unknown remains).
  await expect(rosterButton(a.user.displayName)).toBeHidden({ timeout: 30_000 });

  await a.context.setOffline(false);
  // After the reconnect (backoff starts at 1 s) both see each other again.
  await waitForParticipant(b.page, a.user);
  await waitForParticipant(a.page, b.user);
});
