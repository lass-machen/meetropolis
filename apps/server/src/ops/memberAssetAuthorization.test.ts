/**
 * Member authorization for protected files served under `/packs/*` and
 * `/npc-media/*` (T4b/T5 file protection).
 *
 * `authorizeMemberAsset` decides per file whether the caller may receive it:
 * the session is validated fresh on every call, then the file's owning row
 * must be visible inside the caller's tenant pack scope. Anything else is
 * `not_found` (never `forbidden`, so pack UUIDs are not enumerable) and
 * database errors propagate to the caller for a 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMocks = vi.hoisted(() => ({ validate: vi.fn() }));

vi.mock('../api/utils/sessionAuth.js', () => ({
  validateTenantSessionFresh: sessionMocks.validate,
}));

const tenancyMocks = vi.hoisted(() => ({
  resolver: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock('../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve({ version: 1, isMultiTenantEnabled: () => false, resolvePackVisibility: tenancyMocks.resolver }),
}));

import { validateTenantSessionFresh } from '../api/utils/sessionAuth.js';
import { authorizeMemberAsset } from './memberAssetAuthorization.js';
import type { PrismaClient } from '../generated/prisma/index.js';

const TENANT = 'tenant-lm';
const FOREIGN_TENANT = 'tenant-other';

type PackRow = {
  id: number;
  uuid: string;
  tenantId: string | null;
};

type CustomAvatarRow = {
  id: number;
  uuid: string;
  tenantId: string | null;
  spriteUrl: string;
  previewUrl: string | null;
};

type MediaRow = {
  id: string;
  storagePath: string;
  tenantId: string;
};

interface Fixture {
  assetPacks: PackRow[];
  avatarPacks: PackRow[];
  customAvatars: CustomAvatarRow[];
  mediaFiles: MediaRow[];
}

type Where = Record<string, unknown>;

function valueMatches(rowValue: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object') {
    const clause = condition as { in?: unknown[]; notIn?: unknown[] };
    if (clause.notIn !== undefined) return !clause.notIn.includes(rowValue);
    if (clause.in !== undefined) return clause.in.includes(rowValue);
  }
  return rowValue === condition;
}

function matchesWhere(row: Record<string, unknown>, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Where[]).some((clause) => matchesWhere(row, clause))) return false;
    } else if (key === 'AND') {
      if (!(condition as Where[]).every((clause) => matchesWhere(row, clause))) return false;
    } else if (key === 'npc') {
      const nested = condition as { tenantId?: unknown };
      if (nested.tenantId !== undefined && row['tenantId'] !== nested.tenantId) return false;
    } else if (!valueMatches(row[key], condition)) {
      return false;
    }
  }
  return true;
}

function baseFixture(): Fixture {
  return {
    assetPacks: [
      { id: 1, uuid: 'own-pack', tenantId: TENANT },
      { id: 2, uuid: 'global-pack', tenantId: null },
      { id: 3, uuid: 'foreign-pack', tenantId: FOREIGN_TENANT },
    ],
    avatarPacks: [
      { id: 11, uuid: 'own-avatar-pack', tenantId: TENANT },
      { id: 12, uuid: 'global-avatar-pack', tenantId: null },
      { id: 13, uuid: 'foreign-avatar-pack', tenantId: FOREIGN_TENANT },
    ],
    customAvatars: [
      {
        id: 21,
        uuid: 'own-avatar',
        tenantId: TENANT,
        spriteUrl: '/packs/avatars/custom/own-avatar.png',
        previewUrl: '/packs/avatars/custom/own-avatar_p.png',
      },
      {
        id: 22,
        uuid: 'unattributed-avatar',
        tenantId: null,
        spriteUrl: '/packs/avatars/custom/unattributed-avatar.png',
        previewUrl: '/packs/avatars/custom/unattributed-avatar_p.png',
      },
      {
        id: 23,
        uuid: 'foreign-avatar',
        tenantId: FOREIGN_TENANT,
        spriteUrl: '/packs/avatars/custom/foreign-avatar.png',
        previewUrl: '/packs/avatars/custom/foreign-avatar_p.png',
      },
      {
        id: 24,
        uuid: 'no-preview-avatar',
        tenantId: TENANT,
        spriteUrl: '/packs/avatars/custom/no-preview-avatar.png',
        previewUrl: null,
      },
    ],
    mediaFiles: [
      { id: 'media-1', storagePath: 'lm/npc-1/abcd1234.png', tenantId: TENANT },
      { id: 'media-2', storagePath: 'other/npc-9/ffff5678.png', tenantId: FOREIGN_TENANT },
    ],
  };
}

function makePrisma(
  fixture: Fixture,
  failWith?: Error,
): { prisma: PrismaClient; seen: { model: string; where: unknown }[] } {
  const seen: { model: string; where: unknown }[] = [];
  function findFirst<T extends Record<string, unknown>>(model: string, rows: T[]) {
    return ({ where }: { where: Where }): Promise<T | null> => {
      if (failWith) throw failWith;
      seen.push({ model, where });
      return Promise.resolve(rows.find((row) => matchesWhere(row, where)) ?? null);
    };
  }
  const prisma = {
    assetPack: { findFirst: vi.fn(findFirst('assetPack', fixture.assetPacks)) },
    avatarPack: { findFirst: vi.fn(findFirst('avatarPack', fixture.avatarPacks)) },
    customAvatar: { findFirst: vi.fn(findFirst('customAvatar', fixture.customAvatars)) },
    npcMediaFile: { findFirst: vi.fn(findFirst('npcMediaFile', fixture.mediaFiles)) },
  } as unknown as PrismaClient;
  return { prisma, seen };
}

function allowSession(access: 'member' | 'platform_operator' = 'member'): void {
  vi.mocked(validateTenantSessionFresh).mockResolvedValue({
    status: 'allowed',
    userId: 'user-1',
    sessionId: 'sess-1',
    tenantId: TENANT,
    access,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tenancyMocks.resolver = undefined;
});

describe('authorizeMemberAsset: identity first', () => {
  it('returns unauthenticated without a token and touches no query', async () => {
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: null,
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('unauthenticated');
    expect(sessionMocks.validate).not.toHaveBeenCalled();
    expect(prisma.assetPack.findFirst).not.toHaveBeenCalled();
  });

  it('returns forbidden without a tenant', async () => {
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: null,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('forbidden');
    expect(sessionMocks.validate).not.toHaveBeenCalled();
    expect(prisma.assetPack.findFirst).not.toHaveBeenCalled();
  });

  it('returns unauthenticated when the session is unknown', async () => {
    const { prisma } = makePrisma(baseFixture());
    vi.mocked(validateTenantSessionFresh).mockResolvedValue({ status: 'unauthenticated' });
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'stale-token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('unauthenticated');
    expect(prisma.assetPack.findFirst).not.toHaveBeenCalled();
  });

  it('returns forbidden when the membership lapsed', async () => {
    const { prisma } = makePrisma(baseFixture());
    vi.mocked(validateTenantSessionFresh).mockResolvedValue({
      status: 'forbidden',
      reason: 'membership_unavailable',
    });
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('forbidden');
    expect(prisma.assetPack.findFirst).not.toHaveBeenCalled();
  });
});

describe('authorizeMemberAsset: asset packs', () => {
  it('allows a member the own tenant pack', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('allowed');
  });

  it('allows a global pack (tenantId null)', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('allowed');
  });

  it('hides a foreign tenant pack as not_found with the tenant condition in the where', async () => {
    allowSession();
    const { prisma, seen } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'foreign-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('not_found');
    expect(prisma.assetPack.findFirst).toHaveBeenCalledTimes(1);
    const assetWhere = seen.find((call) => call.model === 'assetPack')?.where;
    expect(JSON.stringify(assetWhere)).toContain(TENANT);
    expect(JSON.stringify(assetWhere)).toContain('foreign-pack');
  });

  it('scopes a nested generation file by its pack: own allowed, foreign not_found', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const own = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'own-pack/generations/g1/desk.png' },
    });
    const foreign = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'foreign-pack', relativePath: 'foreign-pack/generations/g1/desk.png' },
    });
    expect(own).toBe('allowed');
    expect(foreign).toBe('not_found');
  });

  it('allows a platform operator like a member', async () => {
    allowSession('platform_operator');
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
    });
    expect(decision).toBe('allowed');
  });
});

describe('authorizeMemberAsset: avatar packs', () => {
  it('allows the own tenant and the global avatar pack, hides the foreign one', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const own = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'avatar-pack', packUuid: 'own-avatar-pack', relativePath: 'a1.png' },
    });
    const global = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'avatar-pack', packUuid: 'global-avatar-pack', relativePath: 'a2.png' },
    });
    const foreign = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'avatar-pack', packUuid: 'foreign-avatar-pack', relativePath: 'a3.png' },
    });
    expect(own).toBe('allowed');
    expect(global).toBe('allowed');
    expect(foreign).toBe('not_found');
  });
});

describe('authorizeMemberAsset: custom avatars', () => {
  it('allows sprite and preview of the own tenant avatar', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const sprite = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'custom-avatar',
        avatarUuid: 'own-avatar',
        variant: 'sprite',
        relativePath: 'avatars/custom/own-avatar.png',
      },
    });
    const preview = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'custom-avatar',
        avatarUuid: 'own-avatar',
        variant: 'preview',
        relativePath: 'avatars/custom/own-avatar_p.png',
      },
    });
    expect(sprite).toBe('allowed');
    expect(preview).toBe('allowed');
  });

  it('hides an unattributed avatar (tenantId null) as not_found', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'custom-avatar',
        avatarUuid: 'unattributed-avatar',
        variant: 'sprite',
        relativePath: 'avatars/custom/unattributed-avatar.png',
      },
    });
    expect(decision).toBe('not_found');
  });

  it('hides a foreign tenant avatar as not_found', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'custom-avatar',
        avatarUuid: 'foreign-avatar',
        variant: 'sprite',
        relativePath: 'avatars/custom/foreign-avatar.png',
      },
    });
    expect(decision).toBe('not_found');
  });

  it('returns not_found for a preview whose stored URL is null', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'custom-avatar',
        avatarUuid: 'no-preview-avatar',
        variant: 'preview',
        relativePath: 'avatars/custom/no-preview-avatar_p.png',
      },
    });
    expect(decision).toBe('not_found');
  });
});

describe('authorizeMemberAsset: npc media', () => {
  it('allows the own tenant file and hides the foreign one with npc.tenantId in the where', async () => {
    allowSession();
    const { prisma, seen } = makePrisma(baseFixture());
    const own = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'npc-media', storagePath: 'lm/npc-1/abcd1234.png', relativePath: 'lm/npc-1/abcd1234.png' },
    });
    const foreign = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'npc-media', storagePath: 'other/npc-9/ffff5678.png', relativePath: 'other/npc-9/ffff5678.png' },
    });
    expect(own).toBe('allowed');
    expect(foreign).toBe('not_found');
    const mediaWhere = seen.find((call) => call.model === 'npcMediaFile')?.where;
    expect(JSON.stringify(mediaWhere)).toContain(TENANT);
  });
});

describe('authorizeMemberAsset: catalogue merchandise bytes', () => {
  function stubMemberAccess(access: {
    packUuid: string;
    catalogued: boolean;
    entitled: boolean;
    publishedPreviewRelativePath: string | null;
  }) {
    const resolver = vi.fn(() =>
      Promise.resolve({
        catalogPackUuids: access.catalogued ? [access.packUuid] : [],
        accessiblePackUuids: access.catalogued ? [access.packUuid] : [],
        memberByteAccess: access,
      }),
    );
    tenancyMocks.resolver = resolver;
    return resolver;
  }

  it('hides a catalogued pack file that is not the preview when the tenant is not entitled', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: true,
      entitled: false,
      publishedPreviewRelativePath: 'preview.png',
    });
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    expect(decision).toBe('not_found');
  });

  it('allows exactly the published preview of a catalogued pack when the tenant is not entitled', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: true,
      entitled: false,
      publishedPreviewRelativePath: 'preview.png',
    });
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/preview.png' },
    });
    expect(decision).toBe('allowed');
  });

  it('allows any file of a catalogued pack when the tenant is entitled', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: true,
      entitled: true,
      publishedPreviewRelativePath: 'preview.png',
    });
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    expect(decision).toBe('allowed');
  });

  it('allows any file of an uncatalogued pack', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: false,
      entitled: false,
      publishedPreviewRelativePath: null,
    });
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    expect(decision).toBe('allowed');
  });

  it('hides a nested file that only shares the preview file name', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: true,
      entitled: false,
      publishedPreviewRelativePath: 'preview.png',
    });
    const { prisma } = makePrisma(baseFixture());
    const decision = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/sub/preview.png' },
    });
    expect(decision).toBe('not_found');
  });

  it('falls back to the catalogue set when memberByteAccess is missing', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture());
    tenancyMocks.resolver = vi.fn(() =>
      Promise.resolve({
        catalogPackUuids: ['global-pack'],
        accessiblePackUuids: ['global-pack'],
      }),
    );
    const catalogued = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    tenancyMocks.resolver = vi.fn(() =>
      Promise.resolve({
        catalogPackUuids: [],
        accessiblePackUuids: [],
      }),
    );
    const uncatalogued = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    expect(catalogued).toBe('not_found');
    expect(uncatalogued).toBe('allowed');
  });

  it('allows only the published preview of a catalogued avatar pack when the tenant is not entitled', async () => {
    allowSession();
    stubMemberAccess({
      packUuid: 'global-avatar-pack',
      catalogued: true,
      entitled: false,
      publishedPreviewRelativePath: 'preview.png',
    });
    const { prisma } = makePrisma(baseFixture());
    const preview = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'avatar-pack',
        packUuid: 'global-avatar-pack',
        relativePath: 'avatars/global-avatar-pack/preview.png',
      },
    });
    const other = await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: {
        kind: 'avatar-pack',
        packUuid: 'global-avatar-pack',
        relativePath: 'avatars/global-avatar-pack/other.png',
      },
    });
    expect(preview).toBe('allowed');
    expect(other).toBe('not_found');
  });

  it('rethrows a resolver failure instead of deciding', async () => {
    allowSession();
    tenancyMocks.resolver = vi.fn(() => Promise.reject(new Error('catalogue unavailable')));
    const { prisma } = makePrisma(baseFixture());
    await expect(
      authorizeMemberAsset(prisma, {
        rawToken: 'token',
        tenantId: TENANT,
        target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
      }),
    ).rejects.toThrow('catalogue unavailable');
  });

  it('asks the resolver for member bytes with the tenant, pack kind and pack uuid', async () => {
    allowSession();
    const resolver = stubMemberAccess({
      packUuid: 'global-pack',
      catalogued: false,
      entitled: false,
      publishedPreviewRelativePath: null,
    });
    const { prisma } = makePrisma(baseFixture());
    await authorizeMemberAsset(prisma, {
      rawToken: 'token',
      tenantId: TENANT,
      target: { kind: 'asset-pack', packUuid: 'global-pack', relativePath: 'global-pack/desk.png' },
    });
    expect(resolver).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purpose: 'member-bytes',
        tenantId: TENANT,
        packKind: 'asset',
        packUuid: 'global-pack',
      }),
    );
  });
});

describe('authorizeMemberAsset: database errors', () => {
  it('rethrows a database failure instead of deciding', async () => {
    allowSession();
    const { prisma } = makePrisma(baseFixture(), new Error('connection refused'));
    await expect(
      authorizeMemberAsset(prisma, {
        rawToken: 'token',
        tenantId: TENANT,
        target: { kind: 'asset-pack', packUuid: 'own-pack', relativePath: 'desk.png' },
      }),
    ).rejects.toThrow('connection refused');
  });
});
