import type { Page, TestInfo } from '@playwright/test';

import {
  TENANT_SETTINGS_TABS,
  openMapEditor,
  openTenantSettings,
  openWorld,
  selectTenantSettingsTab,
} from './appVisualHelpers';
import { test } from './visualActor';
import { THEMES, captureSurface, guardOssVisualSuite, prepareSurface, runAxe } from './visualHelpers';

// Explicit per file: a guard registered at module level in visualActor.ts only
// reached the first spec that imported it (module cache).
guardOssVisualSuite(test);

/**
 * The order is the contract: the surface is brought into its stable state
 * first, then axe measures that state, then the picture is taken. A theme
 * switch still runs its colour transitions, and axe would measure those
 * intermediate colours.
 */
async function recordSurface(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await prepareSurface(page);
  await runAxe(page, testInfo);
  await captureSurface(page, name);
}

for (const theme of THEMES) {
  test.describe(`app surfaces (${theme})`, () => {
    test.use({ colorScheme: theme });

    test('world with hud and roster', async ({ page, stack, visualActor }, testInfo) => {
      await openWorld(page, stack, visualActor, theme);
      await recordSurface(page, testInfo, `world-${theme}`);
    });

    test('map editor on the standard tab', async ({ page, stack, visualActor }, testInfo) => {
      await openWorld(page, stack, visualActor, theme);
      await openMapEditor(page);
      await recordSurface(page, testInfo, `map-editor-general-${theme}`);
    });

    for (const tab of TENANT_SETTINGS_TABS) {
      test(`organization settings: ${tab.key}`, async ({ page, stack, visualActor }, testInfo) => {
        await openWorld(page, stack, visualActor, theme);
        await openTenantSettings(page);
        await selectTenantSettingsTab(page, tab.index);
        await recordSurface(page, testInfo, `organization-settings-${tab.key}-${theme}`);
      });
    }
  });
}
