import { test, expect } from '../fixtures';

const devices = [
  {
    name: 'microphone',
    label: /Mikrofon|microphone/i,
    icons: 'svg.lucide-mic, svg.lucide-mic-off',
  },
  {
    name: 'camera',
    label: /Kamera|camera/i,
    icons: 'svg.lucide-video, svg.lucide-video-off',
  },
];

for (const device of devices) {
  test(`Denied ${device.name} access explains the failure and leaves capture off`, async ({ roomUsers }) => {
    const [{ page, user }] = await roomUsers(1, { permissions: ['denied'] });

    // A fresh user sees the onboarding wizard over the room on first sign-in;
    // it intercepts clicks on the AV bar. Complete it with "Get started"
    // (onboarding.cta), as smoke/av-state.spec.ts does.
    const welcome = page.getByRole('heading', { name: `Welcome, ${user.displayName}!` });
    await expect(welcome).toBeVisible();
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await welcome.waitFor({ state: 'detached' });

    // DeviceSelector currently exposes the device through its icon. In
    // particular, the camera toggle has no accessible name yet.
    const toggle = page.locator('button.bg-button').filter({ has: page.locator(device.icons) });
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toHaveClass(/\bbg-btn-primary\b/);
    await toggle.click();

    const notice = page.getByRole('alert').filter({ hasText: device.label });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Berechtigung|Zugriff|permission|access/i);
    await expect(toggle).not.toHaveClass(/\bbg-btn-primary\b/);
  });
}
