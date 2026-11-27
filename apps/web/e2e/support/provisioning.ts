import type { APIRequest } from '@playwright/test';
import { Client } from 'pg';

import { createApiRequest, MeetropolisApi, type ApiMe, type InviteRole, type Role, type TestUser } from './api';

type TenantOwnerSession = { api: MeetropolisApi; user: TestUser; dispose: () => Promise<void> };

const TEMPLATE_MAP_NAME = 'office-atelier-v1';

export function toTestUser(me: ApiMe, password?: string, guestUrl?: string): TestUser {
  if (me.name === null || me.name.length === 0) {
    throw new Error(`/auth/me did not return a display name for ${me.email}.`);
  }

  return {
    userId: me.id,
    email: me.email,
    displayName: me.name,
    role: me.role,
    tenantSlug: me.tenantSlug,
    ...(password ? { password } : {}),
    ...(guestUrl ? { guestUrl } : {}),
  };
}

export function assertTenantRole(me: ApiMe, tenantSlug: string, role: Role): void {
  if (me.tenantSlug !== tenantSlug || me.role !== role) {
    throw new Error(`Account ${me.email} does not have the expected role ${role} in ${tenantSlug}.`);
  }
}

/**
 * Drop the operator's helper membership in a freshly provisioned tenant.
 *
 * The admin API removal (DELETE /admin/tenants/:id/users/:userId) signs the
 * removed user out everywhere, which would revoke the operator sessions that
 * parallel workers are using at that moment. The operator only joined to issue
 * the owner invite, so deleting exactly this row leaves the same end state
 * without touching any session.
 */
async function removeOperatorMembership(tenantId: string, userId: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const result = await db.query('DELETE FROM "Membership" WHERE "tenantId" = $1 AND "userId" = $2', [
      tenantId,
      userId,
    ]);
    if (result.rowCount !== 1) throw new Error('The operator membership in the provisioned tenant was not found.');
  } finally {
    await db.end();
  }
}

async function ensureTenantTemplateMap(operatorApi: MeetropolisApi, tenantId: string): Promise<void> {
  const maps = await operatorApi.adminMaps();
  const tenantMap = maps.find((map) => map.tenantId === tenantId && map.name === TEMPLATE_MAP_NAME);
  if (!tenantMap) {
    const templateMap = maps.find((map) => map.tenantSlug === 'template' && map.name === TEMPLATE_MAP_NAME);
    if (!templateMap) throw new Error(`Template map ${TEMPLATE_MAP_NAME} was not found.`);
    await operatorApi.copyAdminMap(templateMap.id, tenantId, TEMPLATE_MAP_NAME);
  }
  await operatorApi.setAdminTenantDefaultMap(tenantId, TEMPLATE_MAP_NAME);
}

export async function provisionTenantOwnerViaOperator(args: {
  playwrightRequest: APIRequest;
  apiUrl: string;
  operatorEmail: string;
  operatorPassword: string;
  tenantSlug: string;
  tenantName: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}): Promise<TenantOwnerSession> {
  const operatorRequest = await createApiRequest(args.playwrightRequest, args.apiUrl, 'default');
  const operatorApi = new MeetropolisApi(operatorRequest, args.apiUrl, 'default');
  let tenantOperatorRequest: Awaited<ReturnType<typeof createApiRequest>> | undefined;
  let ownerRequest: Awaited<ReturnType<typeof createApiRequest>> | undefined;
  let tenantId: string | undefined;
  let operatorUserId: string | undefined;
  let keepOwnerRequest = false;

  try {
    const operator = await operatorApi.login(args.operatorEmail, args.operatorPassword);
    assertTenantRole(operator, 'default', 'owner');
    tenantId = await operatorApi.ensureAdminTenant({ slug: args.tenantSlug, name: args.tenantName });
    await ensureTenantTemplateMap(operatorApi, tenantId);

    ownerRequest = await createApiRequest(args.playwrightRequest, args.apiUrl, args.tenantSlug);
    const ownerApi = new MeetropolisApi(ownerRequest, args.apiUrl, args.tenantSlug);
    let owner = await ownerApi.tryLogin(args.ownerEmail, args.ownerPassword);
    if (!owner) {
      const operatorMembership = (await operatorApi.adminTenantUsers(tenantId)).find(
        (user) => user.userId === operator.id,
      );
      operatorUserId = operatorMembership?.userId;
      if (!operatorMembership) {
        const added = await operatorApi.addAdminTenantUser({
          tenantId,
          email: args.operatorEmail,
          name: operator.name ?? 'Test Operator',
          role: 'admin',
        });
        operatorUserId = added.userId;
      } else if (operatorMembership.role === 'member') {
        await operatorApi.setAdminTenantUserRole(tenantId, operator.id, 'admin');
      }

      tenantOperatorRequest = await createApiRequest(args.playwrightRequest, args.apiUrl, args.tenantSlug);
      const tenantOperatorApi = new MeetropolisApi(tenantOperatorRequest, args.apiUrl, args.tenantSlug);
      await tenantOperatorApi.login(args.operatorEmail, args.operatorPassword);
      const inviteCode =
        (await tenantOperatorApi.pendingInviteCode(args.ownerEmail)) ??
        (await tenantOperatorApi.invite(args.ownerEmail, 'member')).code;
      owner = await ownerApi.registerWithInvite({
        code: inviteCode,
        email: args.ownerEmail,
        name: args.ownerName,
        password: args.ownerPassword,
      });
      assertTenantRole(owner, args.tenantSlug, 'member');
    }

    if (owner.role !== 'owner') {
      await operatorApi.setAdminTenantUserRole(tenantId, owner.id, 'owner');
    }
    owner = await ownerApi.me();
    assertTenantRole(owner, args.tenantSlug, 'owner');

    if (!operatorUserId) {
      operatorUserId = (await operatorApi.adminTenantUsers(tenantId)).find(
        (user) => user.userId === operator.id,
      )?.userId;
    }
    if (operatorUserId) {
      await removeOperatorMembership(tenantId, operatorUserId);
      operatorUserId = undefined;
    }

    keepOwnerRequest = true;
    const retainedOwnerRequest = ownerRequest;
    return {
      api: ownerApi,
      user: toTestUser(owner, args.ownerPassword),
      dispose: () => retainedOwnerRequest.dispose(),
    };
  } finally {
    if (tenantId && operatorUserId) await removeOperatorMembership(tenantId, operatorUserId);
    if (ownerRequest && !keepOwnerRequest) await ownerRequest.dispose();
    if (tenantOperatorRequest) await tenantOperatorRequest.dispose();
    await operatorRequest.dispose();
  }
}

export async function provisionInvitedUser(args: {
  playwrightRequest: APIRequest;
  ownerApi: MeetropolisApi;
  apiUrl: string;
  tenantSlug: string;
  email: string;
  name: string;
  role: InviteRole;
  password: string;
}): Promise<TestUser> {
  const request = await createApiRequest(args.playwrightRequest, args.apiUrl, args.tenantSlug);
  try {
    const api = new MeetropolisApi(request, args.apiUrl, args.tenantSlug);
    const existing = await api.tryLogin(args.email, args.password);
    if (existing) {
      assertTenantRole(existing, args.tenantSlug, args.role);
      return toTestUser(existing, args.password);
    }

    const invitation = await args.ownerApi.invite(args.email, args.role);
    const me = await api.registerWithInvite({
      code: invitation.code,
      email: args.email,
      name: args.name,
      password: args.password,
    });
    assertTenantRole(me, args.tenantSlug, args.role);
    return toTestUser(me, args.password);
  } finally {
    await request.dispose();
  }
}

export async function provisionGuest(args: {
  playwrightRequest: APIRequest;
  ownerApi: MeetropolisApi;
  apiUrl: string;
  baseUrl: string;
  tenantSlug: string;
  email: string;
}): Promise<TestUser> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const created = await args.ownerApi.createGuest({ email: args.email, name: 'Test Guest', expiresAt });
  const guestUrl = new URL(created.guestUrl, args.baseUrl).toString();
  const request = await createApiRequest(args.playwrightRequest, args.apiUrl, args.tenantSlug);
  try {
    const api = new MeetropolisApi(request, args.apiUrl, args.tenantSlug);
    const me = await api.loginGuest(guestUrl);
    assertTenantRole(me, args.tenantSlug, 'guest');
    return toTestUser(me, undefined, guestUrl);
  } finally {
    await request.dispose();
  }
}
