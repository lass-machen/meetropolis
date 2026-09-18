import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractAssetsToTmpDir,
  preserveReferencedPackAssets,
  ReferencedAssetConflictError,
} from './assetPacks.processor.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'meetropolis-pack-snapshot-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fsp.rm(directory, { recursive: true })));
});

describe('referenced pack asset preservation', () => {
  it('copies referenced content-addressed files that are absent from the replacement upload', async () => {
    const root = await temporaryDirectory();
    const current = path.join(root, 'current');
    const replacement = path.join(root, 'replacement');
    await fsp.mkdir(path.join(current, 'walls'), { recursive: true });
    await fsp.mkdir(replacement, { recursive: true });
    await fsp.writeFile(path.join(current, 'walls', 'wall.1234abcd.png'), 'old snapshot');
    const prisma = {
      mapAutotile: {
        findMany: vi.fn().mockResolvedValue([{ imageUrl: '/packs/pack-one/walls/wall.1234abcd.png' }]),
      },
      mapObject: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const preserved = await preserveReferencedPackAssets(prisma, 'pack-one', current, replacement);

    expect(preserved).toEqual(['walls/wall.1234abcd.png']);
    await expect(fsp.readFile(path.join(replacement, preserved[0]), 'utf8')).resolves.toBe('old snapshot');
  });

  it('fails the upload when an existing map snapshot is already missing on disk', async () => {
    const root = await temporaryDirectory();
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: { findMany: vi.fn().mockResolvedValue([{ dataUrl: '/packs/pack-one/missing.1234abcd.png' }]) },
    };

    await expect(
      preserveReferencedPackAssets(prisma, 'pack-one', path.join(root, 'current'), path.join(root, 'replacement')),
    ).rejects.toThrow('referenced pack asset is missing');
  });

  it('uses a 128-bit hash prefix for newly extracted asset names', async () => {
    const root = await temporaryDirectory();
    const result = await extractAssetsToTmpDir(
      [{ path: 'assets/chair.png', buffer: () => Promise.resolve(Buffer.from('chair bytes')) }],
      root,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assetMap.get('assets/chair.png')).toMatch(/^chair\.[0-9a-f]{32}\.png$/);
  });

  it('rejects a full-digest mismatch at an already occupied snapshot path', async () => {
    const root = await temporaryDirectory();
    const current = path.join(root, 'current');
    const replacement = path.join(root, 'replacement');
    await fsp.mkdir(current);
    await fsp.mkdir(replacement);
    await fsp.writeFile(path.join(current, 'chair.1234567890abcdef1234567890abcdef.png'), 'old');
    await fsp.writeFile(path.join(replacement, 'chair.1234567890abcdef1234567890abcdef.png'), 'different');
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ dataUrl: '/packs/pack-one/chair.1234567890abcdef1234567890abcdef.png' }]),
      },
    };

    await expect(preserveReferencedPackAssets(prisma, 'pack-one', current, replacement)).rejects.toBeInstanceOf(
      ReferencedAssetConflictError,
    );
  });

  it('repairs a missing legacy snapshot only through the explicit audited path', async () => {
    const root = await temporaryDirectory();
    const replacement = path.join(root, 'replacement');
    const hashed = path.join(replacement, 'chair.abcdef0123456789abcdef0123456789.png');
    await fsp.mkdir(replacement);
    await fsp.writeFile(hashed, 'replacement bytes');
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: { findMany: vi.fn().mockResolvedValue([{ dataUrl: '/packs/pack-one/chair.png' }]) },
    };
    const onRepair = vi.fn();

    await preserveReferencedPackAssets(prisma, 'pack-one', path.join(root, 'missing'), replacement, {
      repairMissing: true,
      repairSources: new Map([['chair.png', hashed]]),
      onRepair,
    });

    await expect(fsp.readFile(path.join(replacement, 'chair.png'), 'utf8')).resolves.toBe('replacement bytes');
    expect(onRepair).toHaveBeenCalledWith({ url: '/packs/pack-one/chair.png', source: hashed });
  });
});
