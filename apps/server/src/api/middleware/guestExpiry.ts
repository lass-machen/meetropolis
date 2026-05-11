import type express from 'express';
import { createPrismaClient } from '../../db.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

const prisma = createPrismaClient();

/**
 * Middleware that checks if the authenticated user is an expired guest.
 * If expired: deletes all sessions, clears cookie, returns 403.
 * Runs after auth middleware on authenticated requests.
 */
export const guestExpiryMiddleware: express.RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    if (!auth) return next(); // Not authenticated, let other middleware handle it

    const tenant = getTenantFromReq(req);
    if (!tenant) return next();

    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: auth.userId } },
    });

    if (!membership) return next();
    if (membership.role !== 'guest') return next();
    if (!membership.expiresAt) return next();

    if (membership.expiresAt < new Date()) {
      // Guest is expired: kill sessions and block.
      await prisma.session.deleteMany({ where: { userId: auth.userId } });
      res.clearCookie('auth_token', { path: '/' });
      return res.status(403).json({ error: 'guest_expired' });
    }
  } catch {
    // Non-critical, don't block the request
  }
  return next();
};
