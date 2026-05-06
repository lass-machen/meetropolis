import type { Request, Response, NextFunction } from 'express';
import type { Tenant } from './generated/prisma/index.js';
import { createPrismaClient } from './db.js';
import { getTenancyModule } from './tenancyLoader.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './api/utils/authHelpers.js';

// Extended request with tenant properties
interface TenantRequest extends Request {
  tenantSlug?: string;
  tenantId?: string;
  tenant?: Tenant;
}

const prisma = createPrismaClient();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extractHost(req: Request): string | null {
  const xfHost = (req.headers['x-forwarded-host'] || '').toString();
  const host = (xfHost || req.headers.host || '').toString();
  return host || null;
}

function extractTenantSlugFromHost(host: string | null): string | null {
  if (!host) return null;
  // strip port
  const hostname = host.split(':')[0] || host;
  const parts = hostname.split('.');
  if (parts.length < 3) return null; // e.g. localhost, dev box, or apex
  return parts[0] || null; // first label as tenant slug
}

function sanitizeSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
}

/**
 * Try to resolve a tenant from the JWT auth token's `tid` claim.
 * Used as fallback when no tenant can be determined from host/header/query
 * (typically in development on localhost without subdomains).
 */
async function resolveTokenTenant(req: Request): Promise<Tenant | null> {
  try {
    const token = (req as any).cookies?.auth_token
      || req.headers['authorization']?.toString()?.replace('Bearer ', '');
    if (!token) return null;
    const payload = jwt.verify(token, getJwtSecret()) as any;
    const tenantId = payload?.tid;
    if (!tenantId) return null;
    return await prisma.tenant.findUnique({ where: { id: tenantId } });
  } catch {
    return null;
  }
}

// Paths that do not require tenant context (static files, health checks, tools)
const TENANT_BYPASS_PREFIXES = ['/tools', '/packs', '/assets', '/npc-media', '/metrics', '/healthz'];

function isTenantBypassPath(path: string): boolean {
  if (path === '/') return true;
  return TENANT_BYPASS_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
}

async function applySingleTenantFallback(req: TenantRequest, res: Response): Promise<boolean> {
  const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
  req.tenantSlug = fallback;

  let tenant = await prisma.tenant.findUnique({ where: { slug: fallback } });
  if (!tenant) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      res.status(404).json({ error: 'tenant_not_found' });
      return false;
    }
    tenant = await prisma.tenant.create({ data: { slug: fallback, name: fallback, concurrentLimit: 50 } });
  }

  req.tenant = tenant;
  req.tenantId = tenant.id;
  return true;
}

async function autoCreateDevTenant(slug: string): Promise<Tenant> {
  if (slug === 'internal') {
    return prisma.tenant.create({ data: { slug, name: 'Internal', concurrentLimit: 999999, bypassLimits: true, isInternal: true } });
  }
  return prisma.tenant.create({ data: { slug, name: slug, concurrentLimit: 50 } });
}

async function resolveTenantBySlug(req: TenantRequest): Promise<Tenant | null> {
  const fromHeader = (req.headers['x-tenant'] || '').toString();
  const fromQuery = (req.query?.tenant || '').toString();
  const fromHost = extractTenantSlugFromHost(extractHost(req) || null) || '';
  const explicitSlug = fromHeader || fromQuery;
  const raw = explicitSlug || fromHost || '';

  if (!raw) {
    const tokenTenant = await resolveTokenTenant(req);
    if (tokenTenant) {
      req.tenantSlug = tokenTenant.slug;
      return tokenTenant;
    }
  }

  const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
  const slug = sanitizeSlug(raw || fallback) || 'default';
  req.tenantSlug = slug;

  let tenant = await prisma.tenant.findUnique({ where: { slug } });

  if (!tenant && !explicitSlug && slug !== fallback) {
    tenant = await prisma.tenant.findUnique({ where: { slug: fallback } });
    if (tenant) req.tenantSlug = fallback;
  }

  if (!tenant) {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      const targetSlug = req.tenantSlug || 'default';
      tenant = await autoCreateDevTenant(targetSlug);
      req.tenantSlug = targetSlug;
    }
  }

  return tenant;
}

export async function tenantMiddleware(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    if (isTenantBypassPath(req.path)) {
      return next();
    }

    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      const ok = await applySingleTenantFallback(req, res);
      if (!ok) return;
      return next();
    }

    const tenant = await resolveTenantBySlug(req);
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return next();
  } catch (error: unknown) {
    return res.status(500).json({ error: 'tenant_resolution_failed', details: getErrorMessage(error) });
  }
}

