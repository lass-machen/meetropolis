import { createHash, randomUUID } from 'node:crypto';

import type { APIRequest } from '@playwright/test';

import type { FreshTenant } from '../support/api';
import { provisionGuest, provisionInvitedUser, provisionTenantOwnerViaOperator } from '../support/provisioning';
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
    tenantName: `Q-Test ${suffix}`,
    ownerEmail: `owner+${suffix}@qtest.test`,
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
        email: `admin+${suffix}@qtest.test`,
        name: 'Test Admin',
        role: 'admin',
        password: stack.userPassword,
      }),
      member: await provisionInvitedUser({
        playwrightRequest,
        ownerApi,
        apiUrl: stack.apiUrl,
        tenantSlug: slug,
        email: `member+${suffix}@qtest.test`,
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
        email: `guest+${suffix}@qtest.test`,
      }),
    };

    const { tenantId, roomId, mapId } = await ownerApi.tenantRoomAndMap();
    return { tenantId, slug, users, roomId, mapId };
  } finally {
    await ownerSession.dispose();
  }
}
