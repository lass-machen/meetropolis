import { Readable } from 'node:stream';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ZipEntry } from '../../types/assetPack.js';
import { extractAssetsToTmpDir, parseUploadedConfig } from './assetPacks.processor.js';
import {
  ASSET_PACK_ZIP_LIMITS,
  checkDeclaredZipSize,
  createUnpackBudget,
  readZipEntryBounded,
} from './assetPackZipLimits.js';

const SMALL = { maxEntries: 3, maxUnpackedBytes: 10 };

/** An entry whose central directory claims `declared` bytes but which inflates to `actual`. */
function lyingEntry(entryPath: string, declared: number, actual: Buffer): ZipEntry {
  return {
    path: entryPath,
    uncompressedSize: declared,
    buffer: () => Promise.resolve(actual),
    stream: () => Readable.from([actual.subarray(0, 4), actual.subarray(4)]),
  };
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(roots.map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('asset pack ZIP limits', () => {
  it('allows at most 5000 entries and 200 MiB unpacked', () => {
    expect(ASSET_PACK_ZIP_LIMITS).toEqual({ maxEntries: 5000, maxUnpackedBytes: 200 * 1024 * 1024 });
  });

  it('rejects more entries than allowed before unpacking', () => {
    const entries = Array.from({ length: 4 }, (_, index) => lyingEntry(`assets/${index}.png`, 1, Buffer.from('x')));
    expect(checkDeclaredZipSize(entries, SMALL)).toBe(false);
    expect(checkDeclaredZipSize(entries.slice(0, 3), SMALL)).toBe(true);
  });

  it('rejects a declared unpacked size above the limit before unpacking', () => {
    const entries = [lyingEntry('assets/a.png', 6, Buffer.from('a')), lyingEntry('assets/b.png', 5, Buffer.from('b'))];
    expect(checkDeclaredZipSize(entries, SMALL)).toBe(false);
  });

  it('stops reading an entry once its real bytes exceed the budget', async () => {
    const budget = createUnpackBudget(SMALL);
    const entry = lyingEntry('assets/a.png', 1, Buffer.from('0123456789abcdef'));
    await expect(readZipEntryBounded(entry, budget)).rejects.toMatchObject({ name: 'AssetPackTooLargeError' });
  });

  it('shares one budget across entries', async () => {
    const budget = createUnpackBudget(SMALL);
    await expect(
      readZipEntryBounded(lyingEntry('assets/a.png', 1, Buffer.from('012345')), budget),
    ).resolves.toHaveLength(6);
    await expect(
      readZipEntryBounded(lyingEntry('assets/b.png', 1, Buffer.from('012345')), budget),
    ).rejects.toMatchObject({ name: 'AssetPackTooLargeError' });
  });

  it('answers 413 when an asset inflates beyond the budget and writes no part of it', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'meetropolis-asset-pack-limits-'));
    temporaryRoots.push(tmpDir);
    const result = await extractAssetsToTmpDir(
      [lyingEntry('assets/big.png', 1, Buffer.alloc(32, 1))],
      tmpDir,
      createUnpackBudget(SMALL),
    );
    expect(result).toEqual({ ok: false, status: 413, error: 'asset_pack_too_large' });
    expect(await fsp.readdir(tmpDir)).toEqual([]);
  });

  it('answers 413 when config.json inflates beyond the budget', async () => {
    const config = lyingEntry('config.json', 1, Buffer.from(JSON.stringify({ padding: 'x'.repeat(64) })));
    await expect(parseUploadedConfig(config, createUnpackBudget(SMALL))).resolves.toEqual({
      ok: false,
      status: 413,
      error: 'asset_pack_too_large',
    });
  });
});
