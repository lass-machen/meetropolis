import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import { logger } from '../../logger.js';

/**
 * Create a session record for a freshly issued JWT.
 * Errors are logged but never thrown — session tracking is non-critical.
 */
export async function recordSession(
  prisma: PrismaClient,
  userId: string,
  jwtToken: string,
  req: express.Request,
  failureEvent: string,
): Promise<void> {
  try {
    const tokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.session.create({
      data: { userId, tokenHash, userAgent, ipAddress, expiresAt },
    });
  } catch (e) {
    logger.warn({ event: failureEvent, userId, error: String(e) });
  }
}

export function isNativeClientRequest(req: express.Request): boolean {
  const origin = req.headers.origin || '';
  return !origin || origin.startsWith('tauri://');
}

export function getRequestToken(req: express.Request): string | null {
  return (req.cookies?.auth_token as string | undefined)
    || req.headers.authorization?.replace('Bearer ', '')
    || null;
}
