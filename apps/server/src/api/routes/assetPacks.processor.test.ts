import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preserveReferencedPackAssets } from './assetPacks.processor.js';

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
});
