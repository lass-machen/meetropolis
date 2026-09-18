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
import { type PackScope, resolvePublicPackScope, resolveTenantPackScope } from '../../services/packScope.js';
import type { PackKind } from '../../tenancyLoader.js';

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
 * Identity and ownership resolution are pack-independent. The pack kind is
 * passed only to the optional enterprise visibility boundary, whose UUIDs are
 * then folded into this same PackScope and the matching `*PackScopeWhere`
 * helper. Routes never add their own publication/grant filter.
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
 *     to that one tenant and lose access to other tenants' private packs.
 *     Route-specific visibility filters, such as excluding archived AssetPacks
 *     from collection responses, still apply after this ownership scope.
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
 * an error; it just yields fewer packs. Identity/membership failures resolve
 * through the public enterprise scope as well. Enterprise contract failures
 * are never swallowed here: a route fails closed instead of reopening every
 * global pack.
 */
export async function resolvePackScope(
  prisma: PrismaClient,
  req: express.Request,
  packKind: PackKind,
): Promise<PackScope> {
  let tenantId: string;
  try {
    const auth = requireAuth(req) ?? (await requireApiToken(req, prisma));
    if (!auth) return resolvePublicPackScope(prisma, packKind);
    if (await requireInternalOwner(req, auth.userId, prisma)) return { kind: 'all' };
    const tenant = getTenantFromReq(req);
    if (!tenant) return resolvePublicPackScope(prisma, packKind);
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership) return resolvePublicPackScope(prisma, packKind);
    tenantId = tenant.id;
  } catch (e) {
    logger.error('[Packs] identity scope resolution failed; using public pack visibility', e);
    return resolvePublicPackScope(prisma, packKind);
  }
  // Kept outside the identity try/catch: an enterprise contract failure must
  // propagate rather than be mistaken for an anonymous request.
  return resolveTenantPackScope(prisma, tenantId, packKind);
}
