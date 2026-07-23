import type { Prisma } from '../generated/prisma/index.js';

/**
 * Which packs a caller may see AND use. ONE scope type for BOTH pack kinds
 * (AvatarPack and AssetPack), because the resolution is pack-independent: it
 * answers "which tenant has this caller proven?", never "which pack are we
 * talking about?".
 *
 * `AvatarPack.tenantId` / `AssetPack.tenantId` are the ownership markers (see
 * schema.prisma): NULL means catalog — shipped with the platform, visible to
 * every tenant — while a set value means the pack belongs to exactly one
 * tenant and to nobody else.
 *
 * The three cases:
 * - `catalog`  — nothing proven about the caller. The fail-closed default: an
 *   anonymous request, a caller whose tenant could not be established, or a
 *   membership lookup that missed or errored.
 * - `tenant`   — the caller has a PROVEN binding to that tenant (a membership
 *   row, or a JWT-verified `tid` on the world-join path). Catalog packs plus
 *   that tenant's own private packs.
 * - `all`      — platform super-admin (owner of the internal tenant). It
 *   administers every tenant by design and needs the unfiltered inventory to
 *   run the pack-management tools; gating it out would be a false denial, not
 *   added safety.
 *
 * ONE scope decides listing and usability alike. Splitting them is what made
 * the private-pack invariant a lie once already: the avatar read routes were
 * scoped while `isAllowedAvatarId` still accepted an avatar out of ANY
 * registered pack, so a foreign tenant's user could not see the pack but could
 * still wear — and broadcast — its avatars. The AssetPack side has the exact
 * same pair (`GET /asset-packs` vs. the `assetPackUuid` check on object
 * placement in api/routes/mapObjects.ts), which is why both pack kinds now
 * share this single type and resolver rather than each carrying their own.
 */
export type PackScope = { kind: 'catalog' } | { kind: 'tenant'; tenantId: string } | { kind: 'all' };

/** The fail-closed default: catalog packs only. */
export const CATALOG_SCOPE: PackScope = { kind: 'catalog' };

/** Scope for a proven tenant binding; falls back to catalog when absent. */
export function tenantScope(tenantId: string | null | undefined): PackScope {
  return tenantId ? { kind: 'tenant', tenantId } : CATALOG_SCOPE;
}

/**
 * The scope as a plain `tenantId` predicate. Both pack models carry the same
 * nullable `tenantId` column, so the filter is written once here and only the
 * Prisma type differs between the two exported wrappers below.
 *
 * Returns `{}` for the super-admin scope, so it composes with an id/uuid
 * predicate via spread in every caller.
 */
function packScopeWhere(scope: PackScope): { tenantId?: string | null; OR?: Array<{ tenantId: string | null }> } {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'tenant':
      return { OR: [{ tenantId: null }, { tenantId: scope.tenantId }] };
    case 'catalog':
      return { tenantId: null };
  }
}

/** The scope as a Prisma filter on AvatarPack. */
export function avatarPackScopeWhere(scope: PackScope): Prisma.AvatarPackWhereInput {
  return packScopeWhere(scope);
}

/** The scope as a Prisma filter on AssetPack. */
export function assetPackScopeWhere(scope: PackScope): Prisma.AssetPackWhereInput {
  return packScopeWhere(scope);
}

/**
 * The scope as a Prisma filter on CustomAvatar — or `null` for "this caller may
 * see no custom avatar at all".
 *
 * CustomAvatar deliberately does NOT reuse `packScopeWhere`, because a NULL
 * `tenantId` means the OPPOSITE of what it means on a pack. On AvatarPack and
 * AssetPack, NULL is the catalog marker: shipped with the platform, visible to
 * every tenant. On CustomAvatar it is not a marker at all — the column is
 * written from the composing session's PROVEN tenant (api/routes/meAvatar.ts
 * `provenComposeTenant`, which refuses the write rather than stamping NULL), so
 * NULL means the row could never be attributed to a tenant: a legacy row from
 * before the column existed, or one written before that check existed.
 * Treating those as catalog would make every
 * unattributed avatar world-readable, which is exactly the cross-tenant leak
 * this filter exists to close. Unattributed therefore resolves for NOBODY.
 * The owner still reaches their own row through the userId-scoped routes
 * (`GET /me/avatar/custom`, `POST /me/avatar/compose`), and re-saving stamps a
 * tenant, so the row heals itself the next time the editor is used.
 *
 * The catalog scope answers `null` rather than `{}` for the same reason there
 * is no such thing as a catalog custom avatar: a caller who has proven no
 * tenant may resolve none, while an empty `where` would return ALL of them —
 * the exact shape of the leak. Returning `null` instead of an "impossible"
 * predicate forces every caller to branch on the case rather than silently
 * spread an object that happens to match everything.
 *
 * Rationale for the tenant rule itself: a custom avatar exists so that the
 * people sharing a world with its owner can draw the figure. Everyone in that
 * world belongs to the owner's tenant, so tenant membership is exactly the
 * legitimate audience — nothing wider is needed, and anything wider has already
 * proven to be a leak.
 */
export function customAvatarScopeWhere(scope: PackScope): Prisma.CustomAvatarWhereInput | null {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'catalog':
      return null;
  }
}
