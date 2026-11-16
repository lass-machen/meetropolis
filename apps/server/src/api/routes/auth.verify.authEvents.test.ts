/**
 * Auth-event coverage for POST /auth/verify (handleVerifyToken).
 *
 * A consumed email proof must record exactly one `email_verification`
 * success event for the verified account. The proof result itself carries
 * no user id, so the handler resolves it from the consumed proof row.
 * Failure paths record nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

vi.mock('../utils/emailProof.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/emailProof.js')>();
  return { ...actual, completeEmailProof: vi.fn() };
});

vi.mock('../../services/authEvents.js', () => ({
  recordAuthEvent: vi.fn(),
}));

import { handleVerifyToken } from './auth.verify.js';
import { completeEmailProof, EmailProofInvalid } from '../utils/emailProof.js';
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

function fakePrisma(userId: unknown) {
  const findUnique = vi.fn().mockResolvedValue(userId === null ? null : { userId });
  const prisma = { emailVerification: { findUnique } } as unknown as PrismaClient;
  return prisma;
}

beforeEach(() => {
  vi.mocked(completeEmailProof).mockReset();
  vi.mocked(recordAuthEvent).mockReset();
});

describe('handleVerifyToken auth events', () => {
  it('records email_verification success for the verified account', async () => {
    const prisma = fakePrisma('user-9');
    vi.mocked(completeEmailProof).mockResolvedValue({ purpose: 'verify', tenantSlug: undefined, nextAction: 'login' });
    const req = fakeReq({ token: 'proof-token-9' });
    const res = fakeRes();

    await handleVerifyToken(prisma, req, res);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      purpose: 'verify',
      tenantSlug: undefined,
      nextAction: 'login',
    });
    expect(recordAuthEvent).toHaveBeenCalledTimes(1);
    expect(recordAuthEvent).toHaveBeenCalledWith(prisma, {
      type: 'email_verification',
      success: true,
      userId: 'user-9',
      req,
    });
  });

  it('records nothing when the proof is invalid or expired', async () => {
    const prisma = fakePrisma('user-9');
    vi.mocked(completeEmailProof).mockRejectedValue(new EmailProofInvalid());
    const res = fakeRes();

    await handleVerifyToken(prisma, fakeReq({ token: 'proof-token-9' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });

  it('still confirms the verification when the account lookup fails', async () => {
    const findUnique = vi.fn().mockRejectedValue(new Error('connection lost'));
    const prisma = { emailVerification: { findUnique } } as unknown as PrismaClient;
    vi.mocked(completeEmailProof).mockResolvedValue({ purpose: 'verify', tenantSlug: undefined, nextAction: 'login' });
    const req = fakeReq({ token: 'proof-token-9' });
    const res = fakeRes();

    await handleVerifyToken(prisma, req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(recordAuthEvent).toHaveBeenCalledWith(prisma, {
      type: 'email_verification',
      success: true,
      userId: null,
      req,
    });
  });
});
