import type { Request, Response, NextFunction } from 'express';
import type { Tenant, PrismaClient } from './generated/prisma/index.js';
import { createPrismaClient } from './db.js';
import { getTenancyModule } from './tenancyLoader.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './api/utils/authHelpers.js';
import { readAuthCookie, readBearerToken, type AuthTokenPayload } from './types/authShapes.js';

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
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '');
}

/**
 * Resolve the tenant named by the JWT auth token's `tid` claim.
 *
 * On the root-domain architecture the tenant context of an authenticated
 * request travels in the auth token (or an explicit header), not a subdomain,
 * so this is the authoritative signal for logged-in users. See
 * resolveTenantBySlug for where it sits in the priority chain.
 */
async function resolveTokenTenant(prisma: PrismaClient, req: Request): Promise<Tenant | null> {
  try {
    const token = readAuthCookie(req) ?? readBearerToken(req);
    if (!token) return null;
    const payload = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
    const tenantId = payload?.tid;
    if (!tenantId) return null;
    return await prisma.tenant.findUnique({ where: { id: tenantId } });
  } catch {
    return null;
  }
}

// Paths that do not require tenant context (static files, health checks, tools).
//
// A bypass here means the path gets NO tenant and NO auth: `/packs` is plain
// `express.static` with `Access-Control-Allow-Origin: *` (index.ts). That also
// covers `/packs/avatars/custom/<uuid>.png`, the composed per-user sprites,
// which are therefore world-readable to anyone holding the uuid. Deliberate and
// documented — the fetch path cannot carry credentials; see the rationale on
// `customSpriteUrl` in services/avatarComposer.ts before adding a gate here.
const TENANT_BYPASS_PREFIXES = ['/tools', '/packs', '/assets', '/npc-media', '/metrics', '/healthz'];

function isTenantBypassPath(path: string): boolean {
  if (path === '/') return true;
  return TENANT_BYPASS_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
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

function autoCreateDevTenant(prisma: PrismaClient, slug: string): Promise<Tenant> {
  if (slug === 'internal') {
    return prisma.tenant.create({
      data: { slug, name: 'Internal', concurrentLimit: 999999, bypassLimits: true, isInternal: true },
    });
  }
  return prisma.tenant.create({ data: { slug, name: slug, concurrentLimit: 50 } });
}

/**
 * Resolve an explicit tenant signal (X-Tenant header or ?tenant= query).
 *
 * Explicit signals name the tenant deliberately, so they win over the token
 * and the host. They are also the ONLY source allowed to auto-create a tenant
 * in development: a header/query is a conscious choice, whereas a host label is
 * infrastructure. An explicit but unknown slug in production yields null (a
 * genuine tenant_not_found for the caller).
 */
async function resolveExplicitSlug(
  prisma: PrismaClient,
  req: TenantRequest,
  explicitSlug: string,
): Promise<Tenant | null> {
  const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
  const slug = sanitizeSlug(explicitSlug) || fallback;
  req.tenantSlug = slug;

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (tenant) return tenant;

  if (process.env.NODE_ENV !== 'production') {
    return autoCreateDevTenant(prisma, slug);
  }
  return null;
}

/**
 * Resolve the tenant from the request host, then fall back to the single-tenant
 * default. A host label such as "api" on api.<domain> is infrastructure, not a
 * tenant intent, so a host-derived slug that does not resolve falls through to
 * the default tenant and is NEVER auto-created — only the default tenant itself
 * may be provisioned in development. This keeps unauthenticated api-host
 * requests (e.g. /public/config) working without minting artifact tenants.
 */
async function resolveHostOrDefault(prisma: PrismaClient, req: TenantRequest): Promise<Tenant | null> {
  const fromHost = extractTenantSlugFromHost(extractHost(req)) || '';
  const fallback = process.env.DEFAULT_TENANT_SLUG || 'default';
  const slug = sanitizeSlug(fromHost || fallback) || fallback;
  req.tenantSlug = slug;

  const hostTenant = await prisma.tenant.findUnique({ where: { slug } });
  if (hostTenant) return hostTenant;

  req.tenantSlug = fallback;
  const fallbackTenant = slug === fallback ? null : await prisma.tenant.findUnique({ where: { slug: fallback } });
  if (fallbackTenant) return fallbackTenant;

  if (process.env.NODE_ENV !== 'production') {
    return autoCreateDevTenant(prisma, fallback);
  }
  return null;
}

/**
 * Resolve the active tenant for a request following a strict priority chain:
 *
 *   1. Explicit signal — X-Tenant header or ?tenant= query (deliberate choice)
 *   2. Auth token      — the `tid` claim of the session JWT
 *   3. Host / default  — host label parsing, then the single-tenant default
 *
 * Meetropolis runs on one root domain; tenants are addressed by the token (or
 * an explicit header the app sends after tenant selection), not by subdomain.
 * The token MUST therefore be consulted before host parsing, otherwise an
 * infrastructure host such as api.<domain> would be misread as a tenant named
 * "api" for authenticated requests (breaking GET /auth/me with 403).
 *
 * IMPORTANT — resolution is NOT authorization. Letting the explicit X-Tenant
 * signal win is deliberate (it also serves unauthenticated flows such as login,
 * registration and /public/config, where no membership exists to check yet), so
 * this function answers only "which tenant is this request about", never "may
 * this caller touch that tenant". A tenant-scoped, sensitive endpoint MUST gate
 * membership itself (requireMembership against req.tenant) — the same pattern
 * used by /auth/me, GET/PATCH /tenant, /maps, /livekit/token and
 * createRequireTenantAdmin — or an authenticated user can point req.tenant at a
 * foreign tenant merely by sending the header.
 */
export async function resolveTenantBySlug(prisma: PrismaClient, req: TenantRequest): Promise<Tenant | null> {
  const fromHeader = String(req.headers['x-tenant'] ?? '');
  const queryTenant = req.query?.tenant;
  const fromQuery = typeof queryTenant === 'string' ? queryTenant : '';
  const explicitSlug = fromHeader || fromQuery;

  if (explicitSlug) {
    return resolveExplicitSlug(prisma, req, explicitSlug);
  }

  const tokenTenant = await resolveTokenTenant(prisma, req);
  if (tokenTenant) {
    req.tenantSlug = tokenTenant.slug;
    return tokenTenant;
  }

  return resolveHostOrDefault(prisma, req);
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

    const tenant = await resolveTenantBySlug(prisma, req);
    if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

    req.tenant = tenant;
    req.tenantId = tenant.id;
    return next();
  } catch (error: unknown) {
    return res.status(500).json({ error: 'tenant_resolution_failed', details: getErrorMessage(error) });
  }
}
