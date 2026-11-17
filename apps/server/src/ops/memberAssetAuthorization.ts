/**
 * Member authorization for protected files served under `/packs/*` and
 * `/npc-media/*` (T4b/T5 file protection).
 *
 * The static routes stay reachable so the editor keeps working, but this
 * gate decides per file whether the caller may receive it. Identity comes
 * from a freshly validated tenant session on every call — no cache, no
 * API-token path — and the file's owning row must then be visible inside
 * the caller's tenant pack scope. Anything else is `not_found` (never
 * `forbidden`, so pack UUIDs are not enumerable). Database errors propagate
 * to the caller, which answers 503. Catalogue merchandise needs an active
 * grant, except the exact published preview file.
 */
import type { PrismaClient } from '../generated/prisma/index.js';
import { validateTenantSessionFresh } from '../api/utils/sessionAuth.js';
import {
  assetPackScopeWhere,
  avatarPackScopeWhere,
  customAvatarScopeWhere,
  resolveTenantPackScope,
} from '../services/packScope.js';
import { logger } from '../logger.js';
import { getTenancyModule, type MemberPackByteAccess, type PackKind } from '../tenancyLoader.js';
import type { MemberAssetTarget } from './memberAssetPath.js';

export type MemberAssetDecision = 'allowed' | 'unauthenticated' | 'forbidden' | 'not_found';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isMemberPackByteAccess(value: unknown, packUuid: string): value is MemberPackByteAccess {
  return (
    isRecord(value) &&
    value.packUuid === packUuid &&
    typeof value.catalogued === 'boolean' &&
    typeof value.entitled === 'boolean' &&
    (typeof value.publishedPreviewRelativePath === 'string' || value.publishedPreviewRelativePath === null)
  );
}

async function memberPackBytesAllowed(
  prisma: PrismaClient,
  tenantId: string,
  packKind: PackKind,
  packUuid: string,
  relativePath: string,
): Promise<boolean> {
  const tenancy = await getTenancyModule();
  const resolver = tenancy.resolvePackVisibility;
  if (!resolver) return true;
  const result = await resolver(prisma, { purpose: 'member-bytes', tenantId, packKind, packUuid, at: new Date() });
  const access: unknown = isRecord(result) ? result.memberByteAccess : undefined;
  if (!isMemberPackByteAccess(access, packUuid)) {
    const catalogPackUuids: unknown = isRecord(result) ? result.catalogPackUuids : undefined;
    logger.warn('[Packs] enterprise resolver returned invalid memberByteAccess; falling back to the catalogue set', {
      packKind,
      tenantId,
      packUuid,
    });
    // Without a trustworthy catalogue every pack counts as merchandise.
    if (!Array.isArray(catalogPackUuids) || !catalogPackUuids.every((uuid) => typeof uuid === 'string')) return false;
    return !catalogPackUuids.includes(packUuid);
  }
  if (!access.catalogued) return true;
  if (access.entitled) return true;
  const preview = access.publishedPreviewRelativePath;
  if (typeof preview !== 'string') return false;
  const expected = packKind === 'asset' ? `${packUuid}/${preview}` : `avatars/${packUuid}/${preview}`;
  return relativePath === expected;
}

export async function authorizeMemberAsset(
  prisma: PrismaClient,
  input: { rawToken: string | null; tenantId: string | null; target: MemberAssetTarget },
): Promise<MemberAssetDecision> {
  if (!input.rawToken) return 'unauthenticated';
  if (!input.tenantId) return 'forbidden';
  const session = await validateTenantSessionFresh(prisma, input.rawToken, input.tenantId);
  if (session.status === 'unauthenticated') return 'unauthenticated';
  if (session.status === 'forbidden') return 'forbidden';
  switch (input.target.kind) {
    case 'asset-pack': {
      const scope = await resolveTenantPackScope(prisma, input.tenantId, 'asset');
      const row = await prisma.assetPack.findFirst({
        where: { AND: [{ uuid: input.target.packUuid }, assetPackScopeWhere(scope)] },
        select: { id: true },
      });
      if (!row) return 'not_found';
      return (await memberPackBytesAllowed(
        prisma,
        input.tenantId,
        'asset',
        input.target.packUuid,
        input.target.relativePath,
      ))
        ? 'allowed'
        : 'not_found';
    }
    case 'avatar-pack': {
      const scope = await resolveTenantPackScope(prisma, input.tenantId, 'avatar');
      const row = await prisma.avatarPack.findFirst({
        where: { AND: [{ uuid: input.target.packUuid }, avatarPackScopeWhere(scope)] },
        select: { id: true },
      });
      if (!row) return 'not_found';
      return (await memberPackBytesAllowed(
        prisma,
        input.tenantId,
        'avatar',
        input.target.packUuid,
        input.target.relativePath,
      ))
        ? 'allowed'
        : 'not_found';
    }
    case 'custom-avatar': {
      const scope = await resolveTenantPackScope(prisma, input.tenantId, 'avatar');
      const scopeWhere = customAvatarScopeWhere(scope);
      if (scopeWhere === null) return 'not_found';
      const row = await prisma.customAvatar.findFirst({
        where: { AND: [{ uuid: input.target.avatarUuid }, scopeWhere] },
        select: { spriteUrl: true, previewUrl: true },
      });
      if (!row) return 'not_found';
      const stored = input.target.variant === 'sprite' ? row.spriteUrl : row.previewUrl;
      return stored === `/packs/${input.target.relativePath}` ? 'allowed' : 'not_found';
    }
    case 'npc-media': {
      const row = await prisma.npcMediaFile.findFirst({
        where: { storagePath: input.target.storagePath, npc: { tenantId: input.tenantId } },
        select: { id: true },
      });
      return row ? 'allowed' : 'not_found';
    }
  }
}
