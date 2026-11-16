import type express from 'express';
import crypto from 'crypto';
import type { PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { getJwtSecret } from '../api/utils/authHelpers.js';
import { readClientIp, readUserAgent } from '../api/utils/sessionAuth.js';

/** Authentication events recorded for the account export and retention. */
export type AuthEventType =
  'login' | 'logout' | 'password_reset' | 'email_verification' | 'invite_accept' | 'role_change' | 'account_delete';

/** Retention window of auth events in days; older rows are purged. */
export const AUTH_EVENT_RETENTION_DAYS = 30;

/** Purpose label of the email key derivation; never reuse it for another purpose. */
const AUTH_EVENT_EMAIL_KEY_INFO = 'meetropolis/auth-event-email/v1';

/** Length of the derived email key in bytes. */
const AUTH_EVENT_EMAIL_KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

/** Derive the email digest key once per process. */
function authEventEmailKey(): Buffer {
  if (cachedKey) return cachedKey;
  const derived = crypto.hkdfSync(
    'sha256',
    getJwtSecret(),
    Buffer.alloc(0),
    AUTH_EVENT_EMAIL_KEY_INFO,
    AUTH_EVENT_EMAIL_KEY_LENGTH,
  );
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

/**
 * Opaque digest of an email address for failed login attempts without a user.
 * The plain address is never stored; lookup of the digest needs the address.
 */
export function authEventEmailHmac(email: string): string {
  return crypto.createHmac('sha256', authEventEmailKey()).update(email.trim().toLowerCase()).digest('base64url');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'NonError';
}

export interface AuthEventInput {
  type: AuthEventType;
  success: boolean;
  userId?: string | null;
  tenantId?: string | null;
  email?: string | null;
  req?: express.Request;
}

/**
 * Record one authentication event without ever throwing.
 *
 * The email digest is stored only for a failed attempt that names no user;
 * otherwise it stays null so no cleartext address lands in the table. On a
 * successful login the event, the user login time and the membership login
 * time share one timestamp inside a single transaction. Every failure is
 * logged by its error name only and swallowed.
 */
export async function recordAuthEvent(prisma: PrismaClient, input: AuthEventInput): Promise<void> {
  const { type, success } = input;
  try {
    const userId = input.userId ?? null;
    const tenantId = input.tenantId ?? null;
    const emailHmac = !success && !userId && input.email ? authEventEmailHmac(input.email) : null;
    const at = new Date();
    const data = {
      type,
      success,
      userId,
      tenantId,
      ipAddress: input.req ? readClientIp(input.req) : null,
      userAgent: input.req ? readUserAgent(input.req) : null,
      emailHmac,
      createdAt: at,
    };
    if (type === 'login' && success && userId) {
      const writes = tenantId
        ? [
            prisma.authEvent.create({ data }),
            prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } }),
            prisma.membership.updateMany({ where: { userId, tenantId }, data: { lastLoginAt: at } }),
          ]
        : [prisma.authEvent.create({ data }), prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } })];
      await prisma.$transaction(writes);
    } else {
      await prisma.authEvent.create({ data });
    }
  } catch (error) {
    logger.warn({ event: 'auth.event.record_failed', type, errorName: errorName(error) });
  }
}

/**
 * Delete auth events older than the retention window. Returns their count.
 */
export async function purgeExpiredAuthEvents(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTH_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.authEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
