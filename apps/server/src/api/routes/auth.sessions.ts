import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { requireAuth } from '../utils/authHelpers.js';
import {
  hashSessionToken,
  purgeExpiredSessions,
  revokeSessionById,
  revokeSessionsForUser,
} from '../utils/sessionAuth.js';
import { pathParam } from '../utils/requestHelpers.js';
import { getRequestToken } from './auth.helpers.js';

export async function handleListSessions(
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
    await purgeExpiredSessions(prisma, auth.userId);

    const sessions = await prisma.session.findMany({
      where: { userId: auth.userId },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        lastActiveAt: true,
        createdAt: true,
        tokenHash: true,
      },
    });

    const currentToken = getRequestToken(req);
    let currentSessionId: string | null = null;
    if (currentToken) {
      const currentHash = hashSessionToken(currentToken);
      const currentSession = sessions.find((s) => s.tokenHash === currentHash);
      currentSessionId = currentSession?.id || null;
    }

    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        lastActiveAt: s.lastActiveAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        isCurrent: s.id === currentSessionId,
      })),
      currentSessionId,
    });
  } catch (e: unknown) {
    logger.error({ event: 'auth.sessions.list_failed', error: String(e) });
    res.status(500).json({ error: 'failed to list sessions' });
  }
}

export async function handleRevokeSession(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const sessionId = pathParam(req, 'id');

  try {
    // Deletes the row and drops it from the session cache, so the revoked
    // cookie stops authenticating on the caller's very next request rather
    // than living on until its JWT expires.
    const revoked = await revokeSessionById(prisma, auth.userId, sessionId);
    if (!revoked) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    logger.info({ event: 'auth.session.revoked', userId: auth.userId, sessionId });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'auth.session.revoke_failed', error: String(e) });
    res.status(500).json({ error: 'failed to revoke session' });
  }
}

export async function handleRevokeAllSessions(
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
    const currentToken = getRequestToken(req);
    const count = await revokeSessionsForUser(prisma, auth.userId, {
      exceptTokenHash: currentToken ? hashSessionToken(currentToken) : null,
    });

    logger.info({ event: 'auth.sessions.revoked_all', userId: auth.userId, count });
    res.json({ ok: true, revokedCount: count });
  } catch (e: unknown) {
    logger.error({ event: 'auth.sessions.revoke_all_failed', error: String(e) });
    res.status(500).json({ error: 'failed to revoke sessions' });
  }
}
