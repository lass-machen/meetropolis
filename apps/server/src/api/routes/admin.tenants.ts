import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../../logger.js';
import {
  requireSuperAdmin,
  computeOnlineUsageByTenantSlug,
  getJwtSecret,
  setAuthCookie,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { getEmailService, emailTemplates } from '../../services/email.js';
import { getTenancyModule } from '../../tenancyLoader.js';

export async function getDefaultFreeSeats(prisma: PrismaClient): Promise<number> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const v = (internal as any)?.freeSeats;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  } catch { }
  const envV = Number(process.env.FREE_SEATS_DEFAULT || '');
  if (Number.isFinite(envV) && envV >= 0) return envV;
  return 3;
}

export async function isPublicRegistrationEnabled(prisma: PrismaClient): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const v = (internal as any)?.publicRegistrationEnabled;
    if (typeof v === 'boolean') return v;
  } catch { }
  const envV = process.env.PUBLIC_REGISTRATION_ENABLED;
  if (envV === 'false' || envV === '0') return false;
  return true;
}

export async function handlePublicConfig(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    res.json({ publicRegistrationEnabled: internal?.publicRegistrationEnabled ?? true });
  } catch {
    res.json({ publicRegistrationEnabled: true });
  }
}

export async function handleListTenants(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const list = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  const usage = computeOnlineUsageByTenantSlug();
  const out = list.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    concurrentLimit: t.concurrentLimit,
    freeSeats: t.freeSeats ?? 0,
    bypassLimits: !!t.bypassLimits,
    isInternal: !!t.isInternal,
    publicRegistrationEnabled: !!t.publicRegistrationEnabled,
    defaultMapName: t.defaultMapName ?? null,
    status: t.status ?? null,
    stripeCustomerId: t.stripeCustomerId ?? null,
    stripeSubscriptionId: t.stripeSubscriptionId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    online: usage[t.slug] || 0,
  }));
  res.json(out);
}

const createTenantSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(1),
  concurrentLimit: z.number().int().nonnegative().default(50),
  freeSeats: z.number().int().nonnegative().optional(),
  bypassLimits: z.boolean().optional(),
});

export async function handleCreateTenant(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const parse = createTenantSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  try {
    const freeDefault = typeof parse.data.freeSeats === 'number' ? parse.data.freeSeats : await getDefaultFreeSeats(prisma);
    const t = await prisma.tenant.create({
      data: {
        slug: parse.data.slug.toLowerCase(),
        name: parse.data.name,
        concurrentLimit: parse.data.concurrentLimit,
        freeSeats: freeDefault,
        bypassLimits: !!parse.data.bypassLimits,
      },
    });
    res.json({ id: t.id });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') { res.status(400).json({ error: 'slug_exists' }); return; }
    res.status(400).json({ error: 'create_failed' });
  }
}

const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  concurrentLimit: z.number().int().nonnegative().optional(),
  freeSeats: z.number().int().nonnegative().optional(),
  bypassLimits: z.boolean().optional(),
  defaultMapName: z.string().optional(),
});

export async function handleUpdateTenant(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const id = req.params.id;
  const parse = updateTenantSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  try {
    if (parse.data.defaultMapName) {
      const mapExists = await prisma.map.findFirst({ where: { tenantId: id, name: parse.data.defaultMapName } });
      if (!mapExists) {
        res.status(400).json({ error: 'map_not_found', message: `No map named "${parse.data.defaultMapName}" exists for this tenant.` });
        return;
      }
    }
    const t = await prisma.tenant.update({
      where: { id },
      data: {
        name: parse.data.name ?? undefined,
        concurrentLimit: parse.data.concurrentLimit ?? undefined,
        freeSeats: parse.data.freeSeats ?? undefined,
        bypassLimits: parse.data.bypassLimits ?? undefined,
        defaultMapName: parse.data.defaultMapName ?? undefined,
      },
    });
    res.json({ ok: true, id: t.id });
  } catch {
    res.status(400).json({ error: 'update_failed' });
  }
}

export async function handleDeleteTenant(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) { res.status(403).json({ error: 'forbidden' }); return; }
  const id = req.params.id;

  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) { res.status(404).json({ error: 'not_found' }); return; }
  if (tenant.isInternal) { res.status(400).json({ error: 'cannot_delete_internal' }); return; }

  try {
    await prisma.presence.deleteMany({ where: { tenantId: id } });
    await prisma.invite.deleteMany({ where: { tenantId: id } });
    await prisma.membership.deleteMany({ where: { tenantId: id } });
    await prisma.tenant.delete({ where: { id } });

    logger.info({ event: 'admin.tenant_deleted', tenantId: id, deletedBy: admin.userId });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'admin.tenant_delete.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'delete_failed' });
  }
}

const publicSignupSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

async function copyTemplateMaps(prisma: PrismaClient, tenantId: string): Promise<void> {
  const templateSlug = process.env.TEMPLATE_TENANT_SLUG;
  if (!templateSlug) return;
  try {
    const templateTenant = await prisma.tenant.findUnique({
      where: { slug: templateSlug },
      include: { maps: true },
    });
    if (!templateTenant?.maps?.length) return;
    const { copyMapToTenant } = await import('./adminMaps.js');
    for (const tplMap of templateTenant.maps) {
      await copyMapToTenant(prisma, tplMap.id, tenantId, tplMap.name);
    }
    if (templateTenant.defaultMapName) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { defaultMapName: templateTenant.defaultMapName },
      });
    }
  } catch (e) {
    logger.error({ event: 'signup.template_copy_failed', tenantId, error: String(e) });
  }
}

async function ensureSignupUser(prisma: PrismaClient, email: string, name: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  let user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (!user) {
    user = await prisma.user.create({
      data: { email, name, passwordHash: hash, emailVerifiedAt: new Date() },
    });
  }
  return user;
}

function sendSignupWelcomeEmail(email: string, name: string, slug: string, tenantId: string) {
  const loginUrl = process.env.BILLING_PUBLIC_URL
    ? `${process.env.BILLING_PUBLIC_URL.replace(/\/$/, '')}/#/app`
    : `https://${slug}.meetropolis.de`;
  const emailService = getEmailService();
  const emailContent = emailTemplates.welcomeTenant({
    name,
    tenantName: name,
    loginUrl,
  });
  emailContent.to = email;
  emailService.send(emailContent).catch((e) => {
    logger.error({ event: 'signup.welcome_email_failed', tenantId, error: String(e) });
  });
}

export async function handlePublicTenantSignup(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = publicSignupSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }

  const tenancy = await getTenancyModule();
  if (!tenancy.isMultiTenantEnabled()) { res.status(403).json({ error: 'multi_tenant_required' }); return; }

  if (!(await isPublicRegistrationEnabled(prisma))) { res.status(403).json({ error: 'registration_disabled' }); return; }

  const slug = parse.data.slug.toLowerCase();
  try {
    const exists = await prisma.tenant.findUnique({ where: { slug } });
    if (exists) { res.status(400).json({ error: 'slug_exists' }); return; }

    const freeDefault = await getDefaultFreeSeats(prisma);
    const tenant = await prisma.tenant.create({
      data: { slug, name: parse.data.name, concurrentLimit: 0, freeSeats: freeDefault, bypassLimits: false },
    });

    await copyTemplateMaps(prisma, tenant.id);

    const email = normalizeEmailForStorage(parse.data.email);
    const user = await ensureSignupUser(prisma, email, parse.data.name, parse.data.password);

    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: (user as any).id } } as any,
      update: { role: 'owner' as any },
      create: { tenantId: tenant.id, userId: (user as any).id, role: 'owner' as any },
    });

    const token = jwt.sign({ sub: (user as any).id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, token);

    sendSignupWelcomeEmail(email, parse.data.name, slug, tenant.id);

    res.json({
      ok: true,
      tenant: { id: tenant.id, slug: tenant.slug, freeSeats: tenant.freeSeats },
      user: { id: (user as any).id, email: (user as any).email },
    });
  } catch (e: unknown) {
    logger.error({ event: 'public.signup.error', error: e instanceof Error ? e.message : String(e) });
    res.status(400).json({ error: 'signup_failed' });
  }
}
