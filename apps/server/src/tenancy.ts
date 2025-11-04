import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { getTenancyModule } from './tenancyLoader.js';

const prisma = new PrismaClient();

function extractHost(req: express.Request): string | null {
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

export async function tenantMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    // Feature-Gate: In OSS-Only Builds ohne Enterprise-Package strikt Single-Tenant fahren
    try {
      const tenancy = await getTenancyModule();
      if (!tenancy.isMultiTenantEnabled()) {
        const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
        (req as any).tenantSlug = fallback;
        // In OSS-Modus: tatsächlichen Tenant laden und an Request hängen
        let tenant = await prisma.tenant.findUnique({ where: { slug: fallback } });
        if (!tenant) {
          const isProd = process.env.NODE_ENV === 'production';
          if (isProd) {
            return res.status(404).json({ error: 'tenant_not_found' });
          }
          // Entwicklung: Default-Tenant anlegen
          tenant = await prisma.tenant.create({ data: { slug: fallback, name: fallback, concurrentLimit: 50 } });
        }
        (req as any).tenant = tenant;
        (req as any).tenantId = tenant.id;
        return next();
      }
    } catch {}

    const fromHeader = (req.headers['x-tenant'] || '').toString();
    const fromQuery = (req.query?.tenant || '').toString();
    const fromHost = extractTenantSlugFromHost(extractHost(req) || null) || '';
    const raw = fromHeader || fromQuery || fromHost || '';
    const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
    const slug = sanitizeSlug(raw || fallback) || 'default';

    // Cache on request for downstream handlers
    (req as any).tenantSlug = slug;

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

    (req as any).tenant = tenant;
    (req as any).tenantId = tenant.id;
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: 'tenant_resolution_failed' });
  }
}


