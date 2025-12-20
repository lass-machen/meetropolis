import type { Request, Response, NextFunction } from 'express';
import type { Tenant } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { getTenancyModule } from './tenancyLoader.js';

// Extended request with tenant properties
interface TenantRequest extends Request {
  tenantSlug?: string;
  tenantId?: string;
  tenant?: Tenant;
}

const prisma = new PrismaClient();

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

export async function tenantMiddleware(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    // Feature-Gate: In OSS-Only Builds ohne Enterprise-Package strikt Single-Tenant fahren
    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
      req.tenantSlug = fallback;

      let tenant = await prisma.tenant.findUnique({ where: { slug: fallback } });
      if (!tenant) {
        const isProd = process.env.NODE_ENV === 'production';
        if (isProd) return res.status(404).json({ error: 'tenant_not_found' });
        tenant = await prisma.tenant.create({ data: { slug: fallback, name: fallback, concurrentLimit: 50 } });
      }

      req.tenant = tenant;
      req.tenantId = tenant.id;
      return next();
    }

    const fromHeader = (req.headers['x-tenant'] || '').toString();
    const fromQuery = (req.query?.tenant || '').toString();
    const fromHost = extractTenantSlugFromHost(extractHost(req) || null) || '';
    const raw = fromHeader || fromQuery || fromHost || '';
    const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
    const slug = sanitizeSlug(raw || fallback) || 'default';

    // Cache on request for downstream handlers
    req.tenantSlug = slug;

    // Load tenant; in development, create on demand for convenience
    let tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        // Auto-create known special slugs in dev to avoid bootstrapping steps
        if (slug === 'internal') {
          tenant = await prisma.tenant.create({ data: { slug, name: 'Internal', concurrentLimit: 999999, bypassLimits: true, isInternal: true } });
        } else {
          tenant = await prisma.tenant.create({ data: { slug, name: slug, concurrentLimit: 50 } });
        }
      }
    }
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return next();
  } catch (error: unknown) {
    return res.status(500).json({ error: 'tenant_resolution_failed', details: getErrorMessage(error) });
  }
}

