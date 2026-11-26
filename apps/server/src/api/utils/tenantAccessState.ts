import type express from 'express';
import type { Tenant } from '../../generated/prisma/index.js';

/**
 * Remembers which tenant the central guard removed from a request (see
 * api/middleware/tenantAccess.ts). Kept free of runtime imports so the guard,
 * auth helpers and route helpers can share it without an import cycle.
 */
const deniedTenants = new WeakMap<express.Request, Tenant>();

export function markTenantAccessDenied(req: express.Request, tenant: Tenant): void {
  deniedTenants.set(req, tenant);
}

/** True when the central guard removed the tenant context of `req`. */
export function isTenantAccessDenied(req: express.Request): boolean {
  return deniedTenants.has(req);
}

/** The tenant the central guard removed from `req`, if any. */
export function getDeniedTenant(req: express.Request): Tenant | undefined {
  return deniedTenants.get(req);
}

/** Forget the tenant denial after a credential route restores its tenant context. */
export function clearTenantAccessDenied(req: express.Request): void {
  deniedTenants.delete(req);
}
