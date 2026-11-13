import { defineConfig, devices } from '@playwright/test';
import type { Project } from '@playwright/test';

/**
 * Visual baselines for the OSS surfaces (Q-UX).
 *
 * Own config instead of a second one in the Q-TEST config: that file owns
 * apps/web/e2e/{fixtures,support,smoke} and must not be touched. The media
 * flags and the base URL handling are taken over from it so both suites talk
 * to the same slot in the same way.
 */

const mediaFlags = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
];

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const projects: Project[] = [
  {
    name: 'chromium-desktop',
    use: {
      ...devices['Desktop Chrome'],
      viewport: DESKTOP_VIEWPORT,
      launchOptions: { args: mediaFlags },
      permissions: ['camera', 'microphone'],
    },
  },
  {
    name: 'chromium-mobile',
    use: {
      ...devices['Pixel 5'],
      viewport: MOBILE_VIEWPORT,
      screen: MOBILE_VIEWPORT,
      // 1 keeps the PNG at exactly 390x844, the viewport the baseline is named
      // after. The Pixel descriptor would otherwise scale by 2.75.
      deviceScaleFactor: 1,
      launchOptions: { args: mediaFlags },
      permissions: ['camera', 'microphone'],
    },
  },
];

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // The Q-TEST root config also finds **/*.spec.ts. This marker is what the
  // suite checks: without it the visual specs would run under the root config
  // and write OSS baselines from an EE or Brand build.
  metadata: { ossVisualSuite: true },
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retry: a flaky baseline is a defect to fix, not something to paper over.
  retries: 0,
  workers: 1,
  reporter: [['list']],
  // Project and platform suffix keep the baselines of the two viewports apart
  // on every machine.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{-projectName}{-platform}{-snapshotSuffix}{ext}',
  use: {
    baseURL: process.env.E2E_BASE_URL || process.env.WEB_BASE_URL || 'http://localhost:5173',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects,
});
