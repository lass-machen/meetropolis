import crypto from 'crypto';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { getApiTokenPepper, normalizeEmailForMatching } from './authHelpers.js';

/**
 * Issue, claim and invalidate password-reset tokens.
 *
 * Reset tokens are now mailed to the user (self-service forgot-password), which
 * makes them a standing credential for taking over an account. Two consequences
 * this module enforces for every caller:
 *
 *   1. The database never sees the token. `PasswordReset.token` stores
 *      `sha256(API_TOKEN_PEPPER + rawToken)` — the same construction
 *      `ApiToken.hash` uses. A database dump therefore yields no usable reset
 *      links, and neither does a backup or a log line that echoes a row.
 *   2. A token is single-use and short-lived, and claiming it is a
 *      compare-and-swap ({@link claimPasswordResetToken}), so two requests
 *      racing on the same link cannot both succeed.
 *
 * NOTE on the column name: `token` holds the DIGEST, not the token. The column
 * is reused as-is because it is already `@unique` (which is exactly the index a
 * hash lookup wants) and renaming it to `tokenHash` would need a schema
 * migration in a package this change does not own. Nothing but this module may
 * read or write it.
 *
 * Every writer of reset tokens MUST go through {@link issuePasswordResetToken}
 * — the self-service flow (auth.password.ts) and the admin out-of-band flow
 * (admin.passwordReset.ts) alike. A caller that inserts its own row would store
 * a plaintext token that {@link claimPasswordResetToken} can never match.
 */

/**
 * Token lifetime. 30 minutes: a self-service reset is finished within a minute
 * or two of the mail arriving, so a longer window only widens the slot in which
 * a leaked mailbox, a shared device or a mail-scanning proxy can use the link.
 * It matches the TTL the admin flow has always used, so there is exactly one
 * number to reason about, and re-requesting is a single click.
 */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / 60_000;

/** 256 bits of entropy — the token itself is the whole secret. */
const TOKEN_BYTES = 32;

/** The digest stored in `PasswordReset.token`. Never store the raw token. */
function hashResetToken(rawToken: string): string {
  return crypto
    .createHash('sha256')
    .update(getApiTokenPepper() + rawToken)
    .digest('hex');
}

export interface IssuedPasswordReset {
  /** The raw token. Exists only in this response, the mail and the user's URL. */
  token: string;
  expiresAt: Date;
}

/**
 * Create a reset token for `userId` and return it in the clear exactly once.
 *
 * Any older unused token of that user is dropped first, so at most one reset
 * link per user is live: a user who clicks "forgot password" twice cannot be
 * confused by which mail to open, and an attacker who obtained an earlier token
 * loses it the moment the real user requests a new one.
 */
export async function issuePasswordResetToken(
  prisma: PrismaClient,
  userId: string,
  ttlMs: number = PASSWORD_RESET_TTL_MS,
): Promise<IssuedPasswordReset> {
  await prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } });
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.passwordReset.create({
    data: { token: hashResetToken(token), userId, expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Validate a raw token and burn it in the same step. Returns the owning user id,
 * or null when the token is unknown, already used, expired, or does not belong
 * to `expectedEmail`.
 *
 * The burn is an atomic conditional update: the row moves from `usedAt IS NULL`
 * to used in one statement, and the caller only proceeds if it was the request
 * that flipped it. A second, concurrent use of the same link therefore fails
 * instead of resetting the password twice.
 */
export async function claimPasswordResetToken(
  prisma: PrismaClient,
  rawToken: string,
  expectedEmail?: string,
): Promise<{ userId: string } | null> {
  const tokenHash = hashResetToken(rawToken);
  const now = new Date();

  const row = await prisma.passwordReset.findUnique({
    where: { token: tokenHash },
    select: { userId: true, usedAt: true, expiresAt: true },
  });
  if (!row || row.usedAt || row.expiresAt <= now) return null;

  // Optional binding to the address the client thinks it is resetting. Checked
  // before the burn so a typo does not consume a valid link.
  if (expectedEmail) {
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    if (!user || normalizeEmailForMatching(user.email) !== normalizeEmailForMatching(expectedEmail)) return null;
  }

  const claimed = await prisma.passwordReset.updateMany({
    where: { token: tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count === 0) return null;

  return { userId: row.userId };
}

/**
 * Drop every unused reset token of a user. Called whenever the password changes
 * by any other route (self-service change, completed reset): a pending link
 * must not survive the credential it was meant to replace.
 */
export async function invalidatePasswordResetTokens(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } });
}
