/**
 * Unit tests for the H4 hardening gate: identity binding (onAuth) +
 * client zone-privacy version gate, and the wire protocol gate that comes
 * before both.
 *
 * All external dependencies (logger, sessionAuth.validateSessionToken) are
 * mocked so no real JWT signing/DB is required. Tests exercise the pure
 * decision logic in authenticateWorldJoin/isWorldAuth/requireWorldAuth.
 *
 * The gate resolves tokens through `validateSessionToken` (the session ROW is
 * the authority), not through `verifyAuthJwt` (signature only) — a revoked
 * session must not open the world. `validateSessionToken` returning null is
 * therefore the single "not authenticated" signal here, covering a bad
 * signature AND a valid signature whose session is gone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerError, type AuthContext } from '@colyseus/core';
import {
  MIN_WORLD_WIRE_PROTOCOL_VERSION,
  MIN_ZONE_PRIVACY_CLIENT_VERSION,
  WORLD_WIRE_PROTOCOL_VERSION,
} from '@meetropolis/shared';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const validateSessionTokenMock = vi.fn();
vi.mock('../../api/utils/sessionAuth.js', () => ({
  validateSessionToken: (...args: unknown[]) => validateSessionTokenMock(...args),
}));

import { logger } from '../../logger.js';
import {
  authenticateWorldJoin,
  isWorldAuth,
  requireWorldAuth,
  AUTH_REJECTED_CODE,
  CLIENT_TOO_OLD_CODE,
} from './onAuth.js';
import type { RoomOptions } from '../WorldRoom.js';

type WorldJoinPrisma = Parameters<typeof authenticateWorldJoin>[2];

/** Default resolver: no tenant row, so no authoritative slug is attached. */
const prisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve(null)) },
  session: { findUnique: vi.fn(), update: vi.fn() },
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

/**
 * Join as a client that speaks the current wire protocol, which is what every
 * test outside the wire gate describe below is about. A test that needs a
 * different wire version overrides `wireProtocolVersion` in its options.
 */
function join(options: RoomOptions, context: AuthContext, prismaArg: WorldJoinPrisma = prisma) {
  return authenticateWorldJoin({ wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION, ...options }, context, prismaArg);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  validateSessionTokenMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
  // Default the suite to the fully-enforced gate; the staged-rollout describe
  // block below turns it off explicitly to exercise the transitional path.
  process.env.ZONE_PRIVACY_AUTH_ENFORCE = 'true';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('authenticateWorldJoin: user identity binding', () => {
  it('binds identity to the JWT subject, ignoring a client-supplied options.identity', async () => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-real', tenantId: 'tenant-1' });
    const options: RoomOptions = { identity: 'user-victim', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await join(options, context, prisma);

    expect(auth).toEqual({
      identity: 'user-real',
      tenantId: 'tenant-1',
      isNpc: false,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    expect(validateSessionTokenMock).toHaveBeenCalledWith(prisma, 'jwt-abc');
  });

  it('prefers context.token (Bearer/native) over the auth_token cookie when both are present', async () => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-native' });
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ token: 'bearer-jwt', cookie: 'auth_token=cookie-jwt' });

    await join(options, context, prisma);

    expect(validateSessionTokenMock).toHaveBeenCalledWith(prisma, 'bearer-jwt');
  });

  it('rejects a join with no cookie and no bearer token (fail-closed)', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
    });
    expect(validateSessionTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a join whose token fails JWT verification', async () => {
    validateSessionTokenMock.mockResolvedValue(null);
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=expired-or-tampered' });

    await expect(join(options, context, prisma)).rejects.toBeInstanceOf(ServerError);
    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects a REVOKED session even though the JWT signature is still valid', async () => {
    // The regression this gate exists for: logout / session revocation /
    // password reset delete the Session row but cannot un-sign the JWT, which
    // stays cryptographically valid for its full 30-day lifetime. Resolving the
    // token through validateSessionToken (null = no live row) is what closes the
    // world door at the same moment REST closes; verifyAuthJwt would still say
    // "signed by us" and admit the join.
    validateSessionTokenMock.mockResolvedValue(null);
    const options: RoomOptions = { identity: 'user-revoked', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=validly-signed-but-revoked' });

    await expect(join(options, context, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
    });
    expect(validateSessionTokenMock).toHaveBeenCalledWith(prisma, 'validly-signed-but-revoked');
  });

  it('accepts a guest JWT identically to a regular user JWT (same {sub,tid} shape)', async () => {
    // Guest logins sign the exact same JWT payload shape as regular users
    // (see apps/server/src/api/routes/guests.ts handleGuestLogin) - the
    // gate must not special-case them.
    validateSessionTokenMock.mockResolvedValue({ userId: 'guest-42', tenantId: 'tenant-acme' });
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=guest-jwt' });

    const auth = await join(options, context, prisma);

    expect(auth).toEqual({
      identity: 'guest-42',
      tenantId: 'tenant-acme',
      isNpc: false,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
  });
});

describe('authenticateWorldJoin: staged rollout (ZONE_PRIVACY_AUTH_ENFORCE off)', () => {
  beforeEach(() => {
    delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
  });

  it('admits a token-less legacy join with the client-supplied identity instead of rejecting', async () => {
    const options: RoomOptions = { identity: 'legacy-user', zonePrivacyVersion: 0 };
    const context = makeContext({});

    const auth = await join(options, context, prisma);

    expect(auth).toEqual({ identity: 'legacy-user', isNpc: false, zonePrivacyVersion: 0 });
    expect(validateSessionTokenMock).not.toHaveBeenCalled();
  });

  it('still rejects a token-less join that has no fallback identity at all', async () => {
    const options: RoomOptions = { zonePrivacyVersion: 0 };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('binds identity to the verified JWT even in staged mode when a token is present', async () => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-real', tenantId: 'tenant-1' });
    const options: RoomOptions = { identity: 'user-victim', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await join(options, context, prisma);

    expect(auth.identity).toBe('user-real');
  });

  it('admits an old-version but authenticated client instead of rejecting', async () => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-old-client' });
    const options: RoomOptions = { zonePrivacyVersion: 0 };
    const context = makeContext({ cookie: 'auth_token=jwt-old' });

    const auth = await join(options, context, prisma);

    expect(auth.identity).toBe('user-old-client');
    expect(auth.isNpc).toBe(false);
  });
});

describe('authenticateWorldJoin: client zone-privacy version gate', () => {
  beforeEach(() => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-real' });
  });

  it('rejects a join with a version below the minimum', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION - 1 };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
  });

  it('rejects a join with a missing version (pre-H4 client)', async () => {
    const options: RoomOptions = {};
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: CLIENT_TOO_OLD_CODE });
  });

  it('accepts a join at exactly the minimum version', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await join(options, context, prisma);
    expect(auth.zonePrivacyVersion).toBe(MIN_ZONE_PRIVACY_CLIENT_VERSION);
  });

  it('accepts a join above the minimum version', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION + 5 };
    const context = makeContext({ cookie: 'auth_token=jwt-abc' });

    const auth = await join(options, context, prisma);
    expect(auth.zonePrivacyVersion).toBe(MIN_ZONE_PRIVACY_CLIENT_VERSION + 5);
  });
});

describe('authenticateWorldJoin: NPC identities', () => {
  beforeEach(() => {
    process.env.NPC_SERVICE_SECRET = 'test-npc-secret';
  });

  it('accepts an npc-* join with the correct service token, exempt from the version gate', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'test-npc-secret' };
    const context = makeContext({});

    const auth = await join(options, context, prisma);

    expect(auth.identity).toBe('npc-bob');
    expect(auth.isNpc).toBe(true);
    expect(validateSessionTokenMock).not.toHaveBeenCalled();
  });

  it('rejects an npc-* join with a wrong service token', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'wrong-secret' };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an npc-* join with no service token', async () => {
    const options: RoomOptions = { identity: 'npc-bob' };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an npc-* join in production when NPC_SERVICE_SECRET is unset', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NPC_SERVICE_SECRET;
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'anything' };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });

  it('rejects an npc-* join in production when NPC_SERVICE_SECRET is left at the insecure default', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NPC_SERVICE_SECRET = 'dev-npc-secret';
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'dev-npc-secret' };
    const context = makeContext({});

    await expect(join(options, context, prisma)).rejects.toMatchObject({ code: AUTH_REJECTED_CODE });
  });
});

describe('authenticateWorldJoin: room-tenant enforcement decoupled from H4 flag (M2/3b, Finding 3)', () => {
  // Passing a prisma resolver lets onAuth resolve the tenant slug from the
  // verified tenantId (id -> slug); 'auth-a' is the authenticated tenant.
  const fakePrisma = {
    tenant: { findUnique: vi.fn(() => Promise.resolve({ slug: 'auth-a' })) },
  } as unknown as Parameters<typeof authenticateWorldJoin>[2];

  beforeEach(() => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-a-id' });
    // The suite default leaves ZONE_PRIVACY_AUTH_ENFORCE=true (the H4 identity
    // gate, already ON in prod). The tenant-room match must ride on its OWN
    // flag, so clear that one by default here.
    delete process.env.ZONE_PRIVACY_TENANT_ENFORCE;
  });

  it('resolves and attaches the authenticated tenant slug to client.auth', async () => {
    const options: RoomOptions = { tenant: 'auth-a', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await join(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.tenantSlug).toBe('auth-a');
    expect(auth.tenantId).toBe('tenant-a-id');
  });

  it('DEPLOY-LOCKOUT GUARD (Finding 3): admits a tenant mismatch when only the H4 flag is ON', async () => {
    // Reproduces the production state: ZONE_PRIVACY_AUTH_ENFORCE=true (suite
    // default) but ZONE_PRIVACY_TENANT_ENFORCE unset. Old apex clients post
    // options.tenant='default' for every tenant; if the tenant match rode on the
    // already-on H4 flag they would be mass-rejected on the next deploy. The
    // decoupling MUST admit them (identity bound, authoritative slug attached).
    expect(process.env.ZONE_PRIVACY_AUTH_ENFORCE).toBe('true');
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await join(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.identity).toBe('user-1'); // admitted, not rejected
    expect(auth.tenantSlug).toBe('auth-a'); // authoritative slug still attached
  });

  it('rejects a mismatched options.tenant only when ZONE_PRIVACY_TENANT_ENFORCE is ON', async () => {
    process.env.ZONE_PRIVACY_TENANT_ENFORCE = 'true';
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    await expect(join(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
    });
  });

  it('admits a mismatched options.tenant during rollout (tenant-enforce OFF) but keeps the AUTH slug', async () => {
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await join(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.tenantSlug).toBe('auth-a'); // authoritative, not the spoofed 'spoof-b'
  });

  it('does not reject when options.tenant matches the authenticated slug (tenant-enforce ON)', async () => {
    process.env.ZONE_PRIVACY_TENANT_ENFORCE = 'true';
    const options: RoomOptions = { tenant: 'auth-a', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };
    const auth = await join(options, makeContext({ cookie: 'auth_token=x' }), fakePrisma);
    expect(auth.identity).toBe('user-1');
  });
});

describe('authenticateWorldJoin: wire protocol gate', () => {
  const cookie = makeContext({ cookie: 'auth_token=jwt-abc' });

  beforeEach(() => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-real' });
    process.env.NPC_SERVICE_SECRET = 'test-npc-secret';
  });

  it.each([
    ['enforced', 'true'],
    ['staged', undefined],
  ])('rejects a join without a wire version with 4426 client_too_old (%s)', async (_label, enforce) => {
    if (enforce) process.env.ZONE_PRIVACY_AUTH_ENFORCE = enforce;
    else delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };

    await expect(authenticateWorldJoin(options, cookie, prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
      message: 'client_too_old',
    });
    expect(validateSessionTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    ['below the minimum', MIN_WORLD_WIRE_PROTOCOL_VERSION - 1],
    ['zero', 0],
    ['negative', -1],
    ['a string', String(WORLD_WIRE_PROTOCOL_VERSION)],
    ['null', null],
    ['a fraction', WORLD_WIRE_PROTOCOL_VERSION + 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a wire version that is %s', async (_label, wireProtocolVersion) => {
    // Join options come off the wire as JSON, so the value can be anything.
    const options = {
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
      wireProtocolVersion,
    } as unknown as RoomOptions;

    await expect(authenticateWorldJoin(options, cookie, prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });
  });

  it('judges the wire version before the token: an outdated client without one is told to update, not to log in', async () => {
    const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };

    await expect(authenticateWorldJoin(options, makeContext({}), prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });
  });

  it('is not staged: an old wire version is refused while the zone-privacy gate would admit the client', async () => {
    delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
    const options: RoomOptions = { zonePrivacyVersion: 0, wireProtocolVersion: MIN_WORLD_WIRE_PROTOCOL_VERSION - 1 };

    await expect(authenticateWorldJoin(options, cookie, prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });
  });

  it('refuses an NPC join without a wire version, even with the right service secret', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'test-npc-secret' };

    await expect(authenticateWorldJoin(options, makeContext({}), prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
      message: 'client_too_old',
    });
  });

  it('judges the wire version of an NPC before its service secret', async () => {
    const options: RoomOptions = { identity: 'npc-bob', serviceToken: 'wrong-secret' };

    await expect(authenticateWorldJoin(options, makeContext({}), prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });
  });

  it.each([
    ['exactly the minimum', MIN_WORLD_WIRE_PROTOCOL_VERSION],
    ['above the minimum', MIN_WORLD_WIRE_PROTOCOL_VERSION + 5],
  ])(
    'admits a join with a wire version %s and does not carry it into client.auth',
    async (_label, wireProtocolVersion) => {
      const options: RoomOptions = { zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION, wireProtocolVersion };

      const auth = await authenticateWorldJoin(options, cookie, prisma);

      expect(auth).toEqual({
        identity: 'user-real',
        isNpc: false,
        zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
      });
    },
  );
});

describe('authenticateWorldJoin: the refused wire version is logged bounded', () => {
  // The gate runs before authentication, so an anonymous client fully controls
  // the version. A log entry must not grow with what it sends.
  const HUGE = 900_000;
  const hugeString = 'x'.repeat(HUGE);
  const MAX_LOG_CHARS = 1_000;

  beforeEach(() => {
    for (const fn of [logger.warn, logger.info, logger.debug, logger.error]) vi.mocked(fn).mockClear();
  });

  /** Everything the mocked logger was asked to write, as the JSON a log line would carry. */
  function loggedText(): string {
    const calls = [logger.warn, logger.info, logger.debug, logger.error].flatMap((fn) => vi.mocked(fn).mock.calls);
    return JSON.stringify(calls);
  }

  it.each([
    ['a long string', hugeString, '<string>'],
    ['a large object', { payload: hugeString }, '<object>'],
    ['a large array', [hugeString], '<object>'],
    ['null', null, '<object>'],
    ['NaN', Number.NaN, '<number>'],
  ])('logs a wire version that is %s as a fixed placeholder', async (_label, wireProtocolVersion, placeholder) => {
    const options = { wireProtocolVersion } as unknown as RoomOptions;

    await expect(authenticateWorldJoin(options, makeContext({}), prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });

    expect(loggedText()).toContain(placeholder);
    expect(loggedText().length).toBeLessThan(MAX_LOG_CHARS);
  });

  it('logs a rejected wire version that is a finite number as the number', async () => {
    const options: RoomOptions = { wireProtocolVersion: MIN_WORLD_WIRE_PROTOCOL_VERSION - 1 };

    await expect(authenticateWorldJoin(options, makeContext({}), prisma)).rejects.toMatchObject({
      code: CLIENT_TOO_OLD_CODE,
    });

    expect(vi.mocked(logger.warn).mock.calls[0]?.[1]).toMatchObject({
      wireProtocolVersion: MIN_WORLD_WIRE_PROTOCOL_VERSION - 1,
    });
  });
});

describe('isWorldAuth / requireWorldAuth', () => {
  it('accepts a well-formed WorldAuth value', () => {
    expect(isWorldAuth({ identity: 'a', isNpc: false, zonePrivacyVersion: 1 })).toBe(true);
  });

  it('rejects malformed or missing values', () => {
    expect(isWorldAuth(undefined)).toBe(false);
    expect(isWorldAuth(null)).toBe(false);
    expect(isWorldAuth({ identity: 'a' })).toBe(false);
    expect(isWorldAuth({ identity: 'a', isNpc: 'no', zonePrivacyVersion: 1 })).toBe(false);
  });

  it('requireWorldAuth returns the auth payload when present and valid', () => {
    const client = { auth: { identity: 'user-1', isNpc: false, zonePrivacyVersion: 1 } };
    expect(requireWorldAuth(client)).toEqual(client.auth);
  });

  it('requireWorldAuth throws fail-closed when client.auth is missing (onAuth did not run)', () => {
    const client = { auth: undefined };
    expect(() => requireWorldAuth(client)).toThrow(ServerError);
  });
});
