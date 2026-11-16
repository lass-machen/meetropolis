/**
 * Login timing-channel guard for POST /auth/login (account-enumeration oracle).
 *
 * The endpoint used to skip bcrypt entirely when no account matched: a miss
 * returned ~10x faster than a hit, so the identical 401 body leaked whether an
 * e-mail had an account — exactly what /auth/forgot withholds. The fix runs the
 * comparison against a real DUMMY_PASSWORD_HASH before any early return, so a
 * miss burns the same work as a hit.
 *
 * We do not assert wall-clock timing (flaky under CI load). Instead we assert
 * the load-bearing invariant that makes the timing constant: bcrypt.compare is
 * invoked exactly once whether or not the account exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type express from 'express';
import bcrypt from 'bcryptjs';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'auth-signin-test-secret';
  process.env.API_TOKEN_PEPPER = 'auth-signin-test-pepper';
});

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/authEvents.js', () => ({
  recordAuthEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../utils/sessionAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/sessionAuth.js')>();
  return { ...actual, establishSession: vi.fn(), revokeSessionByToken: vi.fn() };
});

import { handleAuthLogin, handleAuthLogout } from './auth.signin.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import { establishSession, revokeSessionByToken } from '../utils/sessionAuth.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

/** A real hash the "existing user" path verifies a wrong password against. */
const REAL_HASH = bcrypt.hashSync('correct-password', 10);

function fakeReq(email: string, password: string): express.Request {
  return { headers: {}, body: { email, password } } as unknown as express.Request;
}

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res;
}

interface FakeDb {
  user: { findFirst: ReturnType<typeof vi.fn> };
  membership: { findFirst: ReturnType<typeof vi.fn> };
}

function fakePrisma(user: unknown): { prisma: PrismaClient; db: FakeDb } {
  const db: FakeDb = {
    user: { findFirst: vi.fn().mockResolvedValue(user) },
    membership: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { prisma: db as unknown as PrismaClient, db };
}

describe('handleAuthLogin: constant-work password check (enumeration oracle)', () => {
  let compareSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy counts calls and delegates to the real implementation, so the
    // returned booleans (and thus the 401 outcomes) stay authentic.
    compareSpy = vi.spyOn(bcrypt, 'compare');
  });

  afterEach(() => {
    // Restore the pristine original so the next test spies a fresh function and
    // call counts do not accumulate across tests.
    compareSpy.mockRestore();
  });

  it('runs bcrypt.compare exactly once for a NON-existent account (401)', async () => {
    const { prisma } = fakePrisma(null);
    const req = fakeReq('nobody@example.test', 'some-password');
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid credentials' });
  });

  it('runs bcrypt.compare exactly once for an EXISTING account with a wrong password (401)', async () => {
    const { prisma } = fakePrisma({ id: 'u1', email: 'real@example.test', passwordHash: REAL_HASH });
    const req = fakeReq('real@example.test', 'wrong-password');
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    // Same number of bcrypt comparisons as the miss above -> no timing oracle.
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid credentials' });
  });
});

describe('handleAuthLogin: auth event recording (W2N-V30)', () => {
  const recordMock = vi.mocked(recordAuthEvent);
  const establishMock = vi.mocked(establishSession);

  beforeEach(() => {
    recordMock.mockClear();
    establishMock.mockReset();
    establishMock.mockResolvedValue({ token: 'session-token', sessionId: 'session-1', expiresAt: new Date() });
  });

  it('records a failed login without userId for an unknown account (401)', async () => {
    const { prisma } = fakePrisma(null);
    const req = fakeReq('nobody@example.test', 'some-password');
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'login',
      success: false,
      userId: null,
      email: 'nobody@example.test',
      req,
    });
  });

  it('records a failed login with userId for a wrong password (401)', async () => {
    const { prisma } = fakePrisma({ id: 'u1', email: 'real@example.test', passwordHash: REAL_HASH });
    const req = fakeReq('real@example.test', 'wrong-password');
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'login',
      success: false,
      userId: 'u1',
      req,
    });
  });

  it('records a failed login for a guest account without a password (401)', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'guest-1', email: 'guest@example.test', passwordHash: null }),
      },
      membership: { findFirst: vi.fn().mockResolvedValue({ role: 'guest' }) },
    } as unknown as PrismaClient;
    const req = fakeReq('guest@example.test', 'some-password-123');
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'guest_login_not_allowed',
      message: 'Guest users must use their magic link to login',
    });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'login',
      success: false,
      userId: 'guest-1',
      email: 'guest@example.test',
      req,
    });
  });

  it('records nothing for an invalid body (400)', async () => {
    const { prisma } = fakePrisma(null);
    const req = { headers: {}, body: { email: 'not-an-email' } } as unknown as express.Request;
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('records a successful login after the session is established (200)', async () => {
    const user = { id: 'u1', email: 'real@example.test', name: 'Real', passwordHash: REAL_HASH };
    const tenant = { id: 't1', slug: 'acme', name: 'Acme' };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(user),
        findUnique: vi.fn().mockResolvedValue({ email: user.email }),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ tenantId: tenant.id, userId: user.id, role: 'member' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      emailVerification: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const req = fakeReq(user.email, 'correct-password');
    (req as unknown as { tenant: unknown }).tenant = tenant;
    const res = fakeRes();

    await handleAuthLogin(prisma, req, res);

    expect(establishMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'login',
      success: true,
      userId: 'u1',
      tenantId: 't1',
      req,
    });
  });

  it('records no success event when the session cannot be established (500)', async () => {
    const user = { id: 'u1', email: 'real@example.test', name: 'Real', passwordHash: REAL_HASH };
    const tenant = { id: 't1', slug: 'acme', name: 'Acme' };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(user),
        findUnique: vi.fn().mockResolvedValue({ email: user.email }),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ tenantId: tenant.id, userId: user.id, role: 'member' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      emailVerification: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const req = fakeReq(user.email, 'correct-password');
    (req as unknown as { tenant: unknown }).tenant = tenant;
    const res = fakeRes();
    establishMock.mockRejectedValueOnce(new Error('session store down'));

    await handleAuthLogin(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(recordMock).not.toHaveBeenCalled();
  });
});

describe('handleAuthLogout: auth event recording (W2N-V30)', () => {
  const recordMock = vi.mocked(recordAuthEvent);
  const revokeMock = vi.mocked(revokeSessionByToken);

  beforeEach(() => {
    recordMock.mockClear();
    revokeMock.mockReset();
    revokeMock.mockResolvedValue(undefined);
  });

  function logoutPrisma(): PrismaClient {
    return {} as PrismaClient;
  }

  it('records a logout with the session identity and always answers 200', async () => {
    const prisma = logoutPrisma();
    const req = { headers: {}, cookies: {} } as unknown as express.Request;
    setAuthResolution(req, {
      auth: { userId: 'u1', tenantId: 't1', sessionId: 'session-1', tokenHash: 'hash-1' },
    });
    const res = fakeRes();

    await handleAuthLogout(prisma, req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'logout',
      success: true,
      userId: 'u1',
      tenantId: 't1',
      req,
    });
  });

  it('records a logout with nulls when nothing is known about the session', async () => {
    const prisma = logoutPrisma();
    const req = { headers: {}, cookies: {} } as unknown as express.Request;
    setAuthResolution(req, { auth: null });
    const res = fakeRes();

    await handleAuthLogout(prisma, req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(prisma, {
      type: 'logout',
      success: true,
      userId: null,
      tenantId: null,
      req,
    });
  });

  it('still answers 200 with an event when revoking the session fails', async () => {
    const prisma = logoutPrisma();
    const req = { headers: {}, cookies: { auth_token: 'stale-token' } } as unknown as express.Request;
    setAuthResolution(req, {
      auth: { userId: 'u1', tenantId: 't1', sessionId: 'session-1', tokenHash: 'hash-1' },
    });
    const res = fakeRes();
    revokeMock.mockRejectedValueOnce(new Error('session store down'));

    await handleAuthLogout(prisma, req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(recordMock).toHaveBeenCalledTimes(1);
  });
});
