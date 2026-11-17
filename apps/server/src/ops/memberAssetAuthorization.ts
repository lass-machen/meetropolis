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
 * to the caller, which answers 503.
 */
import type { PrismaClient } from '../generated/prisma/index.js';
import { validateTenantSessionFresh } from '../api/utils/sessionAuth.js';
import {
  assetPackScopeWhere,
  avatarPackScopeWhere,
  customAvatarScopeWhere,
  resolveTenantPackScope,
} from '../services/packScope.js';
import type { MemberAssetTarget } from './memberAssetPath.js';

export type MemberAssetDecision = 'allowed' | 'unauthenticated' | 'forbidden' | 'not_found';

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
      return row ? 'allowed' : 'not_found';
    }
    case 'avatar-pack': {
      const scope = await resolveTenantPackScope(prisma, input.tenantId, 'avatar');
      const row = await prisma.avatarPack.findFirst({
        where: { AND: [{ uuid: input.target.packUuid }, avatarPackScopeWhere(scope)] },
        select: { id: true },
      });
      return row ? 'allowed' : 'not_found';
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
