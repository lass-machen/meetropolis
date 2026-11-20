import { expect, test } from '../fixtures';
import type { Page, TestInfo } from '@playwright/test';

import {
  THEMES,
  captureSurface,
  guardOssVisualSuite,
  openForgotSurface,
  openSurface,
  prepareSurface,
  runAxe,
} from './visualHelpers';

guardOssVisualSuite();

const ACCOUNT_EMAIL = 'ada.beispiel@example.test';
const ACCOUNT_PASSWORD = 'Sehr-Sicheres-Passwort-1';
const TEAM_NAME = 'Beispiel Team';

/** The team name is the only input with an icon in step 2. */
const TEAM_NAME_FIELD = 'form input.pub-input--with-icon';

/**
 * The OSS wizard has three steps. A fourth one only appears with billing
 * (closed-source), so the step count is the marker that says which wizard is
 * on screen.
 */
async function expectOssWizard(page: Page): Promise<void> {
  await expect(page.locator('.pub-step__circle')).toHaveCount(3);
}

async function fillAccountStep(page: Page): Promise<void> {
  await page.locator('input[name="given-name"]').fill('Ada');
  await page.locator('input[name="family-name"]').fill('Beispiel');
  await page.locator('input[name="email"]').fill(ACCOUNT_EMAIL);
  await page.locator('input[name="password"]').fill(ACCOUNT_PASSWORD);
}

/**
 * The submit of step 1 and step 2 only moves the wizard on (the handler of
 * the wizard writes into the local step state). The last step would create
 * the workspace against the server - that button is never pressed here.
 */
async function advanceWizard(page: Page): Promise<void> {
  await page.locator('form button[type="submit"]').first().click();
}

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
  test.describe(`auth surfaces (${theme})`, () => {
    test.use({ colorScheme: theme });

    test('login', async ({ page }, testInfo) => {
      await openSurface(page, theme, '/#/login');
      await expect(page.locator('form input[name="email"]')).toBeVisible();
      await expect(page.locator('form input[name="password"]')).toBeVisible();
      await recordSurface(page, testInfo, `login-${theme}`);
    });

    test('password forgotten', async ({ page }, testInfo) => {
      await openForgotSurface(page, theme);
      await expect(page.locator('form input[name="email"]')).toBeVisible();
      await recordSurface(page, testInfo, `forgot-password-${theme}`);
    });

    test('registration step 1: account', async ({ page }, testInfo) => {
      await openSurface(page, theme, '/#/register');
      await expect(page.locator('form input[name="given-name"]')).toBeVisible();
      await expectOssWizard(page);
      await recordSurface(page, testInfo, `register-step-1-${theme}`);
    });

    test('registration step 2: team', async ({ page }, testInfo) => {
      await openSurface(page, theme, '/#/register');
      await fillAccountStep(page);
      await advanceWizard(page);
      await expect(page.locator(TEAM_NAME_FIELD)).toBeVisible();
      await expect(page.locator('.pub-step__circle--completed')).toHaveCount(1);
      await expectOssWizard(page);
      await recordSurface(page, testInfo, `register-step-2-${theme}`);
    });

    test('registration step 3: finish', async ({ page }, testInfo) => {
      await openSurface(page, theme, '/#/register');
      await fillAccountStep(page);
      await advanceWizard(page);
      await page.locator(TEAM_NAME_FIELD).fill(TEAM_NAME);
      await advanceWizard(page);
      await expect(page.locator('.pub-step__circle--completed')).toHaveCount(2);
      await expectOssWizard(page);
      // The last step of the OSS wizard is not a form, it only offers to
      // create the workspace.
      await expect(page.locator('.pub-auth-layout__form-inner form')).toHaveCount(0);
      await recordSurface(page, testInfo, `register-step-3-${theme}`);
    });
  });
}
