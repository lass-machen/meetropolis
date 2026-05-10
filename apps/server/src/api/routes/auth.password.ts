import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, normalizeEmailForMatching } from '../utils/authHelpers.js';

const forgotSchema = z.object({ email: z.string().email() });

/**
 * Self-Service-Forgot ist deaktiviert. Reset-Tokens fuer sensible Aktionen
 * werden NIE per Mail verschickt — auch nicht im Tenancy-Setup. Stattdessen
 * erzeugt ein Admin Reset-Tokens ueber die Admin-UI und gibt sie
 * out-of-band an den User weiter. Endpoint antwortet still 200, um keine
 * User-Enumerierung zu erlauben.
 */
export function handleAuthForgot(_prisma: PrismaClient, req: express.Request, res: express.Response): void {
  const parse = forgotSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'email required' });
    return;
  }
  logger.warn({ event: 'auth.forgot.disabled', email: parse.data.email });
  res.json({ ok: true });
}

const resetSchema = z.object({
  email: z.string().email().optional(),
  token: z.string().min(8),
  password: z.string().min(8),
});

export async function handleAuthReset(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = resetSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'token and password required' });
    return;
  }
  const { email, token, password } = parse.data;
  const pr = await prisma.passwordReset.findUnique({ where: { token } });
  if (!pr || pr.usedAt || pr.expiresAt < new Date()) {
    res.status(400).json({ error: 'invalid token' });
    return;
  }
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

export async function handleAuthChange(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parse = changeSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }
  const { currentPassword, newPassword } = parse.data;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user || !user.passwordHash) {
    res.status(400).json({ error: 'no password set' });
    return;
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'invalid current password' });
    return;
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  res.json({ ok: true });
}
