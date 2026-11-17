import crypto from 'crypto';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import type { Role } from '../../generated/prisma/index.js';
import { normalizeEmailForMatching, normalizeEmailForStorage } from './authHelpers.js';
import { sendIfAvailable } from '../../emailLoader.js';

export const INVITE_TTL_DAYS = 7;
export type InviteStatus = 'pending' | 'accepted' | 'expired';
export const INVITE_NOT_DELIVERED = 'not_delivered';

export function inviteExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Formats an invite expiry for the invite mail, in Europe/Berlin — same
 * pattern as the guest invite mail.
 */
export function formatInviteExpiry(expiresAt: Date, locale: 'de' | 'en' | undefined): string {
  return expiresAt.toLocaleString(locale === 'en' ? 'en-GB' : 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
    timeZoneName: 'short',
  });
}

export function deriveInviteStatus(
  invite: { usedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): InviteStatus {
  if (invite.usedAt) return 'accepted';
  if (!invite.expiresAt || invite.expiresAt <= now) return 'expired';
  return 'pending';
}

export function maskInviteEmail(email: string | null): string | null {
  if (email === null) return null;
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return null;
  return `${email.slice(0, 1)}***${email.slice(atIndex)}`;
}

export function inviteEmailMatches(inviteEmail: string | null, accountEmail: string): boolean {
  return inviteEmail !== null && normalizeEmailForMatching(inviteEmail) === normalizeEmailForMatching(accountEmail);
}

export async function consumeInvite(
  tx: Prisma.TransactionClient,
  code: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const result = await tx.invite.updateMany({
    where: { code, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now, usedById: userId },
  });
  return result.count === 1;
}

export async function registerInvitedUser(
  prisma: PrismaClient,
  args: {
    code: string;
    email: string;
    name: string | undefined;
    passwordHash: string;
    role: Role;
    tenantId: string;
    now: Date;
  },
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: normalizeEmailForStorage(args.email), name: args.name, passwordHash: args.passwordHash },
    });
    const invite = await tx.invite.findUnique({ where: { code: args.code } });
    if (
      !invite ||
      deriveInviteStatus(invite, args.now) !== 'pending' ||
      !inviteEmailMatches(invite.email, user.email)
    ) {
      throw new InviteUnavailableError();
    }
    // Create the binding atomically with the account. This record cannot be redeemed;
    // the subsequent delivery creates the actual mailbox proof.
    await tx.emailVerification.create({
      data: {
        userId: user.id,
        email: user.email,
        sourceEmail: user.email,
        purpose: 'invite',
        inviteId: invite.id,
        token: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
        expiresAt: args.now,
      },
    });
    return user;
  });
}

export class InviteUnavailableError extends Error {
  constructor() {
    super('Invite is unavailable');
    this.name = 'InviteUnavailableError';
  }
}

export async function deliverInvite(
  prisma: PrismaClient,
  args: {
    invite: { id: string; email: string | null; tenantId: string; expiresAt: Date | null };
    inviterUserId: string;
    tenantName: string;
    inviteUrl: string;
  },
): Promise<boolean> {
  let emailSent = false;
  if (args.invite.email) {
    const inviter = await prisma.user.findUnique({
      where: { id: args.inviterUserId },
      select: { name: true, email: true, locale: true },
    });
    const inviterName = inviter?.name || inviter?.email || 'Someone';
    // Locale chain: request locale (not exposed by /auth/invite), inviter.locale,
    // then MAIL_DEFAULT_LOCALE / 'de' in the email resolver. The invitee is not
    // a known user yet, so the inviter's UI locale is the best available signal.
    const inviterLocale = inviter?.locale === 'en' ? 'en' : inviter?.locale === 'de' ? 'de' : undefined;
    emailSent = await sendIfAvailable(
      (mod) =>
        mod.sendInvite({
          to: args.invite.email!,
          inviterName,
          tenantName: args.tenantName,
          inviteUrl: args.inviteUrl,
          locale: inviterLocale,
          ...(args.invite.expiresAt ? { expiresAt: formatInviteExpiry(args.invite.expiresAt, inviterLocale) } : {}),
        }),
      'invite.email_failed',
      { tenantId: args.invite.tenantId, inviteId: args.invite.id },
    );
  }

  if (emailSent) {
    await prisma.invite.update({
      where: { id: args.invite.id },
      data: { lastSentAt: new Date(), sendCount: { increment: 1 }, lastSendError: null },
    });
  } else {
    await prisma.invite.update({ where: { id: args.invite.id }, data: { lastSendError: INVITE_NOT_DELIVERED } });
  }
  return emailSent;
}

export function inviteResponse(
  invite: { code: string; role: string; expiresAt: Date | null },
  inviteUrl: string,
  emailSent: boolean,
) {
  return {
    code: invite.code,
    role: invite.role,
    inviteUrl,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    emailSent,
  };
}
