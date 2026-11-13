import type { RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../utils/authHelpers.js';
import { createRateLimiter } from './rateLimit.js';

/** Create fresh stores per registrar; count successful changes towards the budget. */
export function createPasswordChangeRateLimiters(): RequestHandler[] {
  const authenticated: RequestHandler = (req, res, next) => {
    if (!requireAuth(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
  const ip = createRateLimiter({ name: 'password_change_ip', windowMs: 15 * 60_000, limit: 20 });
  const user = createRateLimiter({
    name: 'password_change', windowMs: 15 * 60_000, limit: 5,
    keyGenerator: (req) => {
      const auth = requireAuth(req);
      return auth ? `user:${auth.userId}` : ipKeyGenerator(req.ip ?? '');
    },
  });
  return [authenticated, ip, user];
}
