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

import { handleAuthLogin } from './auth.signin.js';
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
