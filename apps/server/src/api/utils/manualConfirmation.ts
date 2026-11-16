import crypto from 'crypto';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { normalizeEmailForStorage } from './authHelpers.js';
import {
  deliveringEmailModule,
  EmailProofInvalid,
  finishEmailProof,
  hashEmailProof,
  lockEmailAccount,
  type EmailProofOutcome,
} from './emailProof.js';
import { inviteEmailMatches } from './inviteLifecycle.js';

export const ADMIN_CONFIRMATION_PURPOSE = 'invite_admin';
export const ADMIN_CONFIRMATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function manualConfirmationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MANUAL_ACCOUNT_CONFIRMATION === 'true';
}

export async function manualConfirmationActive(): Promise<boolean> {
  return manualConfirmationEnabled() && !(await deliveringEmailModule());
}

export async function requestAdminConfirmation(
  prisma: PrismaClient,
  userId: string,
  inviteId: string,
): Promise<EmailProofOutcome> {
  return prisma.$transaction(async (tx) => {
    await lockEmailAccount(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return { status: 'user_not_found' as const };
    if (user.emailVerifiedAt) return { status: 'already_verified' as const };
    const invite = await tx.invite.findUnique({ where: { id: inviteId } });
    if (!invite || !inviteEmailMatches(invite.email, user.email)) return { status: 'binding_required' as const };
    const existing = await tx.emailVerification.findFirst({
      where: { userId, purpose: ADMIN_CONFIRMATION_PURPOSE, inviteId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { status: 'admin_pending' as const };
    await tx.emailVerification.create({ data: {
      token: hashEmailProof(crypto.randomBytes(32).toString('hex')),
      userId, purpose: ADMIN_CONFIRMATION_PURPOSE, inviteId,
      email: normalizeEmailForStorage(user.email), sourceEmail: user.email,
      expiresAt: new Date(Date.now() + ADMIN_CONFIRMATION_TTL_MS),
    } });
    return { status: 'admin_pending' as const };
  });
}

export async function confirmAccountByAdmin(
  prisma: PrismaClient,
  targetUserId: string,
  actorUserId: string,
): Promise<'confirmed' | 'user_not_found' | 'already_verified' | 'no_pending'> {
  let result: 'confirmed' | 'user_not_found' | 'already_verified' | 'no_pending';
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockEmailAccount(tx, targetUserId);
      const user = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!user) return 'user_not_found' as const;
      if (user.emailVerifiedAt) return 'already_verified' as const;
      const proof = await tx.emailVerification.findFirst({
        where: { userId: targetUserId, purpose: ADMIN_CONFIRMATION_PURPOSE, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!proof) return 'no_pending' as const;
      await finishEmailProof(tx, proof.id, 'admin');
      return 'confirmed' as const;
    });
  } catch (error: unknown) {
    if (error instanceof EmailProofInvalid) return 'no_pending';
    throw error;
  }
  if (result === 'confirmed') {
    logger.info({ event: 'admin.account_confirmation.confirmed', actorUserId, targetUserId });
  }
  return result;
}
