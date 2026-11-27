import type { Browser, BrowserContext, BrowserType, TestInfo } from '@playwright/test';
import type { APIRequest } from '@playwright/test';

import { MeetropolisApi } from '../support/api';
import type { FreshTenant, InviteRole, Role, SeedData, TestUser } from '../support/api';
import type { TestStackEnv, MediaPermission, RoomUser, RoomUsersFactory } from './types';
import { appRouteUrl, getSeedTenant, passwordFor, pickUsers, waitForParticipant } from './helpers';
import { createFreshTenant, createSeedTenantUsers } from './tenant';

function seedTenantRoles(n: number, roles?: Role[]): InviteRole[] {
  const selected: Role[] =
    roles ?? Array.from({ length: n }, (_value, index) => (index === 0 ? 'admin' : 'member') as Role);
  for (const role of selected) {
    if (role !== 'admin' && role !== 'member') throw new Error('tenant seed creates only admin or member users.');
  }
  return selected as InviteRole[];
}

type BrowserTypes = { chromium: BrowserType; firefox: BrowserType; webkit: BrowserType };

// Same media prefs as the firefox project in playwright.config.ts (keep both in
// sync). The teststack announces LiveKit with node_ip 127.0.0.1, and Firefox
// gathers no loopback ICE candidates unless media.peerconnection.ice.loopback
// is set (Mozilla bugs 831926 and 1659672); without it ICE fails.
const FIREFOX_MEDIA_PREFS = {
  'media.navigator.streams.fake': true,
  'media.navigator.permission.disabled': true,
  'media.peerconnection.ice.loopback': true,
};

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

  const createRoomUser = async (
    user: TestUser,
    permission: MediaPermission,
    join: boolean,
    separateBrowsers: boolean,
  ): Promise<RoomUser> => {
    const separateBrowser = separateBrowsers || permission !== 'granted';
    let targetBrowser = args.browser;
    if (separateBrowser) {
      // A granted user gets the project's own launch args (fake device and fake
      // UI). Without --use-fake-ui-for-media-stream the chromium headless shell
      // answers every media request with NotSupportedError, because its
      // WebContentsDelegate has no media permission handler. A denied user keeps
      // the fake device only, so the denial is not auto-accepted.
      const chromiumArgs =
        permission === 'granted'
          ? (args.testInfo.project.use.launchOptions?.args ?? [])
          : ['--use-fake-device-for-media-stream'];
      const launchOptions = {
        ...(args.browserName === 'chromium' ? { args: chromiumArgs } : {}),
        ...(args.browserName === 'firefox' ? { firefoxUserPrefs: FIREFOX_MEDIA_PREFS } : {}),
        ...(args.testInfo.project.name === 'chrome' ? { channel: 'chrome' as const } : {}),
      };
      targetBrowser = await browserType.launch(launchOptions);
      ownedBrowsers.push(targetBrowser);
    }

    const context = await targetBrowser.newContext({
      baseURL: args.stack.baseUrl,
      extraHTTPHeaders: { 'x-tenant': user.tenantSlug },
      ...(permission === 'granted' && args.browserName !== 'firefox' ? { permissions: ['camera', 'microphone'] } : {}),
    });
    contexts.push(context);
    if (permission === 'denied' && args.browserName !== 'firefox') {
      await context.grantPermissions([], { origin: new URL(args.stack.baseUrl).origin });
    }

    const api = new MeetropolisApi(context.request, args.stack.apiUrl, user.tenantSlug);
    const page = await context.newPage();
    if (user.role === 'guest') {
      if (!user.guestUrl) throw new Error(`Guest ${user.email} has no magic link.`);
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
      const separateBrowsers = options.separateBrowsers === true;
      if (!options.tenant && args.stack.edition === 'oss') {
        args.testInfo.skip(true, 'freshTenant requires the enterprise edition (tenants)');
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
      const users =
        options.tenant === 'seed'
          ? await createSeedTenantUsers(
              args.playwrightRequest,
              args.stack,
              args.seed,
              args.testInfo.testId,
              seedTenantRoles(n, options.roles),
            )
          : pickUsers(tenant, n, options.roles);
      const permissions = users.map((_user, index) => options.permissions?.[index] ?? 'granted');
      if (options.permissions && options.permissions.length !== n) {
        throw new Error('roomUsers needs exactly one permission state per user.');
      }

      const roomUsers =
        options.joinOrder === 'parallel'
          ? await Promise.all(
              users.map((user, index) => createRoomUser(user, permissions[index] ?? 'granted', join, separateBrowsers)),
            )
          : [];
      if (options.joinOrder !== 'parallel') {
        for (const [index, user] of users.entries()) {
          roomUsers.push(await createRoomUser(user, permissions[index] ?? 'granted', join, separateBrowsers));
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
