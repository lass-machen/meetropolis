import type express from 'express';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { getRequestRouteTemplate } from '../utils/requestRoute.js';
import { requireApiToken, requireAuth } from '../utils/authHelpers.js';
import { hasTenantAccess } from '../utils/tenantMembership.js';
import {
  clearTenantAccessDenied,
  getDeniedTenant,
  isTenantAccessDenied,
  markTenantAccessDenied,
} from '../utils/tenantAccessState.js';

/**
 * Central tenant authorization for HTTP requests.
 *
 * `tenantMiddleware` (tenancy.ts) resolves WHICH tenant a request is about from
 * signals the client controls: the X-Tenant header, `?tenant=`, the session's
 * `tid` claim and the host. Resolution is not authorization. Before this
 * middleware existed every route had to check membership on its own, and the
 * ones that forgot served any tenant to any signed-in caller.
 *
 * This middleware runs right after the session middleware. For an
 * authenticated caller (session or API token) it keeps the tenant context only
 * when the caller is a member of that tenant (an expired guest membership does
 * not count) or an operator (owner of the internal tenant). Otherwise it drops
 * `req.tenant`, so `getTenantFromReq` returns null and every tenant-scoped
 * route fails closed with `tenant_required` instead of serving a foreign
 * tenant.
 *
 * Unauthenticated requests and `/public/*` keep their tenant by design.
 * Credential routes that prove a new identity declare their exception on the
 * route itself, after this guard has had a chance to reject a foreign session.
 */

function tenantSource(req: express.Request): 'header' | 'query' | 'token_or_host' {
  if (req.headers['x-tenant']) return 'header';
  if (typeof req.query?.tenant === 'string' && req.query.tenant) return 'query';
  return 'token_or_host';
}

async function resolveCallerId(prisma: PrismaClient, req: express.Request): Promise<string | null> {
  const session = requireAuth(req);
  if (session) return session.userId;
  const token = await requireApiToken(req, prisma);
  return token?.userId ?? null;
}

function dropTenantContext(req: express.Request, tenant: Tenant): void {
  req.tenant = undefined;
  req.tenantId = undefined;
  markTenantAccessDenied(req, tenant);
}

/** Fields describing a refused tenant, returned instead of logged by the guard. */
export interface TenantAccessDenial {
  userId: string;
  tenant: string;
  source: 'header' | 'query' | 'token_or_host';
  method: string;
  path: string;
}

/**
 * Drop the tenant context of `req` when its authenticated caller may not
 * access that tenant. Returns the denial fields when access was refused, null
 * otherwise; the drop and its marking stay unchanged. Logging happens in
 * `createTenantAccessMiddleware`, once the response shows the denial still
 * stands.
 */
export async function enforceTenantMembership(
  prisma: PrismaClient,
  req: express.Request,
): Promise<TenantAccessDenial | null> {
  const tenant = req.tenant;
  if (!tenant) return null;
  // Public endpoints (login branding, tenant sign-up, contact) serve anonymous
  // callers by design; a session must not make them stricter than that.
  if (req.path.startsWith('/public/')) return null;
  const userId = await resolveCallerId(prisma, req);
  if (!userId) return null;
  if (await hasTenantAccess(prisma, userId, tenant.id)) return null;

  dropTenantContext(req, tenant);
  return {
    userId,
    tenant: tenant.slug,
    source: tenantSource(req),
    method: req.method,
    path: getRequestRouteTemplate(req),
  };
}

/**
 * Credential routes prove a NEW identity (credentials, guest, reset or verify
 * token). They declare this exception on the route so Express' own matching
 * (case-insensitive with an optional trailing slash) controls it instead of a
 * second path list. A different session sent with credentials must not change
 * tenant resolution for these endpoints.
 */
export const credentialRoute: express.RequestHandler = (req, _res, next) => {
  const tenant = getDeniedTenant(req);
  if (tenant) {
    req.tenant = tenant;
    req.tenantId = tenant.id;
    clearTenantAccessDenied(req);
  }
  next();
};

export function createTenantAccessMiddleware(prisma: PrismaClient): express.RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const tenant = req.tenant;
      try {
        const denial = await enforceTenantMembership(prisma, req);
        if (denial) {
          // A refusal is only logged once it still stands when the response
          // ends; a credential route that takes its tenant back via
          // credentialRoute leaves no denial behind, so it logs no event.
          let logged = false;
          const flush = (): void => {
            if (logged) return;
            logged = true;
            if (isTenantAccessDenied(req)) {
              logger.warn({
                event: 'tenant.access_denied',
                ...denial,
                path: getRequestRouteTemplate(req),
                status: res.statusCode,
              });
            }
          };
          res.once('finish', flush);
          res.once('close', flush);
        }
      } catch (e: unknown) {
        // Fail closed: without a verdict the request must not keep a tenant.
        logger.error({
          event: 'tenant.access_check_failed',
          path: getRequestRouteTemplate(req),
          error: e instanceof Error ? e.message : String(e),
        });
        if (tenant) dropTenantContext(req, tenant);
      }
      next();
    })();
  };
}
