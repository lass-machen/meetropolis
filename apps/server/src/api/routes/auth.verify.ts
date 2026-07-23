import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth } from '../utils/authHelpers.js';
import { resolvePublicBaseUrl } from './auth.helpers.js';
import { sendIfAvailable } from '../../emailLoader.js';

/** Cooldown between two verification mails for the same user. */
const VERIFICATION_COOLDOWN_MS = 2 * 60 * 1000;
/** Lifetime of a verification token. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export type EmailVerificationOutcome =
  | { status: 'user_not_found' }
  | { status: 'already_verified' }
  | { status: 'throttled' }
  | { status: 'issued'; sent: boolean; token: string; verifyUrl: string };

/**
 * Issue an e-mail verification token for a user and mail it out.
 *
 * The single place that starts a verification, shared by `POST
 * /auth/verify/request` (user clicks "resend") and by account creation, which
 * must trigger it instead of stamping `emailVerifiedAt` at birth — a stamp that
 * made the whole verification machinery unreachable. It is exported for the
 * enterprise sign-up, which has to start verification for the accounts it
 * creates through the same path.
 *
 * `sent: false` means no mail provider was configured (OSS console fallback);
 * the caller decides whether to surface the token out of band. Errors are
 * propagated, never swallowed: a caller for which verification is
 * non-blocking (account creation) catches and logs.
 */
export async function startEmailVerification(params: {
  prisma: PrismaClient;
  userId: string;
  req: express.Request;
}): Promise<EmailVerificationOutcome> {
  const { prisma, userId, req } = params;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { status: 'user_not_found' };
  if (user.emailVerifiedAt) return { status: 'already_verified' };

  const recent = await prisma.emailVerification.findFirst({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - VERIFICATION_COOLDOWN_MS) } },
  });
  if (recent) return { status: 'throttled' };

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  await prisma.emailVerification.create({
    data: { token, userId: user.id, email: user.email, expiresAt },
  });

  // Public base URL for the verify link. A native-client Origin
  // (tauri://localhost) is rejected so it never lands in the emailed link;
  // see resolvePublicBaseUrl for the full precedence.
  const baseUrl = resolvePublicBaseUrl({
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    billingPublicUrl: process.env.BILLING_PUBLIC_URL,
    origin: req.headers.origin,
    host: req.headers.host,
  });
  const verifyUrl = baseUrl ? `${baseUrl}/#/verify?token=${token}` : '';

  // Locale chain (Block C): user.locale (DB) → MAIL_DEFAULT_LOCALE / 'de'
  // (resolver default). The verify endpoint has no caller-supplied
  // locale param, so we rely on the user's persisted UI locale.
  const userLocale = user.locale === 'en' ? 'en' : user.locale === 'de' ? 'de' : undefined;

  const sent = await sendIfAvailable(
    (mod) => mod.sendVerify({ to: user.email, name: user.name || '', verifyUrl, locale: userLocale }),
    'auth.verify.email_failed',
    { userId: user.id },
  );

  logger.info({ event: 'auth.verify.token_issued', userId: user.id, sent });
  return { status: 'issued', sent, token, verifyUrl };
}

export async function handleVerifyRequest(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const outcome = await startEmailVerification({ prisma, userId: auth.userId, req });
    if (outcome.status === 'user_not_found') {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    if (outcome.status === 'already_verified') {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }
    if (outcome.status === 'throttled') {
      res.status(429).json({ error: 'Please wait before requesting another verification email' });
      return;
    }

    // When no email was sent (OSS without any mail module), return the token
    // and link directly so the user or admin can complete verification out of
    // band.
    const isDev = process.env.NODE_ENV !== 'production';
    const { sent, token, verifyUrl } = outcome;
    res.json({ ok: true, sent, ...((!sent || isDev) && { token, verifyUrl }) });
  } catch (e: unknown) {
    logger.error({ event: 'auth.verify.request_failed', error: String(e) });
    res.status(500).json({ error: 'verification request failed' });
  }
}

const verifySchema = z.object({ token: z.string().min(8) });

export async function handleVerifyToken(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = verifySchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'token required' });
    return;
  }

  const { token } = parse.data;

  try {
    const verification = await prisma.emailVerification.findUnique({ where: { token } });
    if (!verification) {
      res.status(400).json({ error: 'invalid token' });
      return;
    }
    if (verification.usedAt) {
      res.status(400).json({ error: 'token already used' });
      return;
    }
    if (verification.expiresAt < new Date()) {
      res.status(400).json({ error: 'token expired' });
      return;
    }

    await prisma.emailVerification.update({
      where: { token },
      data: { usedAt: new Date() },
    });

    await prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerifiedAt: new Date() },
    });

    logger.info({ event: 'auth.verify.success', userId: verification.userId });
    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (e: unknown) {
    logger.error({ event: 'auth.verify.failed', error: String(e) });
    res.status(500).json({ error: 'verification failed' });
  }
}

export async function handleVerifyStatus(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
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

    res.json({
      email: user.email,
      verified: !!user.emailVerifiedAt,
      verifiedAt: user.emailVerifiedAt?.toISOString() || null,
    });
  } catch {
    res.status(500).json({ error: 'status check failed' });
  }
}
