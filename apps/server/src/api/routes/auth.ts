import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import {
  handleAuthInvite,
  handleAuthRegister,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
} from './auth.signin.js';
import {
  handleAuthForgot,
  handleAuthReset,
  handleAuthChange,
} from './auth.password.js';
import {
  handleVerifyRequest,
  handleVerifyToken,
  handleVerifyStatus,
} from './auth.verify.js';
import {
  handleListSessions,
  handleRevokeSession,
  handleRevokeAllSessions,
} from './auth.sessions.js';
import {
  handleOnboardingComplete,
  handleAuthPosition,
} from './auth.profile.js';

export function registerAuthRoutes(app: express.Application, prisma: PrismaClient) {
  // Sign-in / registration
  app.post('/auth/invite', (req, res) => handleAuthInvite(prisma, req, res));
  app.post('/auth/register', (req, res) => handleAuthRegister(prisma, req, res));
  app.post('/auth/login', (req, res) => handleAuthLogin(prisma, req, res));
  app.post('/auth/logout', (req, res) => handleAuthLogout(prisma, req, res));
  app.get('/auth/me', (req, res) => handleAuthMe(prisma, req, res));

  // Password flow
  app.post('/auth/forgot', (req, res) => handleAuthForgot(prisma, req, res));
  app.post('/auth/reset', (req, res) => handleAuthReset(prisma, req, res));
  app.post('/auth/change', (req, res) => handleAuthChange(prisma, req, res));

  // Email verification
  app.post('/auth/verify/request', (req, res) => handleVerifyRequest(prisma, req, res));
  app.post('/auth/verify', (req, res) => handleVerifyToken(prisma, req, res));
  app.get('/auth/verify/status', (req, res) => handleVerifyStatus(prisma, req, res));

  // Sessions
  app.get('/auth/sessions', (req, res) => handleListSessions(prisma, req, res));
  app.delete('/auth/sessions/:id', (req, res) => handleRevokeSession(prisma, req, res));
  app.delete('/auth/sessions', (req, res) => handleRevokeAllSessions(prisma, req, res));

  // Profile / onboarding / position
  app.post('/auth/onboarding/complete', (req, res) => handleOnboardingComplete(prisma, req, res));
  app.post('/auth/position', (req, res) => handleAuthPosition(prisma, req, res));
}
