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
    const [{ page }] = await roomUsers(1, { permissions: ['denied'] });

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
