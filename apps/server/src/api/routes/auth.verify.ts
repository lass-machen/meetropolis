import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { requireVerificationAuth } from '../utils/authHelpers.js';
import { getDeniedTenant } from '../utils/tenantAccessState.js';
import { completeEmailProof, EmailProofInvalid, issueEmailProof, type EmailProofOutcome } from '../utils/emailProof.js';
import { pendingInviteForUser, verificationBindingRequired } from '../utils/inviteVerification.js';

export type EmailVerificationOutcome = EmailProofOutcome;

/** Share this entry point with enterprise signup without returning secrets. */
export async function startEmailVerification(params: {
  prisma: PrismaClient; userId: string; req: express.Request;
}): Promise<EmailVerificationOutcome> {
  const { prisma, userId, req } = params;
  const tenantId = req.tenant?.id ?? getDeniedTenant(req)?.id;
  const invite = await pendingInviteForUser(prisma, userId, tenantId);
  const marked = await prisma.membership.findFirst({ where: { userId, inviteVerificationRequired: true,
    ...(tenantId ? { tenantId } : {}) } });
  if (marked && !invite) return { status: 'binding_required' };
  return issueEmailProof({ prisma, userId, purpose: invite ? 'invite' : 'verify', inviteId: invite?.id });
}

export function emailProofResponse(res: express.Response, outcome: EmailProofOutcome): void {
  switch (outcome.status) {
    case 'user_not_found': res.status(404).json({ error: 'Account not found.' }); return;
    case 'already_verified': res.json({ ok: true, alreadyVerified: true }); return;
    case 'binding_required': verificationBindingRequired(res); return;
    case 'throttled':
      res.setHeader('Retry-After', outcome.retryAfter);
      res.status(429).json({ code: 'EMAIL_VERIFICATION_COOLDOWN', error: 'Please wait before requesting another confirmation email.', retryAfter: outcome.retryAfter }); return;
    case 'no_public_base_url':
      res.status(500).json({ code: 'PUBLIC_BASE_URL_MISSING', error: 'The public web address is not configured. Please contact an administrator.' }); return;
    case 'delivery_unavailable':
      res.status(503).json({ code: 'EMAIL_DELIVERY_UNAVAILABLE', error: 'Confirmation email could not be delivered. Please contact an administrator.' }); return;
    case 'issued': res.json({ ok: true, sent: true }); return;
  }
}

export async function handleVerifyRequest(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireVerificationAuth(req);
  if (!auth) { res.status(401).json({ error: 'Please sign in again.' }); return; }
  try { emailProofResponse(res, await startEmailVerification({ prisma, userId: auth.userId, req })); }
  catch { res.status(500).json({ error: 'Verification request failed.' }); }
}

const verifySchema = z.object({ token: z.string().min(8).max(256) });
export async function handleVerifyToken(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ code: 'EMAIL_PROOF_INVALID', error: 'Invalid confirmation link.' }); return; }
  try {
    const result = await completeEmailProof(prisma, parsed.data.token);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    if (error instanceof EmailProofInvalid || (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) {
      res.status(400).json({ code: 'EMAIL_PROOF_INVALID', error: 'This link is invalid, expired or already used. Request a new confirmation email.' });
      return;
    }
    res.status(500).json({ error: 'Verification failed.' });
  }
}

export async function handleVerifyStatus(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireVerificationAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const proof = await prisma.emailVerification.findFirst({ where: { userId: auth.userId, usedAt: null },
      orderBy: { createdAt: 'desc' }, select: { readyAt: true, expiresAt: true, purpose: true, email: true } });
    const pending = await pendingInviteForUser(prisma, auth.userId, auth.tenantId);
    if (auth.verificationOnly) {
      const requiresLogin = !!user.emailVerifiedAt && !pending;
      res.json({
        code: requiresLogin ? 'ACCOUNT_LOGIN_REQUIRED' : 'EMAIL_VERIFICATION_REQUIRED',
        status: requiresLogin ? 'login_required'
          : proof?.readyAt && proof.expiresAt > new Date() ? 'sent' : 'unavailable',
      });
      return;
    }
    res.json({
      requiresLogin: auth.verificationOnly && !!user.emailVerifiedAt && !pending,
      ...(proof?.purpose === 'email_change' && proof.readyAt && proof.expiresAt > new Date() ? { emailChangePending: true, pendingEmail: proof.email } : {}),
      pendingDelivery: proof?.readyAt && proof.expiresAt > new Date() ? 'sent' : 'unavailable',
      email: user.email,
      verified: !!user.emailVerifiedAt,
      verifiedAt: user.emailVerifiedAt?.toISOString() || null,
    });
  } catch {
    res.status(500).json({ error: 'status check failed' });
  }
}
