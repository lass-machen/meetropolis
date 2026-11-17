/**
 * Studio-only DB integration for D-517 orphan cleanup reference checks.
 * Not executed in the local unit harness (vitest server project excludes
 * *.integration.test.ts). Requires a real DATABASE_URL and generated Prisma client.
 *
 * Covers: CustomAvatar.uuid and User.avatarId still block deletion of a due
 * retirement; an unreferenced due UUID is removed together with its marker.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/index.js';
import {
  CUSTOM_AVATAR_RETENTION_MS,
  customAvatarRetirementsDir,
  registerRetiredCustomAvatar,
  runCustomAvatarOrphanCleanup,
} from './customAvatarOrphanCleanup.js';
import { customAvatarDir, writeCustomAvatarFiles } from './avatarComposer.js';

const prisma = new PrismaClient();
const TAG = `orphan-cleanup-${Date.now()}`;

let packsDir: string;
let userId: string;
let tenantId: string;

function refsFromPrisma() {
  return {
    listPresentCustomAvatarUuids: async (uuids: string[]) => {
      if (uuids.length === 0) return new Set<string>();
      const rows = await prisma.customAvatar.findMany({
        where: { uuid: { in: uuids } },
        select: { uuid: true },
      });
      return new Set(rows.map((row) => row.uuid));
    },
    isActivelyReferenced: async (uuid: string) => {
      const row = await prisma.customAvatar.findFirst({
        where: { uuid },
        select: { uuid: true },
      });
      if (row) return true;
      const user = await prisma.user.findFirst({
        where: { avatarId: `custom:${uuid}` },
        select: { id: true },
      });
      return user !== null;
    },
  };
}

beforeAll(async () => {
  packsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-orphan-int-'));
  await fs.mkdir(customAvatarDir(packsDir), { recursive: true });

  const tenant = await prisma.tenant.create({
    data: { name: TAG, slug: TAG.slice(0, 40) },
  });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      email: `${TAG}@example.test`,
      name: TAG,
      passwordHash: 'x',
    },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { tenantId, userId, role: 'member' },
  });
});

afterAll(async () => {
  await prisma.customAvatar.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.membership.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.$disconnect();
  await fs.rm(packsDir, { recursive: true, force: true });
});

describe('customAvatarOrphanCleanup integration (studio)', () => {
  it('blocks deletion while CustomAvatar.uuid or User.avatarId still reference the UUID', async () => {
    const uuid = cryptoRandomUuid();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeCustomAvatarFiles(packsDir, uuid, png, png);
    await prisma.customAvatar.create({
      data: {
        userId,
        tenantId,
        uuid,
        config: {},
        spriteUrl: `/packs/avatars/custom/${uuid}.png`,
        previewUrl: `/packs/avatars/custom/${uuid}_p.png`,
        configHash: 'h1',
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { avatarId: `custom:${uuid}` },
    });

    const retiredAt = new Date('2020-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, uuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + 86_400_000);
    const result = await runCustomAvatarOrphanCleanup({
      packsDir,
      refs: refsFromPrisma(),
      now: () => now,
    });
    expect(result.removed).toEqual([]);
    await expect(fs.stat(path.join(customAvatarDir(packsDir), `${uuid}.png`))).resolves.toBeTruthy();
  });

  it('removes an unreferenced due UUID after both pointers have moved on', async () => {
    const oldUuid = cryptoRandomUuid();
    const liveUuid = cryptoRandomUuid();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeCustomAvatarFiles(packsDir, oldUuid, png, png);
    await writeCustomAvatarFiles(packsDir, liveUuid, png, png);

    await prisma.customAvatar.deleteMany({ where: { userId } });
    await prisma.customAvatar.create({
      data: {
        userId,
        tenantId,
        uuid: liveUuid,
        config: {},
        spriteUrl: `/packs/avatars/custom/${liveUuid}.png`,
        previewUrl: `/packs/avatars/custom/${liveUuid}_p.png`,
        configHash: 'h2',
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { avatarId: `custom:${liveUuid}` },
    });

    const retiredAt = new Date('2020-01-01T00:00:00.000Z');
    await registerRetiredCustomAvatar(packsDir, oldUuid, () => retiredAt);
    const now = new Date(retiredAt.getTime() + CUSTOM_AVATAR_RETENTION_MS + 86_400_000);
    const result = await runCustomAvatarOrphanCleanup({
      packsDir,
      refs: refsFromPrisma(),
      now: () => now,
    });
    expect(result.removed).toContain(oldUuid);
    await expect(fs.stat(path.join(customAvatarDir(packsDir), `${oldUuid}.png`))).rejects.toThrow();
    await expect(fs.stat(path.join(customAvatarRetirementsDir(packsDir), `${oldUuid}.json`))).rejects.toThrow();
    await expect(fs.stat(path.join(customAvatarDir(packsDir), `${liveUuid}.png`))).resolves.toBeTruthy();
  });
});

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}
