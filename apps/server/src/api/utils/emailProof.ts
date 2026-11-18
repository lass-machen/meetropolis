import crypto from 'crypto';
import type { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { getEmailModule } from '../../emailLoader.js';
import { buildPublicWebLink, publicWebBase } from './publicLinks.js';
import { normalizeEmailForStorage } from './authHelpers.js';
import { inviteEmailMatches, consumeInvite } from './inviteLifecycle.js';

export type EmailProofPurpose = 'verify' | 'invite' | 'email_change';
export type EmailProofOutcome =
  | {
      status:
        'user_not_found' | 'already_verified' | 'no_public_base_url' | 'delivery_unavailable' | 'binding_required';
    }
  | { status: 'throttled'; retryAfter: number }
  | { status: 'issued'; sent: true }
  | { status: 'admin_pending' };

const TTL_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 1000;
const DELIVERY_PROVIDERS = new Set(['oss-smtp', 'ee-smtp', 'ee-resend']);

export async function deliveringEmailModule() {
  const mod = await getEmailModule();
  return mod && DELIVERY_PROVIDERS.has(mod.providerName ?? '') ? mod : null;
}

export function hashEmailProof(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Serialize issuance and consumption across address round trips and concurrent changes. */
export async function lockEmailAccount(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}

async function prepareEmailProof(
  tx: Prisma.TransactionClient,
  input: { userId: string; purpose: EmailProofPurpose; inviteId?: string; email?: string; token: string },
) {
  const { userId, purpose, inviteId, token } = input;
  await lockEmailAccount(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) return { status: 'user_not_found' as const };
  if (purpose === 'verify' && user.emailVerifiedAt) return { status: 'already_verified' as const };
  const email = normalizeEmailForStorage(input.email ?? user.email);
  if (purpose === 'invite') {
    const invite = inviteId ? await tx.invite.findUnique({ where: { id: inviteId } }) : null;
    if (!invite || !inviteEmailMatches(invite.email, user.email)) return { status: 'binding_required' as const };
  }
  const recent = await tx.emailVerification.findFirst({
    where: {
      userId,
      purpose,
      inviteId: inviteId ?? null,
      email,
      usedAt: null,
      expiresAt: { gt: new Date() },
      createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent)
    return {
      status: 'throttled' as const,
      retryAfter: Math.max(1, Math.ceil((recent.createdAt.getTime() + COOLDOWN_MS - Date.now()) / 1000)),
    };
  if (purpose === 'email_change') {
    await tx.emailVerification.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  }
  const intent = await tx.emailVerification.create({
    data: {
      token,
      userId,
      purpose,
      inviteId,
      email,
      sourceEmail: user.email,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  return { status: 'prepared' as const, intent, user };
}

export async function issueEmailProof(params: {
  prisma: PrismaClient;
  userId: string;
  purpose: EmailProofPurpose;
  inviteId?: string;
  email?: string;
}): Promise<EmailProofOutcome> {
  const { prisma, userId, purpose, inviteId } = params;
  const mail = await deliveringEmailModule();
  if (!mail) return { status: 'delivery_unavailable' };
  const base = publicWebBase();
  if (!base) return { status: 'no_public_base_url' };
  const rawToken = crypto.randomBytes(32).toString('hex');
  const token = hashEmailProof(rawToken);
  const prepared = await prisma.$transaction((tx) =>
    prepareEmailProof(tx, { userId, purpose, inviteId, email: params.email, token }),
  );
  if (prepared.status !== 'prepared') return prepared;
  const { intent, user } = prepared;
  let sent = false;
  try {
    sent = await mail.sendVerify({
      to: intent.email,
      name: user.name ?? '',
      verifyUrl: buildPublicWebLink(base, `verify?token=${rawToken}`),
      locale: user.locale === 'en' ? 'en' : 'de',
    });
    if (sent && purpose === 'email_change') {
      const text =
        'A change of your email address was requested. Your current address remains active until confirmation. If this was not you, change your password.';
      sent = await mail.sendRaw({ to: user.email, subject: 'Email change requested', text, html: `<p>${text}</p>` });
    }
  } catch {
    // Provider errors may contain recipient or message data; do not log them.
    sent = false;
  }
  if (!sent) {
    await prisma.emailVerification.updateMany({
      where: { id: intent.id, readyAt: null },
      data: { expiresAt: new Date() },
    });
    return { status: 'delivery_unavailable' };
  }
  const ready = await prisma.emailVerification.updateMany({
    where: { id: intent.id, usedAt: null, user: { email: user.email } },
    data: { readyAt: new Date() },
  });
  return ready.count === 1 ? { status: 'issued', sent: true } : { status: 'binding_required' };
}

export class EmailProofInvalid extends Error {}

/** Shared completion for mail and administrator confirmation. */
export async function finishEmailProof(tx: Prisma.TransactionClient, proofId: string, mode: 'mail' | 'admin') {
  const initial = await tx.emailVerification.findUnique({ where: { id: proofId } });
  if (!initial) throw new EmailProofInvalid();
  await lockEmailAccount(tx, initial.userId);
  const proof = await tx.emailVerification.findUnique({ where: { id: proofId } });
  const user = await tx.user.findUnique({ where: { id: initial.userId } });
  const now = new Date();
  if (
    !proof ||
    !user ||
    proof.usedAt ||
    proof.expiresAt <= now ||
    proof.sourceEmail !== user.email ||
    (proof.purpose !== 'email_change' && !inviteEmailMatches(proof.email, user.email))
  ) {
    throw new EmailProofInvalid();
  }
  if (mode === 'mail') {
    if (
      !proof.readyAt ||
      (proof.purpose !== 'verify' && proof.purpose !== 'invite' && proof.purpose !== 'email_change')
    ) {
      throw new EmailProofInvalid();
    }
  } else if (proof.readyAt || proof.purpose !== 'invite_admin') {
    throw new EmailProofInvalid();
  }
  let tenantSlug: string | undefined;
  if (proof.purpose === 'invite' || proof.purpose === 'invite_admin') {
    if (!proof.inviteId) throw new EmailProofInvalid();
    await tx.$queryRaw`SELECT "id" FROM "Invite" WHERE "id" = ${proof.inviteId} FOR UPDATE`;
    const invite = await tx.invite.findUnique({ where: { id: proof.inviteId }, include: { tenant: true } });
    if (!invite || !inviteEmailMatches(invite.email, proof.email)) throw new EmailProofInvalid();
    const key = { tenantId: invite.tenantId, userId: user.id };
    const member = await tx.membership.findUnique({ where: { tenantId_userId: key } });
    if (invite.usedAt) {
      if (invite.usedById !== user.id || !member?.inviteVerificationRequired) throw new EmailProofInvalid();
      await tx.membership.update({ where: { tenantId_userId: key }, data: { inviteVerificationRequired: false } });
    } else {
      if (!(await consumeInvite(tx, invite.code, user.id, now))) throw new EmailProofInvalid();
      await tx.membership.upsert({
        where: { tenantId_userId: key },
        create: { ...key, role: invite.role },
        update: member?.inviteVerificationRequired ? { role: invite.role, inviteVerificationRequired: false } : {},
      });
    }
    tenantSlug = invite.tenant.slug;
  } else if (proof.purpose !== 'verify' && proof.purpose !== 'email_change') {
    throw new EmailProofInvalid();
  }
  if (proof.purpose === 'email_change') {
    const occupied = await tx.user.findFirst({
      where: { id: { not: user.id }, email: { equals: proof.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (occupied) throw new EmailProofInvalid();
  }
  const consumed = await tx.emailVerification.updateMany({
    where: {
      id: proof.id,
      usedAt: null,
      ...(mode === 'mail' ? { readyAt: { not: null } } : { readyAt: null }),
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  if (consumed.count !== 1) throw new EmailProofInvalid();
  await tx.user.update({
    where: { id: user.id },
    data: {
      ...(proof.purpose === 'email_change' ? { email: proof.email } : {}),
      emailVerifiedAt: now,
    },
  });
  await tx.emailVerification.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  return { purpose: proof.purpose, tenantSlug, nextAction: 'login' as const };
}

/** Verify proof, bind the address and consume the invitation in one transaction. */
export async function completeEmailProof(prisma: PrismaClient, rawToken: string) {
  const token = hashEmailProof(rawToken);
  return prisma.$transaction(async (tx) => {
    const initial = await tx.emailVerification.findUnique({ where: { token } });
    if (!initial) throw new EmailProofInvalid();
    return finishEmailProof(tx, initial.id, 'mail');
  });
}
