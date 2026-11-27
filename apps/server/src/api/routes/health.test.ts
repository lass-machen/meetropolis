/**
 * H4 (audio-zone privacy) blocker: /livekit/token must never trust a
 * client-supplied `identity`, and must only mint tokens for the one
 * LiveKit room the zone orchestrator actually reconciles (`world`).
 * See knowledge/... H4 spec, WP0.
 *
 * A LiveKit token belongs to a login session: the route resolves the raw
 * token from the `auth_token` cookie or the `Authorization: Bearer` header
 * against the database and takes the identity from that session. A
 * credential that is not a live session therefore never obtains an SFU
 * token, and the identity is the session's user, never the client's word.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type express from 'express';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getTenantFromReqMock = vi.fn();
vi.mock('../utils/authHelpers.js', () => ({
  getTenantFromReq: (...args: unknown[]) => getTenantFromReqMock(...args),
  // The session reference carried by the LiveKit token is derived from it.
  getJwtSecret: () => 'test-jwt-secret',
}));

const validateTenantSessionFreshMock = vi.fn();
vi.mock('../utils/sessionAuth.js', () => ({
  validateTenantSessionFresh: (...args: unknown[]) => validateTenantSessionFreshMock(...args),
}));

const createLivekitTokenMock = vi.fn();
vi.mock('../../livekit.js', () => ({
  createLivekitToken: (...args: unknown[]) => createLivekitTokenMock(...args),
}));

import { handleLivekitToken, handleReadyz } from './health.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

/** Credential the request helpers present to the route. */
const SESSION_TOKEN = 'session-token';

/** A live session of a member of the tenant the route resolves. */
function allowedSession(userId: string, tenantId: string, sessionId = 'db-session-1') {
  return { status: 'allowed', userId, sessionId, tenantId, access: 'member' };
}

/** Request that presents the credential as the `auth_token` cookie. */
function fakeReq(body: Record<string, unknown>, token: string | null = SESSION_TOKEN): express.Request {
  const cookies: Record<string, string> = {};
  if (token !== null) cookies.auth_token = token;
  return { body, headers: {}, cookies } as unknown as express.Request;
}

/** Request that presents the credential as a bearer token. */
function fakeBearerReq(body: Record<string, unknown>, token: string = SESSION_TOKEN): express.Request {
  return { body, headers: { authorization: `Bearer ${token}` } } as unknown as express.Request;
}

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.type = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

function fakePrisma(): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    membership: { findUnique: vi.fn().mockResolvedValue({ expiresAt: null }) },
  } as unknown as PrismaClient;
}

/** Registers exactly one matching materialized world session for the given verified login. */
function setWorldPresence(opts: {
  userId: string;
  authSessionId?: string;
  tenantId: string;
  tenantSlug: string;
}): void {
  const sessionId = 'colyseus-1';
  const entry = {
    sessionId,
    userId: opts.userId,
    authSessionId: opts.authSessionId ?? 'db-session-1',
    tenantId: opts.tenantId,
    tenantSlug: opts.tenantSlug,
    epoch: 3,
    leaseUntil: Date.now() + 60_000,
    accessExpiresAt: null,
  };
  const byId = new Map([[sessionId, entry]]);
  const players = new Map([[sessionId, { identity: opts.userId, isNpc: false }]]);
  (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set([
    {
      clients: [{ sessionId }],
      state: { players },
      worldAccess: { entryFor: (id: string) => byId.get(id) },
    },
  ]);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  getTenantFromReqMock.mockReset();
  validateTenantSessionFreshMock.mockReset();
  // Default: the caller presents a live session in the resolved tenant.
  validateTenantSessionFreshMock.mockResolvedValue(allowedSession('user-real', 't1'));
  createLivekitTokenMock.mockReset();
  (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = undefined;
  process.env.LIVEKIT_API_KEY = 'devkey';
  process.env.LIVEKIT_API_SECRET = 'secret';
});

afterEach(() => {
  (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = undefined;
  process.env = { ...ORIGINAL_ENV };
});

describe('handleLivekitToken: identity hardening', () => {
  it('overrides a client-supplied identity with the authenticated user id', async () => {
    validateTenantSessionFreshMock.mockResolvedValue(allowedSession('user-real', 't1'));
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');
    setWorldPresence({ userId: 'user-real', tenantId: 't1', tenantSlug: 'acme' });

    const prisma = fakePrisma();
    const req = fakeReq({ roomName: 'world', identity: 'user-victim' });
    const res = fakeRes();
    await handleLivekitToken(prisma, req, res);

    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, SESSION_TOKEN, 't1');
    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'user-real', roomName: 'acme:world' }),
    );
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('jwt-token');
    // The minted token is bound to the session it was issued for.
    const tokenArgs = createLivekitTokenMock.mock.calls[0][0] as { metadata: string };
    const metadata = JSON.parse(tokenArgs.metadata) as Record<string, unknown>;
    expect(Object.keys(metadata)).toContain('sessionRef');
    expect(typeof metadata.sessionRef).toBe('string');
  });

  it('rejects a roomName other than the single reconciled room', async () => {
    validateTenantSessionFreshMock.mockResolvedValue(allowedSession('user-real', 't1'));
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });

    const req = fakeReq({ roomName: 'some-other-room', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_room_name' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a request without a session credential before touching LiveKit', async () => {
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });

    const req = fakeReq({ roomName: 'world', identity: 'user-real' }, null);
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
    expect(validateTenantSessionFreshMock).not.toHaveBeenCalled();
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a request whose credential does not resolve to a login session', async () => {
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    validateTenantSessionFreshMock.mockResolvedValue({ status: 'unauthenticated' });

    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no resolvable tenant', async () => {
    getTenantFromReqMock.mockReturnValue(null);

    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tenant_required' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('refuses to mint a token for a reserved service identity', async () => {
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });

    for (const reservedId of ['npc-scout', 'svc-transcriber']) {
      validateTenantSessionFreshMock.mockResolvedValue(allowedSession(reservedId, 't1'));
      const req = fakeReq({ roomName: 'world', identity: reservedId });
      const res = fakeRes();
      await handleLivekitToken(fakePrisma(), req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    }
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });
});

describe('handleLivekitToken: tenant membership gate', () => {
  beforeEach(() => {
    validateTenantSessionFreshMock.mockResolvedValue(allowedSession('lobster-owner', 't-default'));
    // X-Tenant precedence has already forced req.tenant to a FOREIGN tenant.
    getTenantFromReqMock.mockReturnValue({ id: 't-default', slug: 'default' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');
  });

  it('refuses to mint a token for a tenant the caller is not a member of (403, no token)', async () => {
    // The attacker holds a valid session but no membership in `default`.
    validateTenantSessionFreshMock.mockResolvedValue({ status: 'forbidden', reason: 'membership_unavailable' });

    const req = fakeReq({ roomName: 'world', identity: 'lobster-owner' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('mints a token for the own tenant when a membership exists (200)', async () => {
    setWorldPresence({ userId: 'lobster-owner', tenantId: 't-default', tenantSlug: 'default' });
    const prisma = fakePrisma();
    const req = fakeBearerReq({
      roomName: 'world',
      identity: 'lobster-owner',
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    const res = fakeRes();
    await handleLivekitToken(prisma, req, res);

    expect(validateTenantSessionFreshMock).toHaveBeenCalledWith(prisma, SESSION_TOKEN, 't-default');
    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'lobster-owner', roomName: 'default:world' }),
    );
    expect(res.send).toHaveBeenCalledWith('jwt-token');
  });
});

describe('handleLivekitToken: H4 client zone-privacy version gate', () => {
  beforeEach(() => {
    validateTenantSessionFreshMock.mockResolvedValue(allowedSession('user-real', 't1'));
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');
    setWorldPresence({ userId: 'user-real', tenantId: 't1', tenantSlug: 'acme' });
  });

  it('mints canPublish:false when zonePrivacyVersion is missing (pre-H4 client)', async () => {
    const req = fakeReq({ roomName: 'world', identity: 'user-real', canPublish: true });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(expect.objectContaining({ canPublish: false }));
  });

  it('mints canPublish:false when zonePrivacyVersion is below the minimum, but keeps canSubscribe true', async () => {
    const req = fakeReq({
      roomName: 'world',
      identity: 'user-real',
      canPublish: true,
      canSubscribe: true,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION - 1,
    });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ canPublish: false, canSubscribe: true }),
    );
  });

  it('mints canPublish as requested when zonePrivacyVersion meets the minimum', async () => {
    const req = fakeReq({
      roomName: 'world',
      identity: 'user-real',
      canPublish: true,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(expect.objectContaining({ canPublish: true }));
  });

  it('mints canPublish as requested when zonePrivacyVersion is above the minimum', async () => {
    const req = fakeReq({
      roomName: 'world',
      identity: 'user-real',
      canPublish: true,
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION + 3,
    });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(expect.objectContaining({ canPublish: true }));
  });
});

describe('handleLivekitToken: world presence gate', () => {
  const NOW = 1_790_000_000_000;

  function worldRoom(
    opts: {
      sessionId?: string;
      userId?: string;
      authSessionId?: string | null;
      tenantId?: string;
      tenantSlug?: string;
      leaseUntil?: number | null;
      accessExpiresAt?: number | null;
      epoch?: number;
      withClient?: boolean;
      playerIdentity?: string;
    } = {},
  ) {
    const sessionId = opts.sessionId ?? 'colyseus-1';
    const entry = {
      sessionId,
      userId: opts.userId ?? 'user-real',
      authSessionId: opts.authSessionId === undefined ? 'db-session-1' : opts.authSessionId,
      tenantId: opts.tenantId ?? 't1',
      tenantSlug: opts.tenantSlug ?? 'acme',
      epoch: opts.epoch ?? 3,
      leaseUntil: opts.leaseUntil === undefined ? NOW + 60_000 : opts.leaseUntil,
      accessExpiresAt: opts.accessExpiresAt === undefined ? null : opts.accessExpiresAt,
    };
    const byId = new Map([[sessionId, entry]]);
    const players = new Map([[sessionId, { identity: opts.playerIdentity ?? 'user-real', isNpc: false }]]);
    return {
      room: {
        clients: (opts.withClient === false ? [] : [{ sessionId }]) as unknown as never[],
        state: { players } as unknown as never,
        worldAccess: { entryFor: (id: string) => byId.get(id) } as unknown as never,
      },
      entry,
    };
  }

  function setWorldRooms(rooms: unknown[]): void {
    (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set(rooms as never[]);
  }

  beforeEach(() => {
    validateTenantSessionFreshMock.mockResolvedValue(allowedSession('user-real', 't1'));
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    createLivekitTokenMock.mockReset().mockResolvedValue('jwt-token');
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = undefined;
  });

  afterEach(() => {
    (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = undefined;
    vi.useRealTimers();
  });

  it('requires active world presence: no mint without a world (403 world_session_required)', async () => {
    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'world_session_required' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a foreign login session despite the same identity and tenant', async () => {
    const { room } = worldRoom({ authSessionId: 'db-session-fremd' });
    setWorldRooms([room]);

    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'world_session_required' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong tenant and an expired world lease', async () => {
    const { room: wrongTenant } = worldRoom({ tenantId: 't-anders', tenantSlug: 'anders' });
    setWorldRooms([wrongTenant]);
    const resTenant = fakeRes();
    await handleLivekitToken(fakePrisma(), fakeReq({ roomName: 'world', identity: 'user-real' }), resTenant);
    expect(resTenant.status).toHaveBeenCalledWith(403);
    expect(resTenant.json).toHaveBeenCalledWith({ error: 'world_session_required' });

    const { room: expired } = worldRoom({ leaseUntil: NOW - 1_000 });
    setWorldRooms([expired]);
    const resLease = fakeRes();
    await handleLivekitToken(fakePrisma(), fakeReq({ roomName: 'world', identity: 'user-real' }), resLease);
    expect(resLease.status).toHaveBeenCalledWith(403);
    expect(resLease.json).toHaveBeenCalledWith({ error: 'world_session_required' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('mints for a valid world and overrides the client identity with the auth identity', async () => {
    const { room } = worldRoom();
    setWorldRooms([room]);

    const req = fakeReq({ roomName: 'world', identity: 'user-fremd' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'user-real', roomName: 'acme:world' }),
    );
    expect(res.send).toHaveBeenCalledWith('jwt-token');
  });

  it('sends no JWT when the world is left during signing', async () => {
    const { room } = worldRoom();
    setWorldRooms([room]);
    createLivekitTokenMock.mockImplementation(() => {
      (globalThis as { activeWorldRooms?: Set<unknown> }).activeWorldRooms = new Set();
      return Promise.resolve('jwt-token');
    });

    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), fakeReq({ roomName: 'world', identity: 'user-real' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'world_session_required' });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('sends no JWT when the entry epoch changes during signing', async () => {
    const { room, entry } = worldRoom();
    setWorldRooms([room]);
    createLivekitTokenMock.mockImplementation(() => {
      entry.epoch += 1;
      return Promise.resolve('jwt-token');
    });

    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), fakeReq({ roomName: 'world', identity: 'user-real' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'world_session_required' });
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('handleReadyz: livekitAdmin visibility', () => {
  beforeEach(() => {
    createLivekitTokenMock.mockResolvedValue('jwt-token');
    process.env.LIVEKIT_URL = 'ws://host.docker.internal:7880';
  });

  it('reports livekitAdmin ok when API key/secret/URL are all configured, without affecting `ok`', async () => {
    const res = fakeRes();
    await handleReadyz(fakePrisma(), fakeReq({}), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ livekit: 'ok', livekitAdmin: 'ok', ok: true }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reports livekitAdmin disabled (but still ok=true) when only LIVEKIT_URL is missing', async () => {
    // Regression guard: a deployment that sets LIVEKIT_EXTERNAL_URL but
    // forgets LIVEKIT_URL must not pass readyz silently — see
    // checkLivekitAdmin's doc comment.
    delete process.env.LIVEKIT_URL;
    const res = fakeRes();
    await handleReadyz(fakePrisma(), fakeReq({}), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ livekit: 'ok', livekitAdmin: 'disabled', ok: true }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reports livekitAdmin disabled when API key/secret are entirely absent', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    const res = fakeRes();
    await handleReadyz(fakePrisma(), fakeReq({}), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ livekit: 'missing', livekitAdmin: 'disabled', ok: false }),
    );
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
