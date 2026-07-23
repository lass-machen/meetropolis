/**
 * H4 (audio-zone privacy) blocker: /livekit/token must never trust a
 * client-supplied `identity`, and must only mint tokens for the one
 * LiveKit room the zone orchestrator actually reconciles (`world`).
 * See knowledge/... H4 spec, WP0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type express from 'express';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const requireAuthMock = vi.fn();
const getTenantFromReqMock = vi.fn();
const requireMembershipMock = vi.fn();
vi.mock('../utils/authHelpers.js', () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
  getTenantFromReq: (...args: unknown[]) => getTenantFromReqMock(...args),
  requireMembership: (...args: unknown[]) => requireMembershipMock(...args),
}));

const createLivekitTokenMock = vi.fn();
vi.mock('../../livekit.js', () => ({
  createLivekitToken: (...args: unknown[]) => createLivekitTokenMock(...args),
}));

import { handleLivekitToken, handleReadyz } from './health.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

function fakeReq(body: Record<string, unknown>): express.Request {
  return { body, headers: {} } as unknown as express.Request;
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
  return { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } as unknown as PrismaClient;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  requireAuthMock.mockReset();
  getTenantFromReqMock.mockReset();
  requireMembershipMock.mockReset();
  // Default: caller IS a member of the resolved tenant. The membership-gate
  // suite below overrides this per case.
  requireMembershipMock.mockResolvedValue({ role: 'member' });
  createLivekitTokenMock.mockReset();
  process.env.LIVEKIT_API_KEY = 'devkey';
  process.env.LIVEKIT_API_SECRET = 'secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('handleLivekitToken: identity hardening', () => {
  it('overrides a client-supplied identity with the authenticated user id', async () => {
    requireAuthMock.mockReturnValue({ userId: 'user-real' });
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');

    const req = fakeReq({ roomName: 'world', identity: 'user-victim' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'user-real', roomName: 'acme:world' }),
    );
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('jwt-token');
  });

  it('rejects a roomName other than the single reconciled room', async () => {
    requireAuthMock.mockReturnValue({ userId: 'user-real' });
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });

    const req = fakeReq({ roomName: 'some-other-room', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_room_name' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before touching LiveKit', async () => {
    requireAuthMock.mockReturnValue(null);

    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no resolvable tenant', async () => {
    requireAuthMock.mockReturnValue({ userId: 'user-real' });
    getTenantFromReqMock.mockReturnValue(null);

    const req = fakeReq({ roomName: 'world', identity: 'user-real' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tenant_required' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });
});

describe('handleLivekitToken: cross-tenant membership gate (A13)', () => {
  beforeEach(() => {
    requireAuthMock.mockReturnValue({ userId: 'lobster-owner' });
    // X-Tenant precedence has already forced req.tenant to a FOREIGN tenant.
    getTenantFromReqMock.mockReturnValue({ id: 't-default', slug: 'default' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');
  });

  it('refuses to mint a token for a tenant the caller is not a member of (403, no token)', async () => {
    // The attacker holds a valid session but no membership in `default`.
    requireMembershipMock.mockResolvedValue(null);

    const req = fakeReq({ roomName: 'world', identity: 'lobster-owner' });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(createLivekitTokenMock).not.toHaveBeenCalled();
  });

  it('mints a token for the own tenant when a membership exists (200)', async () => {
    requireMembershipMock.mockResolvedValue({ role: 'member' });

    const req = fakeReq({
      roomName: 'world',
      identity: 'lobster-owner',
      zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'lobster-owner', roomName: 'default:world' }),
    );
    expect(res.send).toHaveBeenCalledWith('jwt-token');
  });
});

describe('handleLivekitToken: H4 client zone-privacy version gate', () => {
  beforeEach(() => {
    requireAuthMock.mockReturnValue({ userId: 'user-real' });
    getTenantFromReqMock.mockReturnValue({ id: 't1', slug: 'acme' });
    createLivekitTokenMock.mockResolvedValue('jwt-token');
  });

  it('mints canPublish:false when zonePrivacyVersion is missing (pre-H4 client)', async () => {
    const req = fakeReq({ roomName: 'world', identity: 'user-real', canPublish: true });
    const res = fakeRes();
    await handleLivekitToken(fakePrisma(), req, res);

    expect(createLivekitTokenMock).toHaveBeenCalledWith(expect.objectContaining({ canPublish: false }));
  });

  it('mints canPublish:false when zonePrivacyVersion is below the minimum, but leaves canSubscribe untouched', async () => {
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

describe('handleReadyz: livekitAdmin visibility', () => {
  beforeEach(() => {
    createLivekitTokenMock.mockResolvedValue('jwt-token');
    process.env.LIVEKIT_URL = 'ws://livekit:7880';
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
