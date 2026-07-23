import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import {
  handleAuthInvite,
  handleAuthRegister,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
} from './auth.signin.js';
import { handleAuthForgot, handleAuthReset, handleAuthChange } from './auth.password.js';
import { handleVerifyRequest, handleVerifyToken, handleVerifyStatus } from './auth.verify.js';
import { handleListSessions, handleRevokeSession, handleRevokeAllSessions } from './auth.sessions.js';
import { handleOnboardingComplete, handleAuthPosition } from './auth.profile.js';
import {
  loginRateLimiter,
  registrationRateLimiter,
  passwordResetRateLimiter,
  forgotPasswordEmailRateLimiter,
  emailVerificationRateLimiter,
} from '../middleware/rateLimit.js';

export function registerAuthRoutes(app: express.Application, prisma: PrismaClient) {
  // Sign-in / registration. The public, unauthenticated endpoints below are
  // rate limited per client IP (see middleware/rateLimit.ts). /auth/invite and
  // /auth/change require an authenticated caller and are left unthrottled here.
  app.post('/auth/invite', (req, res) => handleAuthInvite(prisma, req, res));
  app.post('/auth/register', registrationRateLimiter, (req, res) => handleAuthRegister(prisma, req, res));
  app.post('/auth/login', loginRateLimiter, (req, res) => handleAuthLogin(prisma, req, res));
  app.post('/auth/logout', (req, res) => handleAuthLogout(prisma, req, res));
  app.get('/auth/me', (req, res) => handleAuthMe(prisma, req, res));

  // Password flow. /auth/forgot mails a real reset link, so it is budgeted
  // twice: per client IP and per requested address (see middleware/rateLimit.ts).
  app.post('/auth/forgot', passwordResetRateLimiter, forgotPasswordEmailRateLimiter, (req, res) =>
    handleAuthForgot(prisma, req, res),
  );
  app.post('/auth/reset', passwordResetRateLimiter, (req, res) => handleAuthReset(prisma, req, res));
  app.post('/auth/change', (req, res) => handleAuthChange(prisma, req, res));

  // Email verification
  app.post('/auth/verify/request', emailVerificationRateLimiter, (req, res) => handleVerifyRequest(prisma, req, res));
  app.post('/auth/verify', emailVerificationRateLimiter, (req, res) => handleVerifyToken(prisma, req, res));
  app.get('/auth/verify/status', (req, res) => handleVerifyStatus(prisma, req, res));

  // Sessions
  app.get('/auth/sessions', (req, res) => handleListSessions(prisma, req, res));
  app.delete('/auth/sessions/:id', (req, res) => handleRevokeSession(prisma, req, res));
  app.delete('/auth/sessions', (req, res) => handleRevokeAllSessions(prisma, req, res));

  // Profile / onboarding / position
  app.post('/auth/onboarding/complete', (req, res) => handleOnboardingComplete(prisma, req, res));
  app.post('/auth/position', (req, res) => handleAuthPosition(prisma, req, res));
}
