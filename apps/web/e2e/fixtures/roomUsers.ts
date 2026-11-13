import type { Browser, BrowserContext, BrowserType, TestInfo } from '@playwright/test';
import type { APIRequest } from '@playwright/test';

import { MeetropolisApi } from '../support/api';
import type { FreshTenant, SeedData, TestUser } from '../support/api';
import type { TestStackEnv, MediaPermission, RoomUser, RoomUsersFactory } from './types';
import { appRouteUrl, getSeedTenant, passwordFor, pickUsers, waitForParticipant } from './helpers';
import { createFreshTenant } from './tenant';

type BrowserTypes = { chromium: BrowserType; firefox: BrowserType; webkit: BrowserType };

export async function provideRoomUsers(args: {
  browser: Browser;
  browserName: string;
  browserTypes: BrowserTypes;
  playwrightRequest: APIRequest;
  seed: SeedData;
  stack: TestStackEnv;
  testInfo: TestInfo;
  provide: (factory: RoomUsersFactory) => Promise<void>;
}): Promise<void> {
  const contexts: BrowserContext[] = [];
  const ownedBrowsers: Browser[] = [];
  let defaultTenantPromise: Promise<FreshTenant> | undefined;
  const browserType =
    args.browserName === 'firefox'
      ? args.browserTypes.firefox
      : args.browserName === 'webkit'
        ? args.browserTypes.webkit
        : args.browserTypes.chromium;

  const createRoomUser = async (user: TestUser, permission: MediaPermission, join: boolean): Promise<RoomUser> => {
    const separateBrowser = permission !== 'granted';
    let targetBrowser = args.browser;
    if (separateBrowser) {
      const launchOptions = {
        ...(args.browserName === 'chromium' ? { args: ['--use-fake-device-for-media-stream'] } : {}),
        ...(args.testInfo.project.name === 'chrome' ? { channel: 'chrome' as const } : {}),
      };
      targetBrowser = await browserType.launch(launchOptions);
      ownedBrowsers.push(targetBrowser);
    }

    const context = await targetBrowser.newContext({
      baseURL: args.stack.baseUrl,
      extraHTTPHeaders: { 'x-tenant': user.tenantSlug },
      ...(!separateBrowser && args.browserName !== 'firefox' ? { permissions: ['camera', 'microphone'] } : {}),
    });
    contexts.push(context);
    if (permission === 'denied' && args.browserName !== 'firefox') {
      await context.grantPermissions([], { origin: new URL(args.stack.baseUrl).origin });
    }

    const api = new MeetropolisApi(context.request, args.stack.apiUrl, user.tenantSlug);
    const page = await context.newPage();
    if (user.role === 'guest') {
      if (!user.guestUrl) throw new Error(`Gast ${user.email} hat keinen Magic-Link.`);
      if (join) {
        await page.goto(user.guestUrl);
        await page.waitForURL(/#\/app(?:$|\?)/);
      } else {
        await api.loginGuest(user.guestUrl);
      }
    } else {
      await api.login(user.email, passwordFor(user));
      if (join) await page.goto(appRouteUrl(args.stack.baseUrl, 'app'));
    }
    return { user, context, page };
  };

  try {
    await args.provide(async (n, options = {}) => {
      const join = options.join !== false;
      if (!options.tenant && args.stack.edition === 'oss') {
        args.testInfo.skip(true, 'freshTenant braucht Enterprise (Mandanten)');
      }
      const tenant =
        options.tenant === 'seed'
          ? getSeedTenant(args.seed)
          : (options.tenant ??
            (await (defaultTenantPromise ??= createFreshTenant(
              args.playwrightRequest,
              args.stack,
              args.testInfo.testId,
            ))));
      const users = pickUsers(tenant, n, options.roles);
      const permissions = users.map((_user, index) => options.permissions?.[index] ?? 'granted');
      if (options.permissions && options.permissions.length !== n) {
        throw new Error('roomUsers benötigt genau einen Permission-Status je Nutzer.');
      }

      const roomUsers =
        options.joinOrder === 'parallel'
          ? await Promise.all(users.map((user, index) => createRoomUser(user, permissions[index] ?? 'granted', join)))
          : [];
      if (options.joinOrder !== 'parallel') {
        for (const [index, user] of users.entries()) {
          roomUsers.push(await createRoomUser(user, permissions[index] ?? 'granted', join));
        }
      }

      if (join) {
        await Promise.all(
          roomUsers.map((viewer) =>
            Promise.all(
              roomUsers.filter((other) => other !== viewer).map((other) => waitForParticipant(viewer.page, other.user)),
            ),
          ),
        );
      }
      return roomUsers;
    });
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await Promise.all(ownedBrowsers.map((ownedBrowser) => ownedBrowser.close()));
    }
  }
}
