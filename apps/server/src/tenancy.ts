import type { Request, Response, NextFunction } from 'express';
import type { Tenant } from './generated/prisma/index.js';
import { PrismaClient } from './generated/prisma/index.js';
import { getTenancyModule } from './tenancyLoader.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './api/utils/authHelpers.js';

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

export async function tenantMiddleware(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    // Bypass tenant resolution for routes that don't need it
    if (req.path === '/' || TENANT_BYPASS_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) {
      return next();
    }

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
    const explicitSlug = fromHeader || fromQuery;
    const raw = explicitSlug || fromHost || '';

    // JWT-based tenant fallback: When no tenant can be determined from host/header/query
    // (e.g. localhost in development), use the tenant ID from the user's auth token.
    if (!raw) {
      const tokenTenant = await resolveTokenTenant(req);
      if (tokenTenant) {
        req.tenantSlug = tokenTenant.slug;
        req.tenant = tokenTenant;
        req.tenantId = tokenTenant.id;
        return next();
      }
    }

    const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
    const slug = sanitizeSlug(raw || fallback) || 'default';

    // Cache on request for downstream handlers
    req.tenantSlug = slug;

    // Load tenant; in development, create on demand for convenience
    let tenant = await prisma.tenant.findUnique({ where: { slug } });

    // If slug came from hostname (not explicit header/query) and didn't match,
    // fall back to the default tenant (e.g. api.meetropolis.me extracts "api"
    // which is not a tenant — use "default" instead)
    if (!tenant && !explicitSlug && slug !== fallback) {
      tenant = await prisma.tenant.findUnique({ where: { slug: fallback } });
      if (tenant) req.tenantSlug = fallback;
    }

    if (!tenant) {
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        // Auto-create known special slugs in dev to avoid bootstrapping steps
        const targetSlug = req.tenantSlug || 'default';
        if (targetSlug === 'internal') {
          tenant = await prisma.tenant.create({ data: { slug: targetSlug, name: 'Internal', concurrentLimit: 999999, bypassLimits: true, isInternal: true } });
        } else {
          tenant = await prisma.tenant.create({ data: { slug: targetSlug, name: targetSlug, concurrentLimit: 50 } });
        }
        req.tenantSlug = targetSlug;
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

