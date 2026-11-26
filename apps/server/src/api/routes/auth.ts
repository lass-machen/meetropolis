import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { credentialRoute } from '../middleware/tenantAccess.js';
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
import { inviteCreateRateLimiter } from '../middleware/inviteRateLimit.js';
import { createPasswordChangeRateLimiters } from '../middleware/passwordChangeRateLimit.js';

export function registerAuthRoutes(app: express.Application, prisma: PrismaClient) {
  // Public sign-in / registration endpoints are rate limited by IP; /auth/invite is limited per user.
  // Apply separate user and IP budgets to password changes.
  app.post('/auth/invite', inviteCreateRateLimiter, (req, res) => handleAuthInvite(prisma, req, res));
  app.post('/auth/register', credentialRoute, registrationRateLimiter, (req, res) =>
    handleAuthRegister(prisma, req, res),
  );
  app.post('/auth/login', credentialRoute, loginRateLimiter, (req, res) => handleAuthLogin(prisma, req, res));
  app.post('/auth/logout', (req, res) => handleAuthLogout(prisma, req, res));
  app.get('/auth/me', (req, res) => handleAuthMe(prisma, req, res));

  // Password flow. /auth/forgot mails a real reset link, so it is budgeted
  // twice: per client IP and per requested address (see middleware/rateLimit.ts).
  app.post('/auth/forgot', credentialRoute, passwordResetRateLimiter, forgotPasswordEmailRateLimiter, (req, res) =>
    handleAuthForgot(prisma, req, res),
  );
  app.post('/auth/reset', credentialRoute, passwordResetRateLimiter, (req, res) => handleAuthReset(prisma, req, res));
  app.post('/auth/change', ...createPasswordChangeRateLimiters(), (req, res) => handleAuthChange(prisma, req, res));

  // Email verification
  app.post('/auth/verify/request', emailVerificationRateLimiter, (req, res) => handleVerifyRequest(prisma, req, res));
  app.post('/auth/verify', credentialRoute, emailVerificationRateLimiter, (req, res) =>
    handleVerifyToken(prisma, req, res),
  );
  app.get('/auth/verify/status', (req, res) => handleVerifyStatus(prisma, req, res));

  // Sessions
  app.get('/auth/sessions', (req, res) => handleListSessions(prisma, req, res));
  app.delete('/auth/sessions/:id', (req, res) => handleRevokeSession(prisma, req, res));
  app.delete('/auth/sessions', (req, res) => handleRevokeAllSessions(prisma, req, res));

  // Profile / onboarding / position
  app.post('/auth/onboarding/complete', (req, res) => handleOnboardingComplete(prisma, req, res));
  app.post('/auth/position', (req, res) => handleAuthPosition(prisma, req, res));
}
