import { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { requireAuth } from '../utils/authHelpers.js';
import { createRateLimiter } from './rateLimit.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function inviteCreateKey(req: Request): string {
  const auth = requireAuth(req);
  return auth ? `user:${auth.userId}` : ipKeyGenerator(req.ip ?? '');
}

function inviteResendKey(req: Request): string {
  return `invite:${String(req.params.id)}`;
}

export const inviteCreateRateLimiter = createRateLimiter({
  name: 'invite_create',
  windowMs: HOUR_MS,
  limit: 30,
  keyGenerator: inviteCreateKey,
});

export const inviteResendRateLimiter = createRateLimiter({
  name: 'invite_resend',
  windowMs: HOUR_MS,
  limit: 5,
  keyGenerator: inviteResendKey,
});

export const invitePreviewRateLimiter = createRateLimiter({
  name: 'invite_preview',
  windowMs: 10 * MINUTE_MS,
  limit: 30,
});

export const inviteAcceptRateLimiter = createRateLimiter({
  name: 'invite_accept',
  windowMs: 10 * MINUTE_MS,
  limit: 30,
});
