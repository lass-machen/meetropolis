import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: { baseURL: 'http://127.0.0.1:5190', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/touch.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1100 },
      },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5190',
    url: 'http://127.0.0.1:5190',
    reuseExistingServer: false,
  },
});
