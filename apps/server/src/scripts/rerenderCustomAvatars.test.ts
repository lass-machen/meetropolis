import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/index.js';
import { rerenderCustomAvatars } from './rerenderCustomAvatars.js';

const packsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-rerender-'));
const oldUuid = '11111111-2222-4333-8444-555555555555';
const legacyConfig = {
  skin: 'light',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'shirt_white',
  pants: 'dark',
  shoes: 'black',
  proportion: 'schlank',
};

function makePrisma() {
  let row = {
    id: 1,
    uuid: oldUuid,
    userId: 'u1',
    tenantId: 't1',
    config: legacyConfig,
    spriteUrl: `/packs/avatars/custom/${oldUuid}.png`,
    previewUrl: `/packs/avatars/custom/${oldUuid}_p.png`,
    configHash: 'v5-hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const updateAvatar = vi.fn(({ data }: { data: Partial<typeof row> }) => {
    row = { ...row, ...data };
    return Promise.resolve(row);
  });
  const updateUser = vi.fn(() => Promise.resolve({}));
  const prisma = {
    customAvatar: {
      findMany: vi.fn(() => Promise.resolve([row])),
      update: updateAvatar,
    },
    user: { update: updateUser },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  } as unknown as PrismaClient;
  return { prisma, updateAvatar, updateUser, row: () => row };
}

afterEach(() => fs.rmSync(packsDir, { recursive: true, force: true }));

describe('rerenderCustomAvatars', () => {
  it('is dry-run by default behavior: reports without writing', async () => {
    const { prisma, updateAvatar } = makePrisma();
    const summary = await rerenderCustomAvatars(prisma, packsDir, false, vi.fn());
    expect(summary).toEqual({ unchanged: 0, pending: 1, updated: 0, invalid: 0 });
    expect(updateAvatar).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(packsDir, 'avatars', 'custom'))).toBe(false);
  });

  it('renders once, keeps the old identity untouched and is idempotent afterwards', async () => {
    const { prisma, updateAvatar, updateUser, row } = makePrisma();
    const first = await rerenderCustomAvatars(prisma, packsDir, true, vi.fn());
    expect(first).toEqual({ unchanged: 0, pending: 1, updated: 1, invalid: 0 });
    expect(row().uuid).not.toBe(oldUuid);
    expect(row().config).toMatchObject({ face: 'ruhig', proportion: 'kompakt' });
    expect(updateAvatar).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatarId: `custom:${row().uuid}` },
    });
    expect(fs.existsSync(path.join(packsDir, 'avatars', 'custom', `${row().uuid}.png`))).toBe(true);

    const second = await rerenderCustomAvatars(prisma, packsDir, true, vi.fn());
    expect(second).toEqual({ unchanged: 1, pending: 0, updated: 0, invalid: 0 });
    expect(updateAvatar).toHaveBeenCalledOnce();
  });
});
