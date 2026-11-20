import type { RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../utils/authHelpers.js';
import { createRateLimiter } from './rateLimit.js';

/** Tileset registration is open to every member; cap it per user. Fresh store per registrar. */
export function createTilesetRegistrationRateLimiter(): RequestHandler {
  return createRateLimiter({
    name: 'tileset_registration',
    windowMs: 10 * 60_000,
    limit: 120,
    keyGenerator: (req) => {
      const auth = requireAuth(req);
      return auth ? `user:${auth.userId}` : ipKeyGenerator(req.ip ?? '');
    },
  });
}
