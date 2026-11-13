import { Client } from 'pg';

import { expect, test as base } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

import { MeetropolisApi, type TestUser } from '../support/api';
import { createMailpitClient } from '../support/mailpit';
import { provideStackControl } from './stackControl';
import { createFreshTenant } from './tenant';
import { appRouteUrl, readSeedFile, requiredEnv, TESTSTACK_ENV_MESSAGE, passwordFor } from './helpers';
import { provideRoomUsers } from './roomUsers';
import type { Fixtures, TestStackEnv } from './types';

export type {
  Edition,
  MediaPermission,
  RoomUser,
  RoomUserOptions,
  RoomUsersFactory,
  StackControl,
  StackService,
  TestStackEnv,
} from './types';
export { expect };

export const test = base.extend<Fixtures>({
  stack: async ({}, provide) => {
    const edition = requiredEnv('MT_EDITION');
    if (edition !== 'ee' && edition !== 'oss') throw new Error(TESTSTACK_ENV_MESSAGE);
    const stack: TestStackEnv = {
      baseUrl: requiredEnv('E2E_BASE_URL'),
      apiUrl: requiredEnv('E2E_API_URL'),
      databaseUrl: requiredEnv('DATABASE_URL'),
      mailpitUrl: requiredEnv('MAILPIT_URL'),
      livekitUrl: requiredEnv('LIVEKIT_URL'),
      livekitApiKey: requiredEnv('LIVEKIT_API_KEY'),
      livekitApiSecret: requiredEnv('LIVEKIT_API_SECRET'),
      seedFile: requiredEnv('E2E_SEED_FILE'),
      operatorEmail: requiredEnv('E2E_OPERATOR_EMAIL'),
      operatorPassword: requiredEnv('E2E_OPERATOR_PASSWORD'),
      userPassword: requiredEnv('E2E_USER_PASSWORD'),
      edition,
      project: requiredEnv('MT_PROJECT'),
    };
    await provide(stack);
  },

  seed: async ({ stack }, provide) => {
    await provide(await readSeedFile(stack.seedFile));
  },

  freshTenant: async ({ playwright, stack }, provide, testInfo) => {
    testInfo.skip(stack.edition === 'oss', 'freshTenant braucht Enterprise (Mandanten)');
    await provide(await createFreshTenant(playwright.request, stack, testInfo.testId));
  },

  loginAs: async ({ browser, browserName, stack }, provide) => {
    const contexts: BrowserContext[] = [];
    try {
      await provide(async (user: TestUser) => {
        const context = await browser.newContext({
          baseURL: stack.baseUrl,
          extraHTTPHeaders: { 'x-tenant': user.tenantSlug },
          ...(browserName === 'firefox' ? {} : { permissions: ['camera', 'microphone'] }),
        });
        contexts.push(context);
        const page = await context.newPage();
        if (user.role === 'guest') {
          if (!user.guestUrl) throw new Error(`Gast ${user.email} hat keinen Magic-Link.`);
          await page.goto(user.guestUrl);
          await page.waitForURL(/#\/app(?:$|\?)/);
        } else {
          const api = new MeetropolisApi(context.request, stack.apiUrl, user.tenantSlug);
          await api.login(user.email, passwordFor(user));
          await page.goto(appRouteUrl(stack.baseUrl, 'app'));
        }
        await expect(page.getByRole('complementary').getByText(user.displayName, { exact: true })).toBeVisible({
          timeout: 60_000,
        });
        return { context, page };
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },

  roomUsers: async ({ browser, browserName, playwright, seed, stack }, provide, testInfo) => {
    await provideRoomUsers({
      browser,
      browserName,
      browserTypes: playwright,
      playwrightRequest: playwright.request,
      seed,
      stack,
      testInfo,
      provide,
    });
  },

  mailpit: async ({ request, stack }, provide) => {
    await provide(createMailpitClient(request, stack.mailpitUrl));
  },

  stackControl: async ({ stack }, provide) => {
    await provideStackControl({ stack, provide });
  },

  db: async ({ stack }, provide) => {
    const client = new Client({ connectionString: stack.databaseUrl });
    await client.connect();
    try {
      await provide(client);
    } finally {
      await client.end();
    }
  },
});
