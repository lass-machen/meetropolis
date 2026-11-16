import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { inviteEmailMatches } from './inviteLifecycle.js';
import { issueEmailProof, type EmailProofOutcome } from './emailProof.js';
import { ADMIN_CONFIRMATION_PURPOSE, manualConfirmationActive, requestAdminConfirmation } from './manualConfirmation.js';

/** Find only an intent already bound to this account. */
export async function pendingInviteForUser(prisma: PrismaClient, userId: string, tenantId?: string) {
  const proof = await prisma.emailVerification.findFirst({
    where: { userId, purpose: { in: ['invite', ADMIN_CONFIRMATION_PURPOSE] }, usedAt: null, invite: {
      usedAt: null, expiresAt: { gt: new Date() }, ...(tenantId ? { tenantId } : {}),
    } }, orderBy: { createdAt: 'desc' }, include: { invite: true },
  });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return null;
  if (proof?.invite && inviteEmailMatches(proof.invite.email, user.email)) return proof.invite;
  const marked = await prisma.membership.findMany({
    where: { userId, inviteVerificationRequired: true, ...(tenantId ? { tenantId } : {}) }, select: { tenantId: true },
  });
  if (!marked.length) return null;
  const oldInvites = await prisma.invite.findMany({
    where: { usedById: userId, usedAt: { not: null }, tenantId: { in: marked.map((m) => m.tenantId) } },
    orderBy: { createdAt: 'desc' },
  });
  return oldInvites.find((invite) => inviteEmailMatches(invite.email, user.email)) ?? null;
}

export function verificationPending(res: express.Response, outcome?: EmailProofOutcome): void {
  if (outcome?.status === 'throttled') res.setHeader('Retry-After', outcome.retryAfter);
  const delivery = outcome?.status === 'issued' ? 'sent'
    : outcome?.status === 'admin_pending' ? 'admin'
    : outcome?.status === 'throttled' ? 'cooldown' : 'unavailable';
  res.status(409).json({ code: 'EMAIL_VERIFICATION_REQUIRED',
    error: delivery === 'admin'
      ? 'Your account is waiting for confirmation by an administrator.'
      : delivery === 'unavailable'
      ? 'Confirm your email address. Confirmation email could not be delivered. Please contact an administrator.'
      : 'Confirm your email address through the confirmation email before using this invitation.',
    delivery, ...(outcome?.status === 'throttled' ? { retryAfter: outcome.retryAfter } : {}) });
}

export function verificationBindingRequired(res: express.Response): void {
  res.status(409).json({ code: 'EMAIL_VERIFICATION_BINDING_REQUIRED',
    error: 'This invitation does not match your current email address. Confirm the matching address change or request a new invitation bound to your address.' });
}

export async function beginInviteVerification(prisma: PrismaClient, userId: string, inviteId: string) {
  if (await manualConfirmationActive()) return requestAdminConfirmation(prisma, userId, inviteId);
  return issueEmailProof({ prisma, userId, purpose: 'invite', inviteId });
}
