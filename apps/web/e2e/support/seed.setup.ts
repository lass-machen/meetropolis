import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { test } from '../fixtures';
import { createApiRequest, MeetropolisApi } from './api';
import type { ApiMe, SeedData, TenantSeed, TestUser } from './api';
import {
  assertTenantRole,
  provisionGuest,
  provisionInvitedUser,
  provisionTenantOwnerViaOperator,
  toTestUser,
} from './provisioning';

type OwnerSession = { api: MeetropolisApi; user: TestUser };

async function tenantSeed(args: {
  playwrightRequest: Parameters<typeof createApiRequest>[0];
  apiUrl: string;
  baseUrl: string;
  owner: OwnerSession;
  password: string;
  slug: string;
  includeAccounts: boolean;
  includeGuest?: boolean;
}): Promise<TenantSeed> {
  const users: Partial<Record<'owner' | 'admin' | 'member' | 'guest', TestUser>> = { owner: args.owner.user };
  if (args.includeAccounts) {
    users.admin = await provisionInvitedUser({
      playwrightRequest: args.playwrightRequest,
      ownerApi: args.owner.api,
      apiUrl: args.apiUrl,
      tenantSlug: args.slug,
      email: args.slug === 'default' ? 'admin@default.test' : 'admin@acme.test',
      name: 'Test Admin',
      role: 'admin',
      password: args.password,
    });
    users.member = await provisionInvitedUser({
      playwrightRequest: args.playwrightRequest,
      ownerApi: args.owner.api,
      apiUrl: args.apiUrl,
      tenantSlug: args.slug,
      email: args.slug === 'default' ? 'member@default.test' : 'member@acme.test',
      name: 'Test Member',
      role: 'member',
      password: args.password,
    });
    if (args.includeGuest) {
      users.guest = await provisionGuest({
        playwrightRequest: args.playwrightRequest,
        ownerApi: args.owner.api,
        apiUrl: args.apiUrl,
        baseUrl: args.baseUrl,
        tenantSlug: args.slug,
        email: args.slug === 'default' ? 'guest@default.test' : 'guest@acme.test',
      });
    }
  }
  const { tenantId, roomId, mapId } = await args.owner.api.tenantRoomAndMap();
  return { tenantId, slug: args.slug, roomId, mapId, users };
}

function assertExpectedSeed(edition: SeedData['edition'], tenants: Record<string, TenantSeed>): void {
  if (edition === 'ee') {
    const acme = tenants.acme?.users;
    const globex = tenants.globex?.users;
    if (!acme?.owner || !acme.admin || !acme.member || !acme.guest || !globex?.owner) {
      throw new Error('EE-Seed muss acme mit Owner/Admin/Member/Gast und globex mit Owner enthalten.');
    }
    return;
  }
  if (!tenants.default?.users.owner || !tenants.default.users.admin || !tenants.default.users.member) {
    throw new Error('OSS-Seed muss den Default-Tenant mit Betreiber, Admin und Member enthalten.');
  }
  if (tenants.default.users.guest) throw new Error('OSS-Seed darf keinen Gast enthalten.');
}

function seedUsers(seed: SeedData): TestUser[] {
  const users: TestUser[] = [seed.operator];
  for (const tenant of Object.values(seed.tenants)) {
    for (const user of Object.values(tenant.users)) {
      if (user) users.push(user);
    }
  }
  return users;
}

async function verifySeedLogins(
  playwrightRequest: Parameters<typeof createApiRequest>[0],
  apiUrl: string,
  seed: SeedData,
): Promise<number> {
  const users = seedUsers(seed);
  for (const user of users) {
    const request = await createApiRequest(playwrightRequest, apiUrl, user.tenantSlug);
    try {
      const api = new MeetropolisApi(request, apiUrl, user.tenantSlug);
      let me: ApiMe;
      if (user.role === 'guest') {
        if (!user.guestUrl) throw new Error(`Gast ${user.email} hat keinen Magic-Link.`);
        me = await api.loginGuest(user.guestUrl);
      } else {
        if (!user.password) throw new Error(`Seed-Konto ${user.email} hat kein Passwort im Seed.`);
        me = await api.login(user.email, user.password);
      }
      assertTenantRole(me, user.tenantSlug, user.role);
      user.displayName = toTestUser(me).displayName;
    } finally {
      await request.dispose();
    }
  }
  return users.length;
}

test('create idempotent test seed', async ({ playwright, stack }) => {
  const disposers: Array<() => Promise<void>> = [];
  try {
    const operatorRequest = await createApiRequest(playwright.request, stack.apiUrl, 'default');
    disposers.push(() => operatorRequest.dispose());
    const operatorApi = new MeetropolisApi(operatorRequest, stack.apiUrl, 'default');
    const operatorMe: ApiMe = await operatorApi.login(stack.operatorEmail, stack.operatorPassword);
    assertTenantRole(operatorMe, 'default', 'owner');
    const operator = toTestUser(operatorMe, stack.operatorPassword);

    const tenants: Record<string, TenantSeed> = {};
    if (stack.edition === 'ee') {
      const acme = await provisionTenantOwnerViaOperator({
        playwrightRequest: playwright.request,
        apiUrl: stack.apiUrl,
        operatorEmail: stack.operatorEmail,
        operatorPassword: stack.operatorPassword,
        tenantSlug: 'acme',
        tenantName: 'Test acme',
        ownerEmail: 'owner@acme.test',
        ownerName: 'Test Owner',
        ownerPassword: stack.userPassword,
      });
      disposers.push(acme.dispose);
      tenants.acme = await tenantSeed({
        playwrightRequest: playwright.request,
        apiUrl: stack.apiUrl,
        baseUrl: stack.baseUrl,
        owner: acme,
        password: stack.userPassword,
        slug: 'acme',
        includeAccounts: true,
        includeGuest: true,
      });

      const globex = await provisionTenantOwnerViaOperator({
        playwrightRequest: playwright.request,
        apiUrl: stack.apiUrl,
        operatorEmail: stack.operatorEmail,
        operatorPassword: stack.operatorPassword,
        tenantSlug: 'globex',
        tenantName: 'Test globex',
        ownerEmail: 'owner@globex.test',
        ownerName: 'Test Owner',
        ownerPassword: stack.userPassword,
      });
      disposers.push(globex.dispose);
      const { tenantId, roomId, mapId } = await globex.api.tenantRoomAndMap();
      tenants.globex = { tenantId, slug: 'globex', roomId, mapId, users: { owner: globex.user } };
    } else {
      const owner = { api: operatorApi, user: operator };
      tenants.default = await tenantSeed({
        playwrightRequest: playwright.request,
        apiUrl: stack.apiUrl,
        baseUrl: stack.baseUrl,
        owner,
        password: stack.userPassword,
        slug: 'default',
        includeAccounts: true,
        includeGuest: false,
      });
    }

    assertExpectedSeed(stack.edition, tenants);
    const seed: SeedData = { edition: stack.edition, operator, tenants };
    const verifiedCount = await verifySeedLogins(playwright.request, stack.apiUrl, seed);
    await mkdir(dirname(stack.seedFile), { recursive: true });
    await writeFile(stack.seedFile, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    console.log(
      `P2 seed ready: edition=${stack.edition}, tenants=${Object.keys(tenants).join(',')}, API logins=${verifiedCount}`,
    );
  } finally {
    await Promise.all(disposers.map((dispose) => dispose()));
  }
});
