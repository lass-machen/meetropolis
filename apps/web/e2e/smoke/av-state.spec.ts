import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures';

const CHROMIUM_ONLY = 'Runs on chromium and chrome only for now.';

test('microphone toggle reflects locally and remotely @smoke', async ({ roomUsers }, testInfo) => {
  test.skip(!['chromium', 'chrome'].includes(testInfo.project.name), CHROMIUM_ONLY);
  const [a, b] = await roomUsers(2, { tenant: 'seed' });
  if (!a || !b) throw new Error('roomUsers did not return two users.');

  // Count microphone badges only for the two participants created by this test.
  const ownMicrophoneOn = (page: Page) =>
    page
      .getByRole('button')
      .filter({
        has: page
          .getByText(a.user.displayName, { exact: true })
          .or(page.getByText(b.user.displayName, { exact: true })),
      })
      .getByTitle('Microphone on', { exact: true });

  // AVBar titles: on = "Mute microphone (...)", off = "Unmute microphone (...)".
  // The ^ anchor is required because "Unmute microphone" contains "Mute microphone".
  const micOnTitle = /^Mute microphone/;
  const micOffTitle = /^Unmute microphone/;

  // Fresh users see the onboarding wizard over the room on first sign-in; complete it
  // with "Get started" (onboarding.cta) before using the AV bar.
  for (const user of [a, b]) {
    const welcome = user.page.getByRole('heading', { name: `Welcome, ${user.user.displayName}!` });
    await expect(welcome).toBeVisible();
    await user.page.getByRole('button', { name: 'Get started', exact: true }).click();
    await welcome.waitFor({ state: 'detached' });
  }

  // Normalize both users to microphone off. Afterwards B's own tile shows
  // "Microphone off" and no "Microphone on" appears anywhere.
  for (const user of [a, b]) {
    const toggle = user.page.getByTitle(micOnTitle);
    if ((await toggle.count()) > 0) await toggle.first().click();
    await expect(user.page.getByTitle(micOffTitle)).toBeVisible({ timeout: 30_000 });
  }

  // A turns the microphone on: A's AVBar shows "Mute ...", both pages show
  // exactly one "Microphone on" tile (A), B's own tile stays "off".
  await a.page.getByTitle(micOffTitle).click();
  await expect(a.page.getByTitle(micOnTitle)).toBeVisible({ timeout: 30_000 });
  await expect(ownMicrophoneOn(a.page)).toHaveCount(1, { timeout: 30_000 });
  await expect(ownMicrophoneOn(b.page)).toHaveCount(1, { timeout: 30_000 });

  // A turns the microphone off: "Microphone off" everywhere again, "on" nowhere.
  await a.page.getByTitle(micOnTitle).click();
  await expect(a.page.getByTitle(micOffTitle)).toBeVisible({ timeout: 30_000 });
  await expect(ownMicrophoneOn(a.page)).toHaveCount(0, { timeout: 30_000 });
  await expect(ownMicrophoneOn(b.page)).toHaveCount(0, { timeout: 30_000 });
});
