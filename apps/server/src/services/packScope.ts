import type { Prisma } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { getTenancyModule, type PackKind } from '../tenancyLoader.js';

/**
 * Which packs a caller may see AND use. ONE scope type for BOTH pack kinds
 * (AvatarPack and AssetPack). The proven tenant establishes ownership; the
 * pack kind only lets the optional enterprise boundary return the matching
 * global pack UUIDs.
 *
 * `AvatarPack.tenantId` / `AssetPack.tenantId` are the ownership markers (see
 * schema.prisma): NULL means global, while a set value means the pack belongs
 * to exactly one tenant. Global base equipment remains visible unless an
 * enterprise catalogue explicitly classifies the pack as merchandise.
 *
 * The three cases:
 * - `catalog`  — nothing proven about the caller. The fail-closed default: an
 *   anonymous request, a caller whose tenant could not be established, or a
 *   membership lookup that missed or errored.
 * - `tenant`   — the caller has a PROVEN binding to that tenant (a membership
 *   row, or a JWT-verified `tid` on the world-join path). Without an enterprise
 *   resolver this means global packs plus that tenant's own private packs. A
 *   present resolver may exclude catalogued-but-inaccessible global UUIDs;
 *   tenant-owned packs and uncatalogued global base equipment remain.
 * - `all`      — platform super-admin (owner of the internal tenant). It
 *   administers every tenant by design. Pack-specific collection filters such
 *   as `AssetPack.archived = false` still compose on top of this ownership
 *   scope.
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
export type PackScope =
  | { kind: 'catalog'; blockedGlobalPackUuids?: readonly string[] }
  | { kind: 'tenant'; tenantId: string; blockedGlobalPackUuids?: readonly string[] }
  | { kind: 'all' };

/** The unchanged OSS public scope: every global pack. */
export const CATALOG_SCOPE: PackScope = { kind: 'catalog' };

/** Scope for a proven tenant binding; falls back to catalog when absent. */
export function tenantScope(
  tenantId: string | null | undefined,
  blockedGlobalPackUuids?: readonly string[],
): PackScope {
  if (!tenantId) return CATALOG_SCOPE;
  if (blockedGlobalPackUuids === undefined) return { kind: 'tenant', tenantId };
  return { kind: 'tenant', tenantId, blockedGlobalPackUuids: [...new Set(blockedGlobalPackUuids)] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readUuidArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const entries: unknown[] = value;
  if (!entries.every((uuid): uuid is string => typeof uuid === 'string' && uuid.length > 0)) return null;
  return [...new Set(entries)];
}

async function resolveBlockedGlobalPackUuids(
  prisma: Prisma.TransactionClient,
  tenantId: string | undefined,
  packKind: PackKind,
): Promise<readonly string[] | undefined> {
  const tenancy = await getTenancyModule();
  const resolver = tenancy.resolvePackVisibility;
  if (!resolver) return undefined;

  const request = tenantId ? { tenantId, packKind, at: new Date() } : { packKind, at: new Date() };
  const result: unknown = await resolver(prisma, request);
  const catalogPackUuids = isRecord(result) ? readUuidArray(result.catalogPackUuids) : null;
  if (catalogPackUuids === null) {
    throw new Error(
      '@meetropolis/tenancy resolvePackVisibility returned an invalid catalogPackUuids value; refusing to resolve pack visibility',
    );
  }

  const accessibleValue = isRecord(result) ? result.accessiblePackUuids : undefined;
  const accessiblePackUuids = readUuidArray(accessibleValue);
  if (accessiblePackUuids === null) {
    // The catalogue boundary is still trustworthy. Fail closed for merchandise
    // while retaining uncatalogued base equipment.
    logger.error('[Packs] enterprise resolver returned invalid accessiblePackUuids; blocking every catalogued pack');
    return catalogPackUuids;
  }

  const catalogSet = new Set(catalogPackUuids);
  const unexpected = accessiblePackUuids.filter((uuid) => !catalogSet.has(uuid));
  if (unexpected.length > 0) {
    logger.warn('[Packs] enterprise resolver returned accessible UUIDs outside the catalogue; ignoring them', {
      packKind,
      tenantId,
      uuids: unexpected,
    });
  }
  const accessibleSet = new Set(accessiblePackUuids.filter((uuid) => catalogSet.has(uuid)));

  // Host formula: global AND (uuid NOT IN catalogue OR uuid IN accessible).
  // Expressed here as the equivalent exclusion set `catalogue - accessible`.
  // This direction makes uncatalogued global packs structural base equipment:
  // the optional module cannot remove them. Production currently has 16
  // tenants, two global asset packs, one global avatar pack, zero catalogue
  // rows and zero grants; treating all globals as merchandise would remove the
  // furniture palette and default characters from every tenant at once.
  return catalogPackUuids.filter((uuid) => !accessibleSet.has(uuid));
}

/** Resolve the public pre-login scope through the same enterprise contract. */
export async function resolvePublicPackScope(prisma: Prisma.TransactionClient, packKind: PackKind): Promise<PackScope> {
  const blockedGlobalPackUuids = await resolveBlockedGlobalPackUuids(prisma, undefined, packKind);
  return blockedGlobalPackUuids === undefined ? CATALOG_SCOPE : { kind: 'catalog', blockedGlobalPackUuids };
}

/** Resolve a proven tenant through the optional enterprise visibility hook. */
export async function resolveTenantPackScope(
  prisma: Prisma.TransactionClient,
  tenantId: string | null | undefined,
  packKind: PackKind,
): Promise<PackScope> {
  if (!tenantId) return resolvePublicPackScope(prisma, packKind);
  const blockedGlobalPackUuids = await resolveBlockedGlobalPackUuids(prisma, tenantId, packKind);
  return tenantScope(tenantId, blockedGlobalPackUuids);
}

/** Re-resolve only the mutable catalogue portion of an already proven scope. */
export function refreshPackScope(
  prisma: Prisma.TransactionClient,
  scope: PackScope,
  packKind: PackKind,
): Promise<PackScope> {
  switch (scope.kind) {
    case 'all':
      return Promise.resolve(scope);
    case 'tenant':
      return resolveTenantPackScope(prisma, scope.tenantId, packKind);
    case 'catalog':
      return resolvePublicPackScope(prisma, packKind);
  }
}

/**
 * The scope as a plain `tenantId` predicate. Both pack models carry the same
 * nullable `tenantId` column, so the filter is written once here and only the
 * Prisma type differs between the two exported wrappers below.
 *
 * Returns `{}` for the super-admin scope, so it composes with an id/uuid
 * predicate via spread in every caller.
 */
type SharedPackWhere = {
  tenantId?: string | null;
  uuid?: { notIn: string[] };
  OR?: SharedPackWhere[];
  AND?: SharedPackWhere[];
};

function globalPackWhere(blockedGlobalPackUuids: readonly string[] | undefined): SharedPackWhere {
  if (blockedGlobalPackUuids === undefined) return { tenantId: null };
  // Keep the UUID predicate nested so callers can safely compose an identity
  // predicate via object spread without one `uuid` field overwriting the other.
  return { AND: [{ tenantId: null }, { uuid: { notIn: [...blockedGlobalPackUuids] } }] };
}

function packScopeWhere(scope: PackScope): SharedPackWhere {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'tenant':
      return { OR: [{ tenantId: scope.tenantId }, globalPackWhere(scope.blockedGlobalPackUuids)] };
    case 'catalog':
      return globalPackWhere(scope.blockedGlobalPackUuids);
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
 * AssetPack, NULL is the global marker: uncatalogued base equipment is public,
 * while catalogue visibility composes on top. On CustomAvatar it is not a
 * marker at all — the column is
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
