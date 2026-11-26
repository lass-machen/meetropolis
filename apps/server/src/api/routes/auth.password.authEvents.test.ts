/**
 * Auth-event coverage for POST /auth/reset (handleAuthReset).
 *
 * A completed password reset must record exactly one
 * `password_reset` success event for the reset account. Failure paths
 * (invalid body, unknown or expired token) and the forgot flow record
 * nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/passwordResetTokens.js', () => ({
  claimPasswordResetToken: vi.fn(),
  invalidatePasswordResetTokens: vi.fn(),
}));

vi.mock('../utils/sessionAuth.js', () => ({
  revokeSessionsForUser: vi.fn(),
  hashSessionToken: vi.fn(),
}));

vi.mock('../../services/authEvents.js', () => ({
  recordAuthEvent: vi.fn(),
}));

import { handleAuthReset } from './auth.password.js';
import { claimPasswordResetToken, invalidatePasswordResetTokens } from '../utils/passwordResetTokens.js';
import { revokeSessionsForUser } from '../utils/sessionAuth.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

function fakeReq(body: unknown): express.Request {
  return { headers: {}, body } as unknown as express.Request;
}

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function fakePrisma() {
  const prisma = { user: { update: vi.fn().mockResolvedValue({}) } } as unknown as PrismaClient;
  return prisma;
}

beforeEach(() => {
  vi.mocked(claimPasswordResetToken).mockReset();
  vi.mocked(invalidatePasswordResetTokens).mockReset();
  vi.mocked(revokeSessionsForUser).mockReset();
  vi.mocked(recordAuthEvent).mockReset();
});

describe('handleAuthReset auth events', () => {
  it('records password_reset success for the reset account', async () => {
    const prisma = fakePrisma();
    vi.mocked(claimPasswordResetToken).mockResolvedValue({ userId: 'user-1' });
    vi.mocked(revokeSessionsForUser).mockResolvedValue(2);
    const req = fakeReq({ token: 'reset-token-1', password: 'new-password-1' });
    const res = fakeRes();

    await handleAuthReset(prisma, req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    expect(recordAuthEvent).toHaveBeenCalledWith(prisma, {
      type: 'password_reset',
      success: true,
      userId: 'user-1',
      req,
    });
  });

  it('records nothing when the token is unknown or expired', async () => {
    const prisma = fakePrisma();
    vi.mocked(claimPasswordResetToken).mockResolvedValue(null);
    const res = fakeRes();

    await handleAuthReset(prisma, fakeReq({ token: 'reset-token-1', password: 'new-password-1' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('records nothing when the body is invalid', async () => {
    const prisma = fakePrisma();
    const res = fakeRes();

    await handleAuthReset(prisma, fakeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(claimPasswordResetToken).not.toHaveBeenCalled();
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });
});
