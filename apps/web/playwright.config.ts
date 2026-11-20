import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';
import type { Project } from '@playwright/test';

const mediaFlags = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
];

const projects: Project[] = [
  ...(process.env.MT_SEED === '1'
    ? [
        {
          name: 'seed',
          testMatch: /support\/seed\.setup\.ts/,
        },
      ]
    : []),
  {
    name: 'chromium',
    grepInvert: /@stack/,
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: mediaFlags },
      permissions: ['camera', 'microphone'],
    },
    // measured 2026-11-06 via npm -w @meetropolis/web run e2e:probe
    metadata: {
      capabilities: {
        getUserMediaAudio: true,
        audioNonSilent: true,
        getUserMediaVideo: true,
        getDisplayMedia: true,
        webrtcLoopback: true,
        screenShareAudio: true,
      },
    },
  },
  {
    name: 'chrome',
    grepInvert: /@stack/,
    use: {
      ...devices['Desktop Chrome'],
      channel: 'chrome',
      launchOptions: { args: mediaFlags },
      permissions: ['camera', 'microphone'],
    },
    // measured 2026-11-06 via npm -w @meetropolis/web run e2e:probe
    metadata: {
      capabilities: {
        getUserMediaAudio: true,
        audioNonSilent: true,
        getUserMediaVideo: true,
        getDisplayMedia: true,
        webrtcLoopback: true,
        screenShareAudio: true,
      },
    },
  },
  {
    name: 'firefox',
    grepInvert: /@stack/,
    use: {
      ...devices['Desktop Firefox'],
      launchOptions: {
        firefoxUserPrefs: {
          'media.navigator.streams.fake': true,
          'media.navigator.permission.disabled': true,
        },
      },
    },
    // measured 2026-11-06 via npm -w @meetropolis/web run e2e:probe
    metadata: {
      capabilities: {
        getUserMediaAudio: false,
        audioNonSilent: false,
        getUserMediaVideo: true,
        getDisplayMedia: true,
        webrtcLoopback: true,
        screenShareAudio: false,
      },
    },
  },
  {
    name: 'webkit',
    grepInvert: /@stack/,
    use: {
      ...devices['Desktop Safari'],
      permissions: ['camera', 'microphone'],
    },
    // measured 2026-11-06 via npm -w @meetropolis/web run e2e:probe
    metadata: {
      capabilities: {
        getUserMediaAudio: true,
        audioNonSilent: false,
        getUserMediaVideo: true,
        getDisplayMedia: true,
        webrtcLoopback: true,
        screenShareAudio: false,
      },
    },
  },
  ...(existsSync('/Applications/Microsoft Edge.app')
    ? [
        {
          name: 'msedge',
          grepInvert: /@stack/,
          use: {
            channel: 'msedge' as const,
            launchOptions: { args: mediaFlags },
            permissions: ['camera', 'microphone'],
          },
          // measured 2026-11-06 via npm -w @meetropolis/web run e2e:probe
          metadata: {
            capabilities: {
              getUserMediaAudio: false,
              audioNonSilent: false,
              getUserMediaVideo: false,
              getDisplayMedia: false,
              webrtcLoopback: false,
              screenShareAudio: false,
            },
          },
        },
      ]
    : []),
  // @stack specs pause shared stack containers, so they run once, in a single project with one worker.
  {
    name: 'stack',
    grep: /@stack/,
    workers: 1,
    retries: 0,
    fullyParallel: false,
    use: { ...devices['Desktop Chrome'] },
  },
];

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.MT_PROBE === '1' ? '**/support/capabilities.probe.ts' : '**/*.spec.ts',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || process.env.WEB_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects,
});
