import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, normalizeEmailForStorage } from '../utils/authHelpers.js';
import { revokeSessionsForUser, hashSessionToken } from '../utils/sessionAuth.js';
import {
  issuePasswordResetToken,
  claimPasswordResetToken,
  invalidatePasswordResetTokens,
  PASSWORD_RESET_TTL_MINUTES,
} from '../utils/passwordResetTokens.js';
import { renderPasswordResetMail } from '../utils/passwordResetMail.js';
import { resolvePublicBaseUrl, getRequestToken } from './auth.helpers.js';
import { sendIfAvailable } from '../../emailLoader.js';
import { resolveLocale, readEnvDefaultLocale } from '../../email/localeResolver.js';

const forgotSchema = z.object({ email: z.string().email() });

/**
 * POST /auth/forgot — self-service password reset by mail.
 *
 * Previously this endpoint was a dead end: it answered 200 while the client
 * promised "we sent you a reset link", and no mail was ever sent. Reset tokens
 * were admin-issued out of band only — a design with no answer for the case
 * that matters most, because nobody stands above a tenant owner. An owner who
 * forgot their password had no one inside their tenant who could help them.
 *
 * Security properties (see passwordResetTokens.ts for the token itself):
 *   - the response is always 200 and identical whether or not the address
 *     exists, so the endpoint stays useless for account enumeration — which is
 *     also why nothing below returns early with a different status;
 *   - the work is detached from the response. Awaiting it would answer a known
 *     address as slowly as the mail provider is and an unknown one instantly,
 *     which hands back by timing exactly what the uniform status code withholds;
 *   - rate limited per IP and per e-mail address (see middleware/rateLimit.ts),
 *     the latter so an attacker cannot flood a known victim's mailbox from many
 *     addresses;
 *   - a mail failure is logged, not surfaced.
 *
 * The admin path (POST /admin/users/:id/reset-token) stays as the fallback for
 * managed tenants and for users without a reachable mailbox.
 */
export function handleAuthForgot(prisma: PrismaClient, req: express.Request, res: express.Response): void {
  const parse = forgotSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'email required' });
    return;
  }

  void sendResetMailIfEligible(prisma, req, parse.data.email).catch((e: unknown) =>
    // Never leaks to the client: a failure here must look exactly like the
    // unknown-address case.
    logger.error({ event: 'auth.forgot.failed', error: e instanceof Error ? e.message : String(e) }),
  );

  res.json({ ok: true });
}

/**
 * Issue and mail a reset token when the address belongs to a password account.
 * Silent no-op for unknown addresses and for guest accounts (they have no
 * password to reset and authenticate via their magic link instead).
 */
async function sendResetMailIfEligible(prisma: PrismaClient, req: express.Request, email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizeEmailForStorage(email), mode: 'insensitive' } },
    select: { id: true, email: true, name: true, locale: true, passwordHash: true },
  });
  if (!user) {
    logger.info({ event: 'auth.forgot.unknown_email' });
    return;
  }
  if (!user.passwordHash) {
    logger.info({ event: 'auth.forgot.no_password_account', userId: user.id });
    return;
  }

  // Resolve the link target BEFORE issuing: a mail with a relative link is
  // useless, and issuing anyway would pointlessly invalidate a link the user
  // may already hold.
  const baseUrl = resolvePublicBaseUrl({
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    billingPublicUrl: process.env.BILLING_PUBLIC_URL,
    origin: req.headers.origin,
    host: req.headers.host,
  });
  if (!baseUrl) {
    logger.error({ event: 'auth.forgot.no_base_url', userId: user.id });
    return;
  }

  const { token } = await issuePasswordResetToken(prisma, user.id);
  const resetUrl = `${baseUrl.replace(/\/$/, '')}/#/reset?token=${token}&email=${encodeURIComponent(user.email)}`;

  // Locale chain (Block C): user.locale (DB) → MAIL_DEFAULT_LOCALE → 'de'.
  // Resolved here rather than by the mail module because `sendRaw` is a
  // pass-through — it renders nothing and takes no locale, so this call site
  // owns the choice. Same resolver the templated mails use.
  const locale = resolveLocale({ userLocale: user.locale }, readEnvDefaultLocale());

  const sent = await sendIfAvailable(
    (mod) =>
      mod.sendRaw(
        renderPasswordResetMail({
          to: user.email,
          name: user.name || '',
          resetUrl,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
          locale,
        }),
      ),
    'auth.forgot.email_failed',
    { userId: user.id },
  );

  // `sent: false` means no mail provider is configured. The token is NOT
  // surfaced in the response (unlike e-mail verification, an unauthenticated
  // caller must never receive it) — the admin can issue one out of band.
  logger.info({ event: 'auth.forgot.token_issued', userId: user.id, sent });
}

const resetSchema = z.object({
  email: z.string().email().optional(),
  token: z.string().min(8),
  password: z.string().min(8),
});

/**
 * POST /auth/reset — set a new password from a reset token.
 *
 * Completing a reset ends EVERY session of the user. A reset is the flow an
 * account recovers through, so any session an attacker still holds has to die
 * with the old password — the user cannot see, let alone revoke, those sessions
 * while locked out.
 */
export async function handleAuthReset(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = resetSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'token and password required' });
    return;
  }
  const { email, token, password } = parse.data;

  const claim = await claimPasswordResetToken(prisma, token, email);
  if (!claim) {
    res.status(400).json({ error: 'invalid token' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: claim.userId }, data: { passwordHash: hash } });
  await invalidatePasswordResetTokens(prisma, claim.userId);

  const revokedCount = await revokeSessionsForUser(prisma, claim.userId);
  logger.info({ event: 'auth.reset.completed', userId: claim.userId, revokedCount });

  res.json({ ok: true });
}

const changeSchema = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) });

/**
 * POST /auth/change — change the password of the logged-in user.
 *
 * Every OTHER session of the user is revoked; the caller's own stays alive so a
 * routine password change does not log the user out of the tab they are in.
 * Before this, a password change revoked nothing at all: the classic "someone
 * has my session, let me change my password" reaction left the intruder logged
 * in for the remaining 30 days of their token.
 */
export async function handleAuthChange(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parse = changeSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }
  const { currentPassword, newPassword } = parse.data;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user || !user.passwordHash) {
    res.status(400).json({ error: 'no password set' });
    return;
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'invalid current password' });
    return;
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  await invalidatePasswordResetTokens(prisma, user.id);

  const currentToken = getRequestToken(req);
  const revokedCount = await revokeSessionsForUser(prisma, user.id, {
    exceptTokenHash: currentToken ? hashSessionToken(currentToken) : null,
  });
  logger.info({ event: 'auth.change.completed', userId: user.id, revokedCount });

  res.json({ ok: true, revokedSessions: revokedCount });
}
