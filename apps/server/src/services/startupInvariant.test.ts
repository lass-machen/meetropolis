import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/index.js';
import { loadTenancyModule } from '../tenancyLoader.js';
import {
  assertBaseAvatarAvailable,
  BASE_AVATAR_KEY,
  BASE_AVATAR_PACK_UUID,
  listenAfterStartupChecks,
} from './startupInvariant.js';

function prismaWithPack(avatars: unknown, visible = true): Prisma.TransactionClient {
  return {
    avatarPack: {
      findFirst: vi.fn(() => Promise.resolve(visible ? { avatars } : null)),
    },
  } as Prisma.TransactionClient;
}

describe('base-avatar startup invariant', () => {
  it('accepts the seeded base pack with its expected avatar key in public scope', async () => {
    const prisma = prismaWithPack([{ key: BASE_AVATAR_KEY }]);
    await expect(
      assertBaseAvatarAvailable(prisma, () => Promise.resolve({ kind: 'catalog' })),
    ).resolves.toBeUndefined();
    expect(prisma.avatarPack.findFirst).toHaveBeenCalledWith({
      where: { uuid: BASE_AVATAR_PACK_UUID, tenantId: null },
      select: { avatars: true },
    });
  });

  it.each([
    ['missing pack', null, false],
    ['missing avatar key', [{ key: 'someone_else' }], true],
  ])('blocks startup for a %s with seed guidance', async (_name, avatars, visible) => {
    const prisma = prismaWithPack(avatars, visible);
    await expect(assertBaseAvatarAvailable(prisma, () => Promise.resolve({ kind: 'catalog' }))).rejects.toThrow(
      'Run "npx prisma db seed --schema=apps/server/prisma/schema.prisma" successfully',
    );
  });

  it('checks the resolved public scope instead of bypassing pack visibility', async () => {
    const prisma = prismaWithPack([{ key: BASE_AVATAR_KEY }], false);
    await expect(
      assertBaseAvatarAvailable(prisma, () =>
        Promise.resolve({ kind: 'catalog', blockedGlobalPackUuids: [BASE_AVATAR_PACK_UUID] }),
      ),
    ).rejects.toThrow('unavailable in the public avatar scope');
    expect(prisma.avatarPack.findFirst).toHaveBeenCalledWith({
      where: {
        uuid: BASE_AVATAR_PACK_UUID,
        AND: [{ tenantId: null }, { uuid: { notIn: [BASE_AVATAR_PACK_UUID] } }],
      },
      select: { avatars: true },
    });
  });

  it('does not listen when a module carrying both visibility hook names fails to load', async () => {
    const listen = vi.fn(() => Promise.resolve());
    const check = async (): Promise<void> => {
      await loadTenancyModule(() =>
        Promise.resolve({
          version: 1,
          isMultiTenantEnabled: () => true,
          resolvePackVisibility: () => Promise.resolve({ catalogPackUuids: [], accessiblePackUuids: [] }),
          resolveAdditionalPackUuids: () => Promise.resolve([]),
        }),
      );
    };

    await expect(listenAfterStartupChecks(check, listen)).rejects.toThrow(
      'resolveAdditionalPackUuids is no longer supported',
    );
    expect(listen).not.toHaveBeenCalled();
  });
});
