/**
 * Unit tests for the H4 hardening gate: identity binding (onAuth) +
 * client zone-privacy version gate.
 *
 * All external dependencies (logger, sessionAuth.validateTenantSessionFresh) are
 * mocked so no real JWT signing/DB is required. Tests exercise the pure
 * decision logic in authenticateWorldJoin/isWorldAuth/requireWorldAuth.
 *
 * The gate resolves tokens through `validateTenantSessionFresh` (the session ROW is
 * the authority), not through `verifyAuthJwt` (signature only) — a revoked
 * session must not open the world. `validateTenantSessionFresh` returning null is
 * therefore the single "not authenticated" signal here, covering a bad
 * signature AND a valid signature whose session is gone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerError, type AuthContext } from 'colyseus';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const validateTenantSessionFreshMock = vi.fn();
const verifyAuthJwtMock = vi.fn();
vi.mock('../../api/utils/authHelpers.js', () => ({
  verifyAuthJwt: (...args: unknown[]) => verifyAuthJwtMock(...args),
}));
vi.mock('../../api/utils/sessionAuth.js', () => ({
  validateTenantSessionFresh: (...args: unknown[]) => validateTenantSessionFreshMock(...args),
}));

import {
  authenticateWorldJoin,
  isWorldAuth,
  requireWorldAuth,
  AUTH_REJECTED_CODE,
  CLIENT_TOO_OLD_CODE,
} from './onAuth.js';
import type { RoomOptions } from '../WorldRoom.js';

type WorldJoinPrisma = Parameters<typeof authenticateWorldJoin>[2];

/** Default resolver: the verified tenant has a slug, so it is attached. */
const prisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'tenant-1', slug: 'acme' })) },
  session: { findUnique: vi.fn(), update: vi.fn() },
  // Joins in these tests come from members; the membership gate has its own tests.
  membership: { findUnique: vi.fn(() => Promise.resolve({ expiresAt: null })) },
  npc: { findUnique: vi.fn(() => Promise.resolve({ id: 'npc-id', identity: 'bob' })) },
} as unknown as WorldJoinPrisma;

function makeContext(opts: { token?: string; cookie?: string } = {}): AuthContext {
  const headerInit: Record<string, string> = {};
  if (opts.cookie !== undefined) headerInit.cookie = opts.cookie;
  const context: AuthContext = {
    headers: new Headers(headerInit),
    ip: '127.0.0.1',
  };
  if (opts.token !== undefined) context.token = opts.token;
  return context;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  validateTenantSessionFreshMock.mockReset();
  verifyAuthJwtMock.mockReset();
  verifyAuthJwtMock.mockReturnValue({ userId: 'user-real', tenantId: 'tenant-1' });
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('authenticateWorldJoin: user identity binding', () => {
  it('binds identity to the JWT subject, ignoring a client-supplied options.identity', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
    const options: RoomOptions = { identity: 'user-victim', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth).toEqual({
      identity: 'user-real',
      tenantId: 'tenant-1',
      tenantSlug: 'acme',
      sessionId: 'db-session-1',
      authSessionId: 'db-session-1',
      isNpc: false,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, 'jwt-abc', 'tenant-1');
  });

  it('prefers context.token (Bearer/native) over the auth_token cookie when both are present', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-native',
      tenantId: 'tenant-1',
    });
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ token: 'bearer-jwt', cookie: 'auth_token=cookie-jwt' });

    await authenticateWorldJoin(options, context, prisma);

    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, 'bearer-jwt', 'tenant-1');
  });

  it('rejects a join with no cookie and no bearer token (fail-closed)', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
    });
    expect(validateTenantSessionFreshMock).not.toHaveBeenCalled();
  });

  it('rejects a join whose token fails JWT verification', async () => {
    verifyAuthJwtMock.mockReturnValue(null);
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=expired-or-tampered' });

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toBeInstanceOf(ServerError);
    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });
    expect(validateTenantSessionFreshMock).not.toHaveBeenCalled();
  });

  it('rejects a REVOKED session even though the JWT signature is still valid', async () => {
    verifyAuthJwtMock.mockReturnValue({ userId: 'user-revoked', tenantId: 'tenant-1' });
    // The regression this gate exists for: logout / session revocation /
    // password reset delete the Session row but cannot un-sign the JWT, which
    // stays cryptographically valid for its full 30-day lifetime. Resolving the
    // token through validateTenantSessionFresh (unauthenticated = no live row) is what closes the
    // world door at the same moment REST closes; verifyAuthJwt would still say
    // "signed by us" and admit the join.
    validateTenantSessionFreshMock.mockResolvedValue({ status: 'unauthenticated' });
    const options: RoomOptions = { identity: 'user-revoked', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=validly-signed-but-revoked' });

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
    });
    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, 'validly-signed-but-revoked', 'tenant-1');
  });

  it('accepts a guest JWT identically to a regular user JWT (same {sub,tid} shape)', async () => {
    // Guest logins sign the exact same JWT payload shape as regular users
    // (see apps/server/src/api/routes/guests.ts handleGuestLogin) - the
    // gate must not special-case them.
    verifyAuthJwtMock.mockReturnValue({ userId: 'guest-42', tenantId: 'tenant-acme' });
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'guest-42',
      tenantId: 'tenant-acme',
    });
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=guest-jwt' });

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth).toEqual({
      identity: 'guest-42',
      tenantId: 'tenant-acme',
      tenantSlug: 'acme',
      sessionId: 'db-session-1',
      authSessionId: 'db-session-1',
      isNpc: false,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
  });
});

describe('authenticateWorldJoin: legacy clients without the current protocol', () => {
  beforeEach(() => {
    delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
    verifyAuthJwtMock.mockReturnValue({ userId: 'user-real', tenantId: 'tenant-1' });
  });

  it('rejects a token-less join when the legacy switch is unset', async () => {
    const options: RoomOptions = { identity: 'legacy-user', zonePrivacyVersion: 0 };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });
    expect(validateTenantSessionFreshMock).not.toHaveBeenCalled();
  });

  it('rejects a token-less join that has no identity at all', async () => {
    const options: RoomOptions = { zonePrivacyVersion: 0 };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });
  });

  it('binds identity to the verified JWT when the legacy switch is unset', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
    const options: RoomOptions = { identity: 'user-victim', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth.identity).toBe('user-real');
  });

  it('rejects an old-version authenticated client', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-old-client',
      tenantId: 'tenant-1',
    });
    const options: RoomOptions = { zonePrivacyVersion: 0 };
    const context = makeContext({ cookie: 'auth_token=jwt-old' });

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
    expect(validateTenantSessionFreshMock).toHaveBeenCalledTimes(1);
    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, 'jwt-old', 'tenant-1');
  });

  it('allows the current protocol when the legacy enforcement switch is set', async () => {
    process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-current' });

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth.identity).toBe('user-real');
  });
});

describe('authenticateWorldJoin: client zone-privacy version gate', () => {
  beforeEach(() => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
  });

  it('rejects a join with a version below the minimum', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION - 1 };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
  });

  it('rejects a join with a missing version (pre-H4 client)', async () => {
    const options: RoomOptions = {};
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
  });

  it('accepts a join at exactly the minimum version', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await authenticateWorldJoin(options, context, prisma);
    expect(auth.zonePrivacyVersion).toBe(MIN_ZONE_PRIVACY_CLIENT_VERSION);
  });

  it('accepts a join above the minimum version', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION + 5 };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await authenticateWorldJoin(options, context, prisma);
    expect(auth.zonePrivacyVersion).toBe(MIN_ZONE_PRIVACY_CLIENT_VERSION + 5);
  });
});

describe('authenticateWorldJoin: NPC identities', () => {
  beforeEach(() => {
    process.env.NPC_SERVICE_SECRET = 'n'.repeat(40);
  });

  it('accepts a registered NPC with a secure service token', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'n'.repeat(40) };
    const context = makeContext({});

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth.identity).toBe('npc-bob');
    expect(auth.isNpc).toBe(true);
    expect(auth.sessionId).toBeNull();
    expect(validateTenantSessionFreshMock).not.toHaveBeenCalled();
  });

  it('rejects an npc-* join with a wrong service token', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'wrong-secret' };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an npc-* join with no service token', async () => {
    const options: RoomOptions = { identity: 'npc-bob' };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an npc-* join in production when NPC_SERVICE_SECRET is unset', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NPC_SERVICE_SECRET;
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'anything' };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an NPC when the service secret is the insecure default', async () => {
    process.env.NPC_SERVICE_SECRET = 'dev-npc-secret';
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'dev-npc-secret' };
    const context = makeContext({});

    await expect(authenticateWorldJoin(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });
});

describe('authenticateWorldJoin: room-tenant enforcement decoupled from H4 flag (M2/3b, Finding 3)', () => {
  // Passing a prisma resolver lets onAuth resolve the tenant slug from the
  // verified tenantId (id -> slug); 'auth-a' is the authenticated tenant.
  const fakePrisma = {
    tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'tenant-a-id', slug: 'auth-a' })) },
    membership: { findUnique: vi.fn(() => Promise.resolve({ expiresAt: null })) },
  npc: { findUnique: vi.fn(() => Promise.resolve({ id: 'npc-id', identity: 'bob' })) },
  } as unknown as Parameters<typeof authenticateWorldJoin>[2];

  beforeEach(() => {
    verifyAuthJwtMock.mockReturnValue({ userId: 'user-1', tenantId: 'tenant-a-id' });
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-1',
      tenantId: 'tenant-a-id',
    });
    // Tenant-room matching remains controlled by its dedicated setting.
    delete process.env.ZONE_PRIVACY_TENANT_ENFORCE;
  });

  it('resolves and attaches the authenticated tenant slug to client.auth', async () => {
    const options: RoomOptions = { tenant: 'auth-a', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await authenticateWorldJoin(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.tenantSlug).toBe('auth-a');
    expect(auth.tenantId).toBe('tenant-a-id');
  });

  it('DEPLOY-LOCKOUT GUARD (Finding 3): admits a tenant mismatch when only the H4 flag is ON', async () => {
    // The dedicated tenant setting is unset, so the authenticated tenant remains authoritative.
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await authenticateWorldJoin(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.identity).toBe('user-1'); // admitted, not rejected
    expect(auth.tenantSlug).toBe('auth-a'); // authoritative slug still attached
  });

  it('rejects a mismatched options.tenant only when ZONE_PRIVACY_TENANT_ENFORCE is ON', async () => {
    process.env.ZONE_PRIVACY_TENANT_ENFORCE = 'true';
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    await expect(
      authenticateWorldJoin(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma),
    ).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('admits a mismatched options.tenant during rollout (tenant-enforce OFF) but keeps the AUTH slug', async () => {
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await authenticateWorldJoin(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.tenantSlug).toBe('auth-a'); // authoritative, not the spoofed 'spoof-b'
  });

  it('does not reject when options.tenant matches the authenticated slug (tenant-enforce ON)', async () => {
    process.env.ZONE_PRIVACY_TENANT_ENFORCE = 'true';
    const options: RoomOptions = { tenant: 'auth-a', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await authenticateWorldJoin(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.identity).toBe('user-1');
  });
});

describe('authenticateWorldJoin: unresolvable tenant slug fails closed', () => {
  beforeEach(() => {
    verifyAuthJwtMock.mockReturnValue({ userId: 'user-real', tenantId: 'tenant-1' });
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
  });

  it('rejects with tenant_unresolved when the tenant row is gone', async () => {
    const noTenant = {
      ...prisma,
      tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'tenant-1', slug: 'tenant-1' })) },
    } as unknown as WorldJoinPrisma;
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(authenticateWorldJoin(options, context, noTenant)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'tenant_unresolved',
    });
  });

  it('rejects with tenant_unresolved when the slug lookup fails', async () => {
    const failingTenant = {
      ...prisma,
      tenant: { findUnique: vi.fn(() => Promise.reject(new Error('db down'))) },
    } as unknown as WorldJoinPrisma;
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(authenticateWorldJoin(options, context, failingTenant)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'tenant_unresolved',
    });
  });
});

describe('isWorldAuth / requireWorldAuth', () => {
  it('accepts a well-formed WorldAuth value', () => {
    expect(isWorldAuth({ identity: 'a', isNpc: false, zonePrivacyVersion: 1, sessionId: 'session-1' })).toBe(true);
  });

  it('rejects malformed or missing values', () => {
    expect(isWorldAuth(undefined)).toBe(false);
    expect(isWorldAuth(null)).toBe(false);
    expect(isWorldAuth({ identity: 'a' })).toBe(false);
    expect(isWorldAuth({ identity: 'a', isNpc: 'no', zonePrivacyVersion: 1 })).toBe(false);
  });

  it('requireWorldAuth returns the auth payload when present and valid', () => {
    const client = { auth: { identity: 'user-1', isNpc: false, zonePrivacyVersion: 1, sessionId: 'session-1' } };
    expect(requireWorldAuth(client)).toEqual(client.auth);
  });

  it('requireWorldAuth throws fail-closed when client.auth is missing (onAuth did not run)', () => {
    const client = { auth: undefined };
    expect(() => requireWorldAuth(client)).toThrow(ServerError);
  });
});
