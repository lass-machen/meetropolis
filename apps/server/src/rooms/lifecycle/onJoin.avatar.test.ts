import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';
import type { WorldRoom } from '../WorldRoom.js';

const tenancy = vi.hoisted(() => ({ resolver: vi.fn(), enabled: false }));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? {
            version: 1,
            isMultiTenantEnabled: () => true,
            resolveAdditionalPackUuids: tenancy.resolver,
          }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolveJoinAppearance } from './onJoin.avatar.js';

interface AvatarPackWhere {
  uuid?: string | { notIn: string[] };
  tenantId?: string | null;
  AND?: AvatarPackWhere[];
  OR?: AvatarPackWhere[];
}

const packs = [
  { uuid: 'default-characters', tenantId: null, avatars: [{ key: 'business_man' }] },
  { uuid: 'premium', tenantId: null, avatars: [{ key: 'hero' }] },
];

function matches(row: (typeof packs)[number], where: AvatarPackWhere): boolean {
  if (typeof where.uuid === 'string' && row.uuid !== where.uuid) return false;
  if (typeof where.uuid === 'object' && where.uuid.notIn.includes(row.uuid)) return false;
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
  if (where.AND && !where.AND.every((clause) => matches(row, clause))) return false;
  if (where.OR && !where.OR.some((clause) => matches(row, clause))) return false;
  return true;
}

function makePrisma(databaseAvatarId: string | null, rejectUserLookup = false): PrismaClient {
  return {
    user: {
      findUnique: vi.fn(() =>
        rejectUserLookup
          ? Promise.reject(new Error('database unavailable'))
          : Promise.resolve({ name: 'Alice', email: 'alice@example.test', avatarId: databaseAvatarId }),
      ),
    },
    avatarPack: {
      findFirst: vi.fn(({ where }: { where: AvatarPackWhere }) =>
        Promise.resolve(packs.find((pack) => matches(pack, where)) ?? null),
      ),
    },
    customAvatar: { findFirst: vi.fn(() => Promise.resolve(null)) },
    map: { findUnique: vi.fn(() => Promise.resolve({ tenantId: 'tenant-a' })) },
  } as PrismaClient;
}

function roomWith(prisma: PrismaClient): WorldRoom {
  return { prismaForPresence: prisma, metadata: { tenant: 'tenant-a' } } as WorldRoom;
}

beforeEach(() => {
  tenancy.enabled = false;
  tenancy.resolver.mockReset();
});

function configureResolver(state: EnterprisePackResolverState): void {
  tenancy.enabled = state.hook !== 'absent';
  if (state.hook === 'reject') {
    tenancy.resolver.mockRejectedValue(new Error('catalogue unavailable'));
  } else if (state.hook === 'resolve') {
    tenancy.resolver.mockResolvedValue(state.result?.(['premium']));
  }
}

describe('resolveJoinAppearance', () => {
  it.each(ENTERPRISE_PACK_RESOLVER_STATES)('applies $name when selecting a join avatar', async (state) => {
    configureResolver(state);
    const appearance = resolveJoinAppearance(
      roomWith(makePrisma(null)),
      { avatarId: 'premium:hero' },
      'user-a',
      'tenant-a',
      'map-a',
    );

    if (state.expected === 'error') {
      await expect(appearance).rejects.toThrow();
      return;
    }
    await expect(appearance).resolves.toMatchObject({
      avatarId: state.expected === 'accessible' ? 'premium:hero' : 'default-characters:business_man',
    });
  });

  it('validates the default through the base-equipment pack after a database failure', async () => {
    const prisma = makePrisma(null, true);
    const appearance = await resolveJoinAppearance(roomWith(prisma), { name: 'Alice' }, 'user-a', 'tenant-a', 'map-a');
    expect(appearance.avatarId).toBe('default-characters:business_man');
    expect(prisma.avatarPack.findFirst).toHaveBeenCalled();
  });

  it('throws a clear error when no candidate, including the default, is allowed', async () => {
    const prisma = makePrisma(null);
    vi.mocked(prisma.avatarPack.findFirst).mockResolvedValue(null);
    await expect(resolveJoinAppearance(roomWith(prisma), {}, 'user-a', 'tenant-a', 'map-a')).rejects.toThrow(
      'No allowed avatar is available',
    );
  });

  it('uses public visibility for a token-less human even when options name a tenant', async () => {
    tenancy.enabled = true;
    tenancy.resolver.mockResolvedValue({
      catalogPackUuids: ['premium'],
      accessiblePackUuids: [],
    });
    const prisma = makePrisma(null);
    const appearance = await resolveJoinAppearance(
      roomWith(prisma),
      { tenant: 'tenant-a', avatarId: 'premium:hero' },
      'legacy-user',
      undefined,
      'map-a',
    );

    expect(appearance.avatarId).toBe('default-characters:business_man');
    expect(tenancy.resolver.mock.calls[0]?.[1]).not.toHaveProperty('tenantId');
  });

  it('resolves an NPC tenant from the server-selected map', async () => {
    tenancy.enabled = true;
    tenancy.resolver.mockResolvedValue({ catalogPackUuids: [], accessiblePackUuids: [] });
    const prisma = makePrisma(null);
    await resolveJoinAppearance(
      roomWith(prisma),
      { avatarId: 'default-characters:business_man' },
      'npc-bot',
      undefined,
      'map-a',
    );

    expect(prisma.map.findUnique).toHaveBeenCalledWith({ where: { id: 'map-a' }, select: { tenantId: true } });
    expect(tenancy.resolver).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ tenantId: 'tenant-a', packKind: 'avatar' }),
    );
  });

  it('rejects an NPC join when its map tenant cannot be resolved', async () => {
    const prisma = makePrisma(null);
    vi.mocked(prisma.map.findUnique).mockResolvedValue(null);
    await expect(
      resolveJoinAppearance(
        roomWith(prisma),
        { avatarId: 'default-characters:business_man' },
        'npc-bot',
        undefined,
        'missing-map',
      ),
    ).rejects.toThrow('Unable to resolve the NPC map tenant');
  });
});
