import { createHash, randomUUID } from 'node:crypto';

import type { APIRequest } from '@playwright/test';

import { MeetropolisApi, createApiRequest } from '../support/api';
import type { FreshTenant, InviteRole, SeedData, TestUser } from '../support/api';
import { provisionGuest, provisionInvitedUser, provisionTenantOwnerViaOperator } from '../support/provisioning';
import { getSeedTenant, passwordFor } from './helpers';
import type { TestStackEnv } from './types';

export async function createFreshTenant(
  playwrightRequest: APIRequest,
  stack: TestStackEnv,
  testId: string,
): Promise<FreshTenant> {
  const suffix = createHash('sha256').update(`${testId}:${randomUUID()}`).digest('hex').slice(0, 10);
  const slug = `t-${suffix}`;
  const ownerSession = await provisionTenantOwnerViaOperator({
    playwrightRequest,
    apiUrl: stack.apiUrl,
    operatorEmail: stack.operatorEmail,
    operatorPassword: stack.operatorPassword,
    tenantSlug: slug,
    tenantName: `E2E ${suffix}`,
    ownerEmail: `owner+${suffix}@e2e.test`,
    ownerName: 'Test Owner',
    ownerPassword: stack.userPassword,
  });

  try {
    const ownerApi = ownerSession.api;
    const owner = ownerSession.user;

    const users: FreshTenant['users'] = {
      owner,
      admin: await provisionInvitedUser({
        playwrightRequest,
        ownerApi,
        apiUrl: stack.apiUrl,
        tenantSlug: slug,
        email: `admin+${suffix}@e2e.test`,
        name: 'Test Admin',
        role: 'admin',
        password: stack.userPassword,
      }),
      member: await provisionInvitedUser({
        playwrightRequest,
        ownerApi,
        apiUrl: stack.apiUrl,
        tenantSlug: slug,
        email: `member+${suffix}@e2e.test`,
        name: 'Test Member',
        role: 'member',
        password: stack.userPassword,
      }),
      guest: await provisionGuest({
        playwrightRequest,
        ownerApi,
        apiUrl: stack.apiUrl,
        baseUrl: stack.baseUrl,
        tenantSlug: slug,
        email: `guest+${suffix}@e2e.test`,
      }),
    };

    const { tenantId, roomId, mapId } = await ownerApi.tenantRoomAndMap();
    return { tenantId, slug, users, roomId, mapId };
  } finally {
    await ownerSession.dispose();
  }
}

// Fresh invited users per test, because the server allows one live session per identity (newest wins), so shared seed accounts kick each other across parallel projects. Works in OSS and EE; only REST, no room join for the owner.
export async function createSeedTenantUsers(
  playwrightRequest: APIRequest,
  stack: TestStackEnv,
  seed: SeedData,
  testId: string,
  roles: InviteRole[],
): Promise<TestUser[]> {
  const tenant = getSeedTenant(seed);
  const owner = tenant.users.owner;
  if (!owner) throw new Error('Seed tenant has no owner, so no fresh test users can be created.');
  const suffix = createHash('sha256').update(`${testId}:${randomUUID()}`).digest('hex').slice(0, 10);
  const request = await createApiRequest(playwrightRequest, stack.apiUrl, tenant.slug);
  const ownerApi = new MeetropolisApi(request, stack.apiUrl, tenant.slug);
  try {
    await ownerApi.login(owner.email, passwordFor(owner));
    const users: TestUser[] = [];
    for (const [index, role] of roles.entries()) {
      users.push(
        await provisionInvitedUser({
          playwrightRequest,
          ownerApi,
          apiUrl: stack.apiUrl,
          tenantSlug: tenant.slug,
          email: `${role}-${index + 1}+${suffix}@e2e.test`,
          name: `E2E ${role} ${index + 1} ${suffix}`,
          role,
          password: stack.userPassword,
        }),
      );
    }
    return users;
  } finally {
    await request.dispose();
  }
}
