import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  requireAuth,
  getTenantFromReq,
  normalizeEmailForStorage,
  normalizeEmailForMatching,
} from '../utils/authHelpers.js';
import { getEmailService, emailTemplates } from '../../services/email.js';

const forgotSchema = z.object({ email: z.string().email() });

export async function handleAuthForgot(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = forgotSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'email required' }); return; }
  const email = parse.data.email;
  const emailLookup = normalizeEmailForStorage(email);
  const user = await prisma.user.findFirst({ where: { email: { equals: emailLookup, mode: 'insensitive' } } });
  if (!user) { res.json({ ok: true }); return; }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
  await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });

  const tenant = getTenantFromReq(req);
  const baseUrl = process.env.BILLING_PUBLIC_URL || req.headers.origin || `https://${tenant?.slug || 'app'}.meetropolis.de`;
  const resetUrl = `${baseUrl}/#/reset?token=${token}&email=${encodeURIComponent(email)}`;

  const emailService = getEmailService();
  const emailContent = emailTemplates.resetPassword({
    name: user.name || '',
    resetUrl,
  });
  emailContent.to = email;

  emailService.send(emailContent).catch((e) => {
    logger.error({ event: 'auth.forgot.email_failed', userId: user.id, error: String(e) });
  });

  const isDev = process.env.NODE_ENV !== 'production';
  res.json({ ok: true, ...(isDev && { token }) });
}

const resetSchema = z.object({
  email: z.string().email().optional(),
  token: z.string().min(8),
  password: z.string().min(8),
});

export async function handleAuthReset(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = resetSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'token and password required' }); return; }
  const { email, token, password } = parse.data;
  const pr = await prisma.passwordReset.findUnique({ where: { token } });
  if (!pr || pr.usedAt || pr.expiresAt < new Date()) { res.status(400).json({ error: 'invalid token' }); return; }
  if (email) {
    const u = await prisma.user.findUnique({ where: { id: pr.userId } });
    if (!u || normalizeEmailForMatching(u.email) !== normalizeEmailForMatching(email)) {
      res.status(400).json({ error: 'invalid token' });
      return;
    }
  }
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: pr.userId }, data: { passwordHash: hash } });
  await prisma.passwordReset.update({ where: { token }, data: { usedAt: new Date() } });
  res.json({ ok: true });
}

const changeSchema = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) });

export async function handleAuthChange(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
  const parse = changeSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'currentPassword and newPassword required' }); return; }
  const { currentPassword, newPassword } = parse.data;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user || !user.passwordHash) { res.status(400).json({ error: 'no password set' }); return; }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) { res.status(401).json({ error: 'invalid current password' }); return; }
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  res.json({ ok: true });
}
