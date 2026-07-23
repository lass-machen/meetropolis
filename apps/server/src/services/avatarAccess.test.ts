/**
 * Tests for the avatar-id allow-list — the authoritative check reused by
 * avatar_change, PATCH /me/avatar and onboarding-complete.
 *
 * Two contracts:
 * 1. Existence. Only an id that resolves to something real is wearable; a
 *    free-form string is rejected.
 * 2. OWNERSHIP. A pack carrying a `tenantId` is private to that tenant and must
 *    be unwearable for everybody else — the check that makes the schema's
 *    "never listable, never wearable" invariant true rather than aspirational.
 *    Regression guard for real tenants: a member of the OWNING tenant keeps
 *    their pack avatars.
 *
 * Contract 2 covers CUSTOM avatars as well. They used to be exempt ("visibility
 * is global anyway"), which stopped being true when POST /avatars/resolve was
 * tenant-scoped; an unfiltered lookup here would have left an existence oracle
 * over `PATCH /me/avatar`. The custom cases below pin the scoped lookup.
 */
import { describe, it, expect, vi } from 'vitest';
import { isAllowedAvatarId } from './avatarAccess.js';
import { CATALOG_SCOPE, tenantScope, type PackScope } from './packScope.js';
import type { PrismaClient } from '../generated/prisma/index.js';

const TENANT_LM = 'tenant-lm';
const TENANT_OTHER = 'tenant-other';
const ALL_SCOPE: PackScope = { kind: 'all' };

interface PackRow {
  uuid: string;
  tenantId: string | null;
  avatars: Array<{ key: string }>;
}

/** One catalog pack and one private pack, mirroring production after the
 * cutover: `default-characters` global, the internal 24-avatar pack owned by
 * the internal workspace. */
const PACKS: readonly PackRow[] = [
  { uuid: 'catalog-extras', tenantId: null, avatars: [{ key: 'extra-one' }] },
  {
    uuid: 'lass-machen-avatar-pack',
    tenantId: TENANT_LM,
    avatars: [{ key: 'old-man' }, { key: 'young-woman' }],
  },
];

/** The where shapes `isAllowedAvatarId` builds — nothing else is supported. */
interface PackWhere {
  uuid: string;
  tenantId?: string | null;
  OR?: Array<{ tenantId: string | null }>;
}

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (row.uuid !== where.uuid) return false;
  if (where.OR) return where.OR.some((clause) => clause.tenantId === row.tenantId);
  if (where.tenantId !== undefined) return row.tenantId === where.tenantId;
  return true;
}

/** A custom avatar and the tenant it was composed in (null = unattributed). */
interface CustomRow {
  uuid: string;
  tenantId: string | null;
}

function makePrisma(customAvatars: readonly CustomRow[] = []): PrismaClient {
  return {
    customAvatar: {
      // findFirst only: a findUnique({ uuid }) would bypass the tenant filter,
      // and the double deliberately does not offer one.
      findFirst: vi.fn(({ where }: { where: { uuid: string; tenantId?: string } }) =>
        Promise.resolve(
          customAvatars.find(
            (row) => row.uuid === where.uuid && (where.tenantId === undefined || row.tenantId === where.tenantId),
          ) ?? null,
        ),
      ),
    },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(PACKS.find((row) => matchesWhere(row, where)) ?? null),
      ),
    },
  } as unknown as PrismaClient;
}

describe('isAllowedAvatarId — existence', () => {
  it('accepts an avatar from a catalog pack in every scope', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'catalog-extras:extra-one', CATALOG_SCOPE)).toBe(true);
    expect(await isAllowedAvatarId(prisma, 'catalog-extras:extra-one', tenantScope(TENANT_OTHER))).toBe(true);
    // Only unresolvable ids are rejected.
    expect(await isAllowedAvatarId(prisma, 'catalog-extras:does-not-exist', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, 'no-such-pack:extra-one', CATALOG_SCOPE)).toBe(false);
  });

  it('accepts an existing custom avatar of the OWN tenant, rejects a non-existent one', async () => {
    const prisma = makePrisma([
      { uuid: 'mine', tenantId: TENANT_LM },
      { uuid: 'theirs', tenantId: TENANT_OTHER },
    ]);
    expect(await isAllowedAvatarId(prisma, 'custom:mine', tenantScope(TENANT_LM))).toBe(true);
    expect(await isAllowedAvatarId(prisma, 'custom:ghost', tenantScope(TENANT_LM))).toBe(false);
  });

  it('allows built-in default-characters ids and rejects unknown default keys', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'default-characters:business_man', CATALOG_SCOPE)).toBe(true);
    expect(await isAllowedAvatarId(prisma, 'default-characters:not_a_default', CATALOG_SCOPE)).toBe(false);
  });

  it('rejects free-form / malformed ids', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'nocolon', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, ':nopack', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, 'pack:', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, 'custom:', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, 'totally-made-up-string', CATALOG_SCOPE)).toBe(false);
  });
});

describe('isAllowedAvatarId — private-pack ownership', () => {
  it('lets a member of the OWNING tenant wear its private pack (real-tenant regression guard)', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', tenantScope(TENANT_LM))).toBe(true);
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:young-woman', tenantScope(TENANT_LM))).toBe(true);
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:does-not-exist', tenantScope(TENANT_LM))).toBe(
      false,
    );
  });

  it('refuses a foreign tenant an avatar out of a private pack', async () => {
    // The exact escalation the scope closes: the pack is invisible in
    // GET /avatar-packs for this tenant, so wearing it must fail too —
    // otherwise the id is persisted and broadcast to the whole room.
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', tenantScope(TENANT_OTHER))).toBe(false);
  });

  it('refuses an unbound caller (catalog scope) an avatar out of a private pack', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', CATALOG_SCOPE)).toBe(false);
    // An absent / unproven tenant collapses to catalog scope, fail-closed.
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', tenantScope(null))).toBe(false);
  });

  it('lets the platform super-admin scope reach every pack', async () => {
    const prisma = makePrisma();
    expect(await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', ALL_SCOPE)).toBe(true);
  });

  it('refuses a foreign tenant a custom avatar (closes the existence oracle)', async () => {
    // Without the scope this branch answered "does this uuid exist?" to anyone,
    // so a foreign tenant could probe uuids through PATCH /me/avatar.
    const prisma = makePrisma([{ uuid: 'theirs', tenantId: TENANT_LM }]);
    expect(await isAllowedAvatarId(prisma, 'custom:theirs', tenantScope(TENANT_OTHER))).toBe(false);
    // Indistinguishable from a uuid that does not exist at all.
    expect(await isAllowedAvatarId(prisma, 'custom:ghost', tenantScope(TENANT_OTHER))).toBe(false);
  });

  it('refuses an unbound caller (catalog scope) every custom avatar', async () => {
    // There is no catalog custom avatar, so "nothing proven" means nothing at
    // all — including a legacy row whose tenantId was never stamped.
    const prisma = makePrisma([
      { uuid: 'mine', tenantId: TENANT_LM },
      { uuid: 'unattributed', tenantId: null },
    ]);
    expect(await isAllowedAvatarId(prisma, 'custom:mine', CATALOG_SCOPE)).toBe(false);
    expect(await isAllowedAvatarId(prisma, 'custom:unattributed', CATALOG_SCOPE)).toBe(false);
    // A NULL tenantId is unattributable, never "visible to everyone".
    expect(await isAllowedAvatarId(prisma, 'custom:unattributed', tenantScope(TENANT_LM))).toBe(false);
  });

  it('lets the platform super-admin scope reach every custom avatar', async () => {
    const prisma = makePrisma([{ uuid: 'theirs', tenantId: TENANT_LM }]);
    expect(await isAllowedAvatarId(prisma, 'custom:theirs', ALL_SCOPE)).toBe(true);
  });

  it('resolves custom avatars only through the scoped lookup', async () => {
    const prisma = makePrisma([{ uuid: 'theirs', tenantId: TENANT_LM }]);
    await isAllowedAvatarId(prisma, 'custom:theirs', tenantScope(TENANT_OTHER));
    expect(prisma.customAvatar.findFirst).toHaveBeenCalledWith({
      where: { uuid: 'theirs', tenantId: TENANT_OTHER },
      select: { uuid: true },
    });
  });

  it('does not even query for a custom avatar when nothing is proven', async () => {
    const prisma = makePrisma([{ uuid: 'theirs', tenantId: TENANT_LM }]);
    expect(await isAllowedAvatarId(prisma, 'custom:theirs', CATALOG_SCOPE)).toBe(false);
    expect(prisma.customAvatar.findFirst).not.toHaveBeenCalled();
  });

  it('resolves packs only through the scoped lookup', async () => {
    // A findUnique({ uuid }) would bypass the ownership filter entirely; the
    // double does not even provide one, so this pins the scoped delegate as the
    // only path taken.
    const prisma = makePrisma();
    await isAllowedAvatarId(prisma, 'lass-machen-avatar-pack:old-man', tenantScope(TENANT_OTHER));
    expect(prisma.avatarPack.findFirst).toHaveBeenCalledWith({
      where: { uuid: 'lass-machen-avatar-pack', OR: [{ tenantId: null }, { tenantId: TENANT_OTHER }] },
      select: { avatars: true },
    });
  });
});
