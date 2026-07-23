import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import {
  requireAuth,
  requireApiToken,
  requireInternalOwner,
  getTenantFromReq,
  requireMembership,
} from './authHelpers.js';
import { type PackScope, CATALOG_SCOPE, tenantScope } from '../../services/packScope.js';

/**
 * The pack visibility scope a REST caller has PROVEN — the single resolver
 * behind every pack read and every usability check on the HTTP surface, for
 * BOTH pack kinds:
 *   - AvatarPack: `GET /avatar-packs`, `GET /avatar-packs/:id`,
 *     `PATCH /me/avatar`, onboarding-complete, the NPC avatar surface;
 *   - AssetPack:  `GET /asset-packs`, `GET /asset-packs/:id` and the
 *     `assetPackUuid` check on object placement
 *     (`POST /maps/:id/objects` and its bulk twin).
 * One resolver, so "listable" and "usable" cannot drift apart — and so the two
 * pack kinds cannot drift apart from each other either.
 *
 * The resolution is deliberately pack-independent: it establishes WHO the
 * caller is, not WHAT they asked for. The pack kind only picks the matching
 * `*ScopeWhere` helper in services/packScope.ts.
 *
 * Resolution order:
 *  1. Identity — a session cookie/JWT or an API token. Both are accepted
 *     because the pack-management tools authenticate either way; an API token
 *     is not blanket-privileged, it inherits exactly its owning user's
 *     authority (same posture as `authenticateAvatarPackAdmin` and
 *     `authenticateAssetPackAdmin`). No identity means catalog.
 *  2. Platform super-admin (owner of the internal tenant) — the unfiltered
 *     scope, checked BEFORE the membership path on purpose: a super-admin who
 *     also holds an ordinary membership somewhere would otherwise be narrowed
 *     to that one tenant and lose sight of every other tenant's private pack in
 *     the management tools. Two indexed point lookups on a route that runs once
 *     per registry load.
 *  3. Membership in the RESOLVED tenant. Tenant resolution is not
 *     authorisation: tenancy.ts lets the client-supplied `X-Tenant` header (or
 *     `?tenant=`) win over the session JWT, so `req.tenant` can name any
 *     tenant. Only a membership row turns it into a scope — a spoofed header
 *     names a tenant the caller does not belong to, the lookup misses, and the
 *     request falls back to catalog.
 *
 * Deliberately SOFT where maps.read.ts is hard: it returns a narrower scope
 * instead of writing 401/403, because the read routes must stay publicly
 * reachable — `avatarRegistry.loadPacks` fetches them during onboarding, before
 * any tenant binding exists. "Nothing proven" is a legitimate state here, not
 * an error; it just yields fewer packs. Every failure path, including a
 * rejected lookup, resolves to `CATALOG_SCOPE`, so the guard fails closed.
 */
export async function resolvePackScope(prisma: PrismaClient, req: express.Request): Promise<PackScope> {
  try {
    const auth = requireAuth(req) ?? (await requireApiToken(req, prisma));
    if (!auth) return CATALOG_SCOPE;
    if (await requireInternalOwner(req, auth.userId, prisma)) return { kind: 'all' };
    const tenant = getTenantFromReq(req);
    if (!tenant) return CATALOG_SCOPE;
    const membership = await requireMembership(req, auth.userId, prisma);
    return membership ? tenantScope(tenant.id) : CATALOG_SCOPE;
  } catch (e) {
    logger.error('[Packs] scope resolution failed, falling back to catalog packs', e);
    return CATALOG_SCOPE;
  }
}
