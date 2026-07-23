import { test, expect } from '@playwright/test';

// TODO(TEST): E2E requires running web and server instances with auth.
// This test is a placeholder until the CI environment for editor
// interactions is ready.
// Acceptance criteria:
// - Paint floor/walls -> reload -> visible
// - Erase collision -> reload -> passable
// - Realtime update between two clients (<1s)

test.skip('Map-Editor v2-only persists ground/walls/collision via chunks', async ({ page }) => {
  await page.goto('http://localhost:5173');
  // Login, opening the editor, paint/erase, and reload would be verified here.
  // See TODO(TEST) above; will be enabled once a test backend is available in CI.
  expect(true).toBeTruthy();
});
