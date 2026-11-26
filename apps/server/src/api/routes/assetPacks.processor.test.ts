import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractAssetsToTmpDir,
  persistAssetPackRecord,
  preserveReferencedPackAssets,
  rewriteConfig,
  ReferencedAssetConflictError,
} from './assetPacks.processor.js';
import type { AssetPackConfig } from '../../types/assetPack.js';

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
});

describe('generation url prefix', () => {
  const baseCfg: AssetPackConfig = {
    uuid: 'office-kit',
    name: 'Office Kit',
    description: 'desks',
    author: 'meetropolis',
    version: '1.0.0',
    objects: [
      {
        id: 'chair',
        key: 'chair',
        category: 'objects',
        dataURL: 'assets/chair.png',
        width: 32,
        height: 32,
        directionalImages: [{ rotation: 90, dataURL: 'assets/chair-side.png' }],
      },
    ],
  };
  const assetMap = new Map([
    ['assets/chair.png', 'chair.12ab34cd.png'],
    ['assets/chair-side.png', 'chair-side.56ef78ab.png'],
  ]);

  it('keeps the exact legacy prefix without a generation argument', () => {
    const rewritten = rewriteConfig(baseCfg, 'office-kit', assetMap);
    expect(rewritten.objects[0].dataURL).toBe('/packs/office-kit/chair.12ab34cd.png');
    expect(rewritten.objects[0].directionalImages?.[0].dataURL).toBe('/packs/office-kit/chair-side.56ef78ab.png');
  });

  it('places dataURL and directionalImages under the generation prefix', () => {
    const generationId = '550e8400-e29b-41d4-a716-446655440000';
    const rewritten = rewriteConfig(baseCfg, 'office-kit', assetMap, generationId);
    expect(rewritten.objects[0].dataURL).toBe(`/packs/office-kit/generations/${generationId}/chair.12ab34cd.png`);
    expect(rewritten.objects[0].directionalImages?.[0].dataURL).toBe(
      `/packs/office-kit/generations/${generationId}/chair-side.56ef78ab.png`,
    );
    expect(rewritten.objects[0].dataURL).not.toContain('/member-assets/');
  });
});

describe('asset pack generation pointer', () => {
  const cfg: AssetPackConfig = {
    uuid: 'office-kit',
    name: 'Office Kit',
    description: 'desks',
    author: 'meetropolis',
    version: '1.0.0',
  };
  const rewritten = {
    uuid: 'office-kit',
    name: 'Office Kit',
    description: 'desks',
    author: 'meetropolis',
    version: '1.0.0',
    terrain: [],
    structures: [],
    objects: [],
    autotiles: [],
  };

  it('writes currentGeneration on update when the generation argument is given', async () => {
    const update = vi.fn().mockResolvedValue({ id: 7 });
    const prisma = { assetPack: { update, create: vi.fn() } };
    await persistAssetPackRecord(prisma as never, cfg, rewritten, { id: 7 }, '550e8400-e29b-41d4-a716-446655440000');
    expect(update).toHaveBeenCalledWith({
      where: { uuid: 'office-kit' },
      data: expect.objectContaining({ currentGeneration: '550e8400-e29b-41d4-a716-446655440000' }),
    });
  });

  it('leaves the legacy default untouched when no generation argument is given', async () => {
    const update = vi.fn().mockResolvedValue({ id: 7 });
    const prisma = { assetPack: { update, create: vi.fn() } };
    await persistAssetPackRecord(prisma as never, cfg, rewritten, { id: 7 });
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect('currentGeneration' in data).toBe(false);
    expect(data.tenantId).toBeUndefined();
  });
});

describe('referenced pack assets in generation uploads', () => {
  it('validates referenced files in place without copying snapshots into the new generation', async () => {
    const root = await temporaryDirectory();
    const legacyDir = path.join(root, 'packs', 'pack-one');
    const generationDir = path.join(root, 'packs', 'pack-one', 'generations', 'gen-new');
    await fsp.mkdir(legacyDir, { recursive: true });
    await fsp.mkdir(generationDir, { recursive: true });
    await fsp.writeFile(path.join(legacyDir, 'chair.12ab34cd.png'), 'legacy bytes');
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: {
        findMany: vi.fn().mockResolvedValue([{ dataUrl: '/packs/pack-one/chair.12ab34cd.png' }]),
      },
    };

    const preserved = await preserveReferencedPackAssets(prisma, 'pack-one', legacyDir, generationDir, {
      retainInPlace: true,
    });

    expect(preserved).toEqual([]);
    await expect(fsp.readFile(path.join(legacyDir, 'chair.12ab34cd.png'), 'utf8')).resolves.toBe('legacy bytes');
    const generationEntries = await fsp.readdir(generationDir);
    expect(generationEntries).toEqual([]);
  });

  it('still requires repair for missing snapshots instead of silently continuing', async () => {
    const root = await temporaryDirectory();
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: { findMany: vi.fn().mockResolvedValue([{ dataUrl: '/packs/pack-one/missing.1234abcd.png' }]) },
    };

    await expect(
      preserveReferencedPackAssets(
        prisma,
        'pack-one',
        path.join(root, 'packs', 'pack-one'),
        path.join(root, 'packs', 'pack-one', 'generations', 'gen-new'),
        { retainInPlace: true },
      ),
    ).rejects.toThrow('referenced pack asset is missing');
  });

  it('repairs a missing generation snapshot from matching uploaded bytes by filename', async () => {
    const root = await temporaryDirectory();
    const oldGeneration = '550e8400-e29b-41d4-a716-446655440000';
    const hashed = 'chair.12ab34cd56ef78ab90cd12ef34ab56cd.png';
    const url = `/packs/pack-one/generations/${oldGeneration}/${hashed}`;
    const currentDir = path.join(root, 'packs', 'pack-one');
    const tmpDir = path.join(root, 'tmp-gen');
    await fsp.mkdir(tmpDir, { recursive: true });
    await fsp.writeFile(path.join(tmpDir, hashed), 'reuploaded bytes');
    const prisma = {
      mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
      mapObject: { findMany: vi.fn().mockResolvedValue([{ dataUrl: url }]) },
    };
    const onRepair = vi.fn();

    const preserved = await preserveReferencedPackAssets(prisma, 'pack-one', currentDir, tmpDir, {
      repairMissing: true,
      retainInPlace: true,
      onRepair,
    });

    expect(preserved).toEqual([`generations/${oldGeneration}/${hashed}`]);
    await expect(fsp.readFile(path.join(currentDir, 'generations', oldGeneration, hashed), 'utf8')).resolves.toBe(
      'reuploaded bytes',
    );
    expect(onRepair).toHaveBeenCalledWith({ url, source: path.join(tmpDir, hashed) });
    await expect(fsp.readdir(tmpDir)).resolves.toEqual([hashed]);
  });
});

describe('referenced pack asset preservation', () => {
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
