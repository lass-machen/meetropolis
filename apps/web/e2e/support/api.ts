import { request as isolatedRequest, type APIRequest, type APIRequestContext } from '@playwright/test';
import { createMailpitClient } from './mailpit';

export type Role = 'owner' | 'admin' | 'member' | 'guest' | 'operator';
export type InviteRole = Extract<Role, 'admin' | 'member'>;

export type TestUser = {
  userId: string;
  email: string;
  displayName: string;
  password?: string;
  role: Role;
  tenantSlug: string;
  guestUrl?: string;
};

export type TenantSeed = {
  tenantId: string;
  slug: string;
  roomId: string;
  mapId: string;
  users: Partial<Record<Role, TestUser>>;
};

export type SeedData = {
  edition: 'ee' | 'oss';
  operator: TestUser;
  tenants: Record<string, TenantSeed>;
};

export type FreshTenant = {
  tenantId: string;
  slug: string;
  users: Record<'owner' | 'admin' | 'member' | 'guest', TestUser>;
  roomId: string;
  mapId: string;
};

export type ApiMe = {
  id: string;
  email: string;
  name: string | null;
  tenantSlug: string;
  role: Role;
};

type InviteResult = { code: string; role: InviteRole };
type GuestResult = { id: string; guestUrl: string };
type TenantResult = { id: string; slug: string; defaultMapName: string | null };
type MapSummary = { id: string; name: string; rooms: Array<{ id: string }> };
export type AdminTenantUser = {
  userId: string;
  email: string;
  role: Extract<Role, 'owner' | 'admin' | 'member' | 'guest'>;
};
export type AdminMapSummary = { id: string; name: string; tenantId: string; tenantSlug: string };

export function createApiRequest(request: APIRequest, apiUrl: string, tenantSlug?: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: apiUrl,
    ...(tenantSlug ? { extraHTTPHeaders: { 'x-tenant': tenantSlug } } : {}),
  });
}

function appendRoute(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected a JSON object response.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: field is missing.`);
  return value;
}

function roleValue(value: unknown, label: string): Role {
  if (value === 'owner' || value === 'admin' || value === 'member' || value === 'guest' || value === 'operator') {
    return value;
  }
  throw new Error(`${label}: unknown role.`);
}

function adminRoleValue(value: unknown, label: string): AdminTenantUser['role'] {
  if (value === 'owner' || value === 'admin' || value === 'member' || value === 'guest') return value;
  throw new Error(`${label}: unknown operator role.`);
}

function inviteRoleValue(value: unknown, label: string): InviteRole {
  if (value === 'admin' || value === 'member') return value;
  throw new Error(`${label}: invitation with unsupported role.`);
}

async function readJson(response: Awaited<ReturnType<APIRequestContext['get']>>, route: string): Promise<unknown> {
  if (!response.ok()) throw new Error(`${route}: HTTP ${response.status()}.`);
  const body: unknown = await response.json();
  return body;
}

export class MeetropolisApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly apiUrl: string,
    private readonly tenantSlug?: string,
  ) {}

  /** Complete pending account actions through the existing real mailbox. */
  private async accountAction(
    response: Awaited<ReturnType<APIRequestContext['post']>>,
    email: string,
    password: string,
    route: string,
  ): Promise<void> {
    if (response.status() !== 409) {
      await readJson(response, route);
      return;
    }
    const body = asRecord(await response.json(), route);
    if (body.code !== 'EMAIL_VERIFICATION_REQUIRED') {
      throw new Error(`${route}: HTTP ${response.status()}.`);
    }
    if ('token' in body || 'verifyUrl' in body) throw new Error('Account response contains a confirmation secret.');
    const mailpitUrl = process.env.MAILPIT_URL;
    if (!mailpitUrl || !['127.0.0.1', 'localhost'].includes(new URL(mailpitUrl).hostname)) {
      throw new Error('The assigned local mailbox is not configured.');
    }
    const mailbox = await isolatedRequest.newContext();
    try {
      const mailpit = createMailpitClient(mailbox, mailpitUrl);
      const message = await mailpit.waitForMail({ to: email, linkPattern: /#\/verify\?token=/ });
      const link = mailpit.extractLinks(message).find((candidate) => /#\/verify\?token=/.test(candidate));
      const token = link ? new URLSearchParams(new URL(link).hash.split('?')[1]).get('token') : null;
      if (!token) throw new Error('The confirmation email contains no confirmation link.');
      await readJson(
        await this.request.post(appendRoute(this.apiUrl, '/auth/verify'), { data: { token } }),
        '/auth/verify',
      );
      // Verification consumes the proof but does not establish a session.
      await readJson(
        await this.request.post(appendRoute(this.apiUrl, '/auth/login'), { data: { email, password } }),
        '/auth/login',
      );
    } finally {
      await mailbox.dispose();
    }
  }

  private async authenticateForInvite(email: string, password: string): Promise<void> {
    const route = '/auth/login';
    const response = await this.request.post(appendRoute(this.apiUrl, route), { data: { email, password } });
    if (response.status() === 409) {
      const body = asRecord(await response.json(), route);
      // These responses follow a successful credential check and session creation.
      if (body.code === 'EMAIL_VERIFICATION_REQUIRED' || body.code === 'INVITE_ACCEPT_REQUIRED') return;
    }
    await readJson(response, route);
  }

  async login(email: string, password: string): Promise<ApiMe> {
    // POST /auth/login is registered at apps/server/src/api/routes/auth.ts:26-30;
    // its { email, password } payload is validated in auth.signin.ts:42-43,248-258.
    const route = '/auth/login';
    const response = await this.request.post(appendRoute(this.apiUrl, route), { data: { email, password } });
    await this.accountAction(response, email, password, route);
    return this.me();
  }

  async tryLogin(email: string, password: string): Promise<ApiMe | null> {
    const route = '/auth/login';
    const response = await this.request.post(appendRoute(this.apiUrl, route), { data: { email, password } });
    if (response.status() === 401) return null;
    if (response.status() === 409 && asRecord(await response.json(), route).code === 'INVITE_ACCEPT_REQUIRED') {
      return null;
    }
    await this.accountAction(response, email, password, route);
    return this.me();
  }

  async loginGuest(guestUrl: string): Promise<ApiMe> {
    const url = new URL(guestUrl);
    const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
    const token = new URLSearchParams(hashQuery).get('token');
    if (!token) throw new Error('guestUrl contains no magic link token.');

    // POST /auth/guest is registered beside POST /guests in
    // apps/server/src/api/routes/guests.ts:333-339 and establishes the guest session at :267-331.
    const route = '/auth/guest';
    await readJson(await this.request.post(appendRoute(this.apiUrl, route), { data: { token } }), route);
    return this.me();
  }

  async me(): Promise<ApiMe> {
    // GET /auth/me is registered at apps/server/src/api/routes/auth.ts:30 and
    // returns id, email, name, role, and tenantSlug in auth.signin.ts:369-383.
    const route = '/auth/me';
    const body = asRecord(await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route), route);
    const name = body.name;
    return {
      id: requiredString(body.id, route),
      email: requiredString(body.email, route),
      name: typeof name === 'string' ? name : null,
      tenantSlug: requiredString(body.tenantSlug, route),
      role: roleValue(body.role, route),
    };
  }

  async invite(email: string, role: InviteRole): Promise<InviteResult> {
    // POST /auth/invite is registered at apps/server/src/api/routes/auth.ts:26;
    // owner/admin authorization and the { email, role } schema are in auth.signin.ts:21-59.
    const route = '/auth/invite';
    const body = asRecord(
      await readJson(await this.request.post(appendRoute(this.apiUrl, route), { data: { email, role } }), route),
      route,
    );
    return { code: requiredString(body.code, route), role: inviteRoleValue(body.role, route) };
  }

  async createGuest(args: { email: string; name: string; expiresAt: string }): Promise<GuestResult> {
    // POST /guests checks owner/admin membership and returns a magicLink at
    // apps/server/src/api/routes/guests.ts:22-35,161-210.
    const route = '/guests';
    const body = asRecord(
      await readJson(await this.request.post(appendRoute(this.apiUrl, route), { data: args }), route),
      route,
    );
    return {
      id: requiredString(body.id, route),
      guestUrl: requiredString(body.magicLink, route),
    };
  }

  async registerWithInvite(args: { code: string; email: string; name: string; password: string }): Promise<ApiMe> {
    // POST /auth/register is registered at apps/server/src/api/routes/auth.ts:27;
    // the invite-code payload and membership creation are in auth.signin.ts:97-151.
    const route = '/auth/register';
    let response = await this.request.post(appendRoute(this.apiUrl, route), { data: args });
    let actionRoute = route;
    if (response.status() === 409 && asRecord(await response.json(), route).code === 'ACCOUNT_LOGIN_REQUIRED') {
      await this.authenticateForInvite(args.email, args.password);
      actionRoute = '/invites/accept';
      response = await this.request.post(appendRoute(this.apiUrl, actionRoute), { data: { code: args.code } });
    }
    await this.accountAction(response, args.email, args.password, actionRoute);
    return this.me();
  }

  async ensureAdminTenant(args: { slug: string; name: string }): Promise<string> {
    if (this.tenantSlug !== 'default') {
      throw new Error('ensureAdminTenant must be called with the operator context of the default tenant.');
    }
    const existing = (await this.adminTenants()).find((tenant) => tenant.slug === args.slug);
    if (existing) return existing.id;

    // POST /admin/tenants is registered by the EE tenant-admin module and
    // requires the platform super-admin; it does not need X-Tenant for the
    // tenant that is being created.
    const route = '/admin/tenants';
    const body = asRecord(
      await readJson(await this.request.post(appendRoute(this.apiUrl, route), { data: args }), route),
      route,
    );
    return requiredString(body.id, route);
  }

  async adminTenants(): Promise<Array<{ id: string; slug: string }>> {
    const route = '/admin/tenants';
    const value = await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route);
    if (!Array.isArray(value)) throw new Error(`${route}: expected a tenant list.`);
    return value.map((entry, index) => {
      const tenant = asRecord(entry, `${route}[${index}]`);
      return {
        id: requiredString(tenant.id, `${route}[${index}]`),
        slug: requiredString(tenant.slug, `${route}[${index}]`),
      };
    });
  }

  async adminTenantUsers(tenantId: string): Promise<AdminTenantUser[]> {
    const route = `/admin/tenants/${encodeURIComponent(tenantId)}/users`;
    const value = await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route);
    if (!Array.isArray(value)) throw new Error(`${route}: expected a user list.`);
    return value.map((entry, index) => {
      const user = asRecord(entry, `${route}[${index}]`);
      return {
        userId: requiredString(user.userId, `${route}[${index}]`),
        email: requiredString(user.email, `${route}[${index}]`),
        role: adminRoleValue(user.role, `${route}[${index}]`),
      };
    });
  }

  async addAdminTenantUser(args: {
    tenantId: string;
    email: string;
    name: string;
    role: Extract<Role, 'admin' | 'member'>;
  }): Promise<AdminTenantUser> {
    const route = `/admin/tenants/${encodeURIComponent(args.tenantId)}/users`;
    const body = asRecord(
      await readJson(
        await this.request.post(appendRoute(this.apiUrl, route), {
          data: { email: args.email, name: args.name, role: args.role },
        }),
        route,
      ),
      route,
    );
    return {
      userId: requiredString(body.userId, route),
      email: requiredString(body.email, route),
      role: adminRoleValue(body.role, route),
    };
  }

  async setAdminTenantUserRole(tenantId: string, userId: string, role: AdminTenantUser['role']): Promise<void> {
    const route = `/admin/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/role`;
    await readJson(await this.request.patch(appendRoute(this.apiUrl, route), { data: { role } }), route);
  }

  async removeAdminTenantUser(tenantId: string, userId: string): Promise<void> {
    const route = `/admin/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}`;
    await readJson(await this.request.delete(appendRoute(this.apiUrl, route)), route);
  }

  async setAdminTenantDefaultMap(tenantId: string, defaultMapName: string): Promise<void> {
    const route = `/admin/tenants/${encodeURIComponent(tenantId)}`;
    await readJson(await this.request.patch(appendRoute(this.apiUrl, route), { data: { defaultMapName } }), route);
  }

  async adminMaps(): Promise<AdminMapSummary[]> {
    const route = '/admin/maps';
    const value = await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route);
    if (!Array.isArray(value)) throw new Error(`${route}: expected a map list.`);
    return value.map((entry, index) => {
      const map = asRecord(entry, `${route}[${index}]`);
      return {
        id: requiredString(map.id, `${route}[${index}]`),
        name: requiredString(map.name, `${route}[${index}]`),
        tenantId: requiredString(map.tenantId, `${route}[${index}]`),
        tenantSlug: requiredString(map.tenantSlug, `${route}[${index}]`),
      };
    });
  }

  async copyAdminMap(sourceMapId: string, targetTenantId: string, newName: string): Promise<void> {
    const route = `/admin/maps/${encodeURIComponent(sourceMapId)}/copy`;
    await readJson(
      await this.request.post(appendRoute(this.apiUrl, route), { data: { targetTenantId, newName } }),
      route,
    );
  }

  async pendingInviteCode(email: string): Promise<string | null> {
    const route = '/invites';
    const value = await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route);
    if (!Array.isArray(value)) throw new Error(`${route}: expected an invitation list.`);
    const normalizedEmail = email.trim().toLowerCase();
    const match = value
      .map((entry, index) => ({ entry: asRecord(entry, `${route}[${index}]`), index }))
      .find(({ entry }) => entry.email === normalizedEmail && entry.usedAt === null);
    if (!match) return null;
    // Decision 13 (knowledge/quality/Q-ACC-P3-einladungen.md): no invite code in URL
    // paths; the list returns id and url only, so the code comes from the link.
    const url = requiredString(match.entry.url, `${route}[${match.index}]`);
    const hashQuery = new URL(url).hash.split('?')[1] ?? '';
    const code = new URLSearchParams(hashQuery).get('invite');
    if (!code) throw new Error(`${route}[${match.index}]: invite link without invite code`);
    return code;
  }

  async tenant(): Promise<TenantResult> {
    // GET /tenant is registered at apps/server/src/api/routes/tenant.ts:141-143;
    // membership-checked metadata is returned at tenant.ts:40-70.
    const route = '/tenant';
    const body = asRecord(await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route), route);
    return {
      id: requiredString(body.id, route),
      slug: requiredString(body.slug, route),
      defaultMapName: typeof body.defaultMapName === 'string' ? body.defaultMapName : null,
    };
  }

  async tenantRoomAndMap(): Promise<{ tenantId: string; roomId: string; mapId: string }> {
    const tenant = await this.tenant();
    let maps = await this.maps();
    let map = maps.find((candidate) => candidate.name === tenant.defaultMapName) ?? maps[0];
    if (!map) throw new Error(`Tenant ${tenant.slug} returned no map via GET /maps.`);

    if (map.rooms.length === 0) {
      const mapId = map.id;
      await this.createDefaultRoom(tenant.defaultMapName ?? map.name);
      maps = await this.maps();
      map = maps.find((candidate) => candidate.id === mapId) ?? map;
    }
    const room = map.rooms[0];
    if (!room) throw new Error(`Map ${map.name} returned no room after POST /auth/position.`);
    return { tenantId: tenant.id, roomId: room.id, mapId: map.id };
  }

  private async maps(): Promise<MapSummary[]> {
    // GET /maps is registered at apps/server/src/api/routes/maps.ts:16 and
    // returns each map with its rooms at apps/server/src/api/routes/maps.read.ts:62-70.
    const route = '/maps';
    const value = await readJson(await this.request.get(appendRoute(this.apiUrl, route)), route);
    if (!Array.isArray(value)) throw new Error(`${route}: expected a map list.`);
    return value.map((entry, index) => {
      const map = asRecord(entry, `${route}[${index}]`);
      const rooms = Array.isArray(map.rooms) ? map.rooms : [];
      return {
        id: requiredString(map.id, `${route}[${index}]`),
        name: requiredString(map.name, `${route}[${index}]`),
        rooms: rooms.map((entry, roomIndex) => ({
          id: requiredString(
            asRecord(entry, `${route}[${index}].rooms[${roomIndex}]`).id,
            `${route}[${index}].rooms[${roomIndex}]`,
          ),
        })),
      };
    });
  }

  private async createDefaultRoom(mapName: string): Promise<void> {
    // POST /auth/position is registered at apps/server/src/api/routes/auth.ts:52;
    // auth.profile.ts:59-65,79-104 shows it creates a default room through the API.
    const route = '/auth/position';
    await readJson(
      await this.request.post(appendRoute(this.apiUrl, route), {
        data: { x: 0, y: 0, direction: 'down', roomId: 'world', mapName },
      }),
      route,
    );
  }
}
