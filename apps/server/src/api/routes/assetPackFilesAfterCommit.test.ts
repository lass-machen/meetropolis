import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { cleanupPackGenerationsAfterCommit, removeDeletedPackFilesAfterCommit } from './assetPackFilesAfterCommit.js';

const PACK = 'office-pack';
const CURRENT = '550e8400-e29b-44d4-a716-446655440000';
const OLD = '11111111-1111-4111-8111-111111111111';
const TILESET_REF = '22222222-2222-4222-8222-222222222222';

const temporaryRoots: string[] = [];

async function temporaryPacksRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meetropolis-asset-pack-after-commit-'));
  temporaryRoots.push(root);
  return root;
}

async function writeFile(root: string, ...segments: string[]): Promise<string> {
  const file = path.join(root, ...segments);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, 'bytes');
  return file;
}

async function exists(file: string): Promise<boolean> {
  return fsp
    .stat(file)
    .then(() => true)
    .catch(() => false);
}

interface DoubleState {
  pack: { id: number; currentGeneration: string | null } | null;
  tilesetUrls?: string[];
  objectUrls?: string[];
}

function makePrisma(state: DoubleState): { prisma: PrismaClient; calls: string[] } {
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(() => {
      calls.push('lock');
      return Promise.resolve([]);
    }),
    assetPack: {
      findUnique: vi.fn(() => {
        calls.push('pack');
        return Promise.resolve(state.pack);
      }),
    },
    mapAutotile: { findMany: vi.fn(() => Promise.resolve([])) },
    mapObject: {
      findMany: vi.fn(() => Promise.resolve((state.objectUrls ?? []).map((dataUrl) => ({ dataUrl })))),
    },
    mapTileset: {
      findMany: vi.fn(() => Promise.resolve((state.tilesetUrls ?? []).map((imageUrl) => ({ imageUrl })))),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return { prisma, calls };
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('removeDeletedPackFilesAfterCommit', () => {
  it('removes the files of a deleted, unreferenced pack under the pack lock', async () => {
    const root = await temporaryPacksRoot();
    const file = await writeFile(root, PACK, 'desk.png');
    const { prisma, calls } = makePrisma({ pack: null });

    await expect(removeDeletedPackFilesAfterCommit(prisma, root, PACK)).resolves.toBe(true);

    expect(await exists(path.dirname(file))).toBe(false);
    expect(calls).toEqual(['lock', 'pack']);
  });

  it('keeps the files when the pack was uploaded again after the deletion', async () => {
    const root = await temporaryPacksRoot();
    const file = await writeFile(root, PACK, 'generations', CURRENT, 'desk.png');
    const { prisma } = makePrisma({ pack: { id: 7, currentGeneration: CURRENT } });

    await expect(removeDeletedPackFilesAfterCommit(prisma, root, PACK)).resolves.toBe(false);

    expect(await exists(file)).toBe(true);
  });

  it('keeps the files while a map tileset still points into the pack', async () => {
    const root = await temporaryPacksRoot();
    const file = await writeFile(root, PACK, 'tiles.png');
    const { prisma } = makePrisma({ pack: null, tilesetUrls: [`/packs/${PACK}/tiles.png`] });

    await expect(removeDeletedPackFilesAfterCommit(prisma, root, PACK)).resolves.toBe(false);

    expect(await exists(file)).toBe(true);
  });

  it('rejects a pack identifier that would leave the pack root', async () => {
    const root = await temporaryPacksRoot();
    const { prisma } = makePrisma({ pack: null });

    await expect(removeDeletedPackFilesAfterCommit(prisma, root, '..')).rejects.toThrow('invalid asset pack uuid');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('cleanupPackGenerationsAfterCommit', () => {
  it('removes superseded generations and keeps current and tileset-referenced ones', async () => {
    const root = await temporaryPacksRoot();
    const current = await writeFile(root, PACK, 'generations', CURRENT, 'a.png');
    const old = await writeFile(root, PACK, 'generations', OLD, 'a.png');
    const referenced = await writeFile(root, PACK, 'generations', TILESET_REF, 'tiles.png');
    const legacy = await writeFile(root, PACK, 'legacy.png');
    const { prisma, calls } = makePrisma({
      pack: { id: 7, currentGeneration: CURRENT },
      tilesetUrls: [`/packs/${PACK}/generations/${TILESET_REF}/tiles.png`],
    });

    await expect(cleanupPackGenerationsAfterCommit(prisma, root, PACK)).resolves.toEqual([OLD]);

    expect(await exists(current)).toBe(true);
    expect(await exists(old)).toBe(false);
    expect(await exists(referenced)).toBe(true);
    expect(await exists(legacy)).toBe(true);
    expect(calls).toEqual(['lock', 'pack']);
  });

  it('leaves the files of a pack that no longer exists to the deletion path', async () => {
    const root = await temporaryPacksRoot();
    const old = await writeFile(root, PACK, 'generations', OLD, 'a.png');
    const { prisma } = makePrisma({ pack: null });

    await expect(cleanupPackGenerationsAfterCommit(prisma, root, PACK)).resolves.toEqual([]);

    expect(await exists(old)).toBe(true);
  });
});
