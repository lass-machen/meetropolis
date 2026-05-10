import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '../../logger.js';

const COOKIE_NAME = 'auth_token';

let cachedJwtSecret: string | null = null;
let cachedApiTokenPepper: string | null = null;

export function getJwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    cachedJwtSecret = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET fehlt in Produktion');
  }
  // Development: ephemeres Secret, nur für lokale Sessions
  const key = (globalThis as any).__DEV_JWT_SECRET__ as string | undefined;
  if (key && key.length > 0) return key;
  const devSecret = crypto.randomBytes(32).toString('hex');
  try {
    logger.warn('[SECURITY] JWT_SECRET fehlt – verwende ephemeres DEV-Secret.');
  } catch {}
  (globalThis as any).__DEV_JWT_SECRET__ = devSecret;
  cachedJwtSecret = devSecret;
  return devSecret;
}

export function getApiTokenPepper(): string {
  if (cachedApiTokenPepper) return cachedApiTokenPepper;
  const fromEnv = process.env.API_TOKEN_PEPPER;
  if (fromEnv && fromEnv.length > 0) {
    cachedApiTokenPepper = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] API_TOKEN_PEPPER fehlt in Produktion');
  }
  const devPepper = crypto.randomBytes(32).toString('hex');
  logger.warn(
    '[SECURITY] API_TOKEN_PEPPER fehlt – verwende ephemeres DEV-Pepper. Tokens verlieren Gültigkeit bei Neustart.',
  );
  cachedApiTokenPepper = devPepper;
  return devPepper;
}

export function setAuthCookie(res: express.Response, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  // Allow explicit override of secure cookie flag (useful for local Docker testing)
  const cookieSecureEnv = process.env.COOKIE_SECURE;
  const secure = cookieSecureEnv !== undefined ? cookieSecureEnv === 'true' : isProduction;
  // Use 'strict' in production for CSRF protection, 'lax' in development for easier testing
  // Note: 'strict' prevents cookie from being sent on cross-site navigation,
  // which provides strong CSRF protection but may require users to re-login after following external links
  const sameSite = isProduction ? 'strict' : 'lax';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: sameSite,
    secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function requireAuth(req: express.Request): { userId: string; tenantId?: string } | null {
  const raw = (req as any).cookies?.[COOKIE_NAME] || req.headers['authorization']?.toString()?.replace('Bearer ', '');
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, getJwtSecret()) as any;
    return { userId: payload.sub, tenantId: payload.tid };
  } catch {
    return null;
  }
}

export async function requireApiToken(req: express.Request, prisma: PrismaClient): Promise<{ userId: string } | null> {
  const authz = req.headers['authorization']?.toString();
  if (!authz || !authz.startsWith('Bearer ')) return null;
  const token = authz.slice('Bearer '.length).trim();
  if (!token || token.split('.').length === 3) {
    // Sieht nach JWT aus → nicht als API-Token behandeln
    return null;
  }
  const hash = crypto
    .createHash('sha256')
    .update(getApiTokenPepper() + token)
    .digest('hex');
  const found = await prisma.apiToken.findUnique({ where: { hash } });
  if (!found) return null;
  await prisma.apiToken.update({ where: { hash }, data: { lastUsedAt: new Date() } });
  return { userId: found.userId };
}

export function getTenantFromReq(
  req: express.Request,
): { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null {
  const t: any = (req as any).tenant;
  if (t && t.id && t.slug)
    return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  return null;
}

export function getUserIdFromReq(req: express.Request): string | null {
  const auth = requireAuth(req);
  return auth?.userId ?? null;
}

export async function requireMembership(
  req: express.Request,
  userId: string,
  prisma: PrismaClient,
): Promise<{ role: string } | null> {
  const tenant = getTenantFromReq(req);
  if (!tenant) return null;
  const m = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId } } as any });
  if (!m) return null;
  return { role: (m as any).role };
}

export async function requireSuperAdmin(
  req: express.Request,
  prisma: PrismaClient,
): Promise<{ userId: string } | null> {
  const auth = requireAuth(req) || (await requireApiToken(req, prisma));
  if (!auth) return null;
  const ok = await requireInternalOwner(req, auth.userId, prisma);
  if (!ok) return null;
  return auth;
}

export async function requireInternalOwner(
  _req: express.Request,
  userId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    if (!internal) return false;
    const member = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: internal.id, userId } } as any,
    });
    if (!member) return false;
    return (member as any).role === 'owner';
  } catch {
    return false;
  }
}

export function normalizeEmailForStorage(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeEmailForMatching(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const plusIndex = local.indexOf('+');
  const localBase = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
  return `${localBase}@${domain}`;
}

export function computeOnlineUsageByTenantSlug(): Record<string, number> {
  const usage: Record<string, number> = {};
  try {
    const activeWorldRooms: any = global.activeWorldRooms;
    const rooms: any[] = activeWorldRooms ? Array.from(activeWorldRooms.values()) : [];
    for (const r of rooms) {
      const slug = r.metadata?.tenant || 'default';
      const n = r.state?.players?.size || 0;
      usage[slug] = (usage[slug] || 0) + n;
    }
  } catch {}
  return usage;
}
