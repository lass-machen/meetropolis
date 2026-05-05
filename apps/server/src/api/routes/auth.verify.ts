import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth } from '../utils/authHelpers.js';
import { sendIfAvailable } from '../../emailLoader.js';

export async function handleVerifyRequest(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }

    if (user.emailVerifiedAt) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    const recent = await prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
    });
    if (recent) {
      res.status(429).json({ error: 'Please wait before requesting another verification email' });
      return;
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.emailVerification.create({
      data: { token, userId: user.id, email: user.email, expiresAt },
    });

    // Public base URL für Verify-Link. Reihenfolge:
    // 1. PUBLIC_BASE_URL / BILLING_PUBLIC_URL (Self-Hoster setzen das)
    // 2. Origin-Header der Request (klappt für Web-getriggerte Verifies)
    // 3. Host-Header als Fallback (verhindert Brand-Domain-Leak)
    const fallbackHost = req.headers.host ? `https://${req.headers.host}` : '';
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BILLING_PUBLIC_URL || req.headers.origin || fallbackHost;
    const verifyUrl = baseUrl ? `${baseUrl}/#/verify?token=${token}` : '';

    const sent = await sendIfAvailable(
      (mod) => mod.sendVerify({ to: user.email, name: user.name || '', verifyUrl }),
      'auth.verify.email_failed',
      { userId: user.id },
    );

    // Wenn keine Mail rausging (OSS ohne Tenancy-Mail-Modul) liefern wir
    // Token+Link direkt im Response, damit der User/Admin den Verify-Schritt
    // out-of-band durchfuehren kann.
    const isDev = process.env.NODE_ENV !== 'production';
    res.json({ ok: true, sent, ...((!sent || isDev) && { token, verifyUrl }) });
  } catch (e: unknown) {
    logger.error({ event: 'auth.verify.request_failed', error: String(e) });
    res.status(500).json({ error: 'verification request failed' });
  }
}

const verifySchema = z.object({ token: z.string().min(8) });

export async function handleVerifyToken(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = verifySchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'token required' }); return; }

  const { token } = parse.data;

  try {
    const verification = await prisma.emailVerification.findUnique({ where: { token } });
    if (!verification) { res.status(400).json({ error: 'invalid token' }); return; }
    if (verification.usedAt) { res.status(400).json({ error: 'token already used' }); return; }
    if (verification.expiresAt < new Date()) { res.status(400).json({ error: 'token expired' }); return; }

    await prisma.emailVerification.update({
      where: { token },
      data: { usedAt: new Date() },
    });

    await prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerifiedAt: new Date() },
    });

    logger.info({ event: 'auth.verify.success', userId: verification.userId });
    res.json({ ok: true, message: 'Email verified successfully' });
  } catch (e: unknown) {
    logger.error({ event: 'auth.verify.failed', error: String(e) });
    res.status(500).json({ error: 'verification failed' });
  }
}

export async function handleVerifyStatus(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }

    res.json({
      email: user.email,
      verified: !!user.emailVerifiedAt,
      verifiedAt: user.emailVerifiedAt?.toISOString() || null,
    });
  } catch {
    res.status(500).json({ error: 'status check failed' });
  }
}
