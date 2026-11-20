import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupAssetPackGenerations } from './assetPackGenerationCleanup.js';

const temporaryRoots: string[] = [];

const CURRENT = '550e8400-e29b-44d4-a716-446655440000';
const OLD_UNREF = '11111111-1111-4111-8111-111111111111';
const REF_A = '22222222-2222-4222-8222-222222222222';
const REF_B = '33333333-3333-4333-8333-333333333333';
const ABS_REF = '44444444-4444-4444-8444-444444444444';

async function temporaryPacksRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meetropolis-asset-pack-cleanup-'));
  temporaryRoots.push(root);
  return root;
}

async function writeGeneration(packsDir: string, packUuid: string, genId: string, marker: string): Promise<string> {
  const dir = path.join(packsDir, packUuid, 'generations', genId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'asset.bin'), Buffer.from(marker));
  return dir;
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map(async (root) => {
      if (root.startsWith(os.tmpdir() + path.sep) || root.startsWith(path.join(os.tmpdir()))) {
        await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    }),
  );
});

describe('cleanupAssetPackGenerations', () => {
  it('removes old unreferenced uuid-v4 generations and keeps current plus referenced ones', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    const legacyPath = path.join(packsDir, packUuid, 'chair.legacy.png');
    await fsp.mkdir(path.dirname(legacyPath), { recursive: true });
    const legacyBytes = Buffer.from('legacy-sentinel-bytes-v1');
    await fsp.writeFile(legacyPath, legacyBytes);

    await writeGeneration(packsDir, packUuid, CURRENT, 'current');
    await writeGeneration(packsDir, packUuid, OLD_UNREF, 'old-unref');
    await writeGeneration(packsDir, packUuid, REF_A, 'ref-a');
    await writeGeneration(packsDir, packUuid, REF_B, 'ref-b');
    await writeGeneration(packsDir, packUuid, ABS_REF, 'abs-ref');

    const unknownName = path.join(packsDir, packUuid, 'generations', 'not-a-uuid-dir');
    await fsp.mkdir(unknownName, { recursive: true });
    await fsp.writeFile(path.join(unknownName, 'keep.txt'), 'unknown-name');

    const unknownFile = path.join(packsDir, packUuid, 'generations', 'readme.txt');
    await fsp.writeFile(unknownFile, 'plain-file');

    const outsideRoot = path.join(packsDir, 'outside-symlink-target');
    await fsp.mkdir(outsideRoot, { recursive: true });
    await fsp.writeFile(path.join(outsideRoot, 'stay.txt'), 'outside');
    const symlinkInGenerations = path.join(packsDir, packUuid, 'generations', '55555555-5555-4555-8555-555555555555');
    await fsp.symlink(outsideRoot, symlinkInGenerations);

    const removed = await cleanupAssetPackGenerations(packsDir, packUuid, CURRENT, [
      `/packs/${packUuid}/generations/${REF_A}/chair.12ab34cd.png`,
      `/packs/${packUuid}/generations/${REF_B}/desk.98fe76dc.png`,
      `https://cdn.example.test/packs/${packUuid}/generations/${ABS_REF}/lamp.aa11bb22.png`,
    ]);

    expect(removed.sort()).toEqual([OLD_UNREF]);
    await expect(fsp.stat(path.join(packsDir, packUuid, 'generations', OLD_UNREF))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', CURRENT, 'asset.bin'))).resolves.toEqual(
      Buffer.from('current'),
    );
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', REF_A, 'asset.bin'))).resolves.toEqual(
      Buffer.from('ref-a'),
    );
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', REF_B, 'asset.bin'))).resolves.toEqual(
      Buffer.from('ref-b'),
    );
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', ABS_REF, 'asset.bin'))).resolves.toEqual(
      Buffer.from('abs-ref'),
    );
    await expect(fsp.readFile(legacyPath)).resolves.toEqual(legacyBytes);
    await expect(fsp.readFile(path.join(unknownName, 'keep.txt'), 'utf8')).resolves.toBe('unknown-name');
    await expect(fsp.readFile(unknownFile, 'utf8')).resolves.toBe('plain-file');
    await expect(fsp.lstat(symlinkInGenerations)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    await expect(fsp.readFile(path.join(outsideRoot, 'stay.txt'), 'utf8')).resolves.toBe('outside');
  });

  it('returns empty array when generations directory is missing', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    await fsp.mkdir(path.join(packsDir, packUuid), { recursive: true });

    await expect(cleanupAssetPackGenerations(packsDir, packUuid, CURRENT, [])).resolves.toEqual([]);
  });

  it('rejects unsafe pack ids before filesystem escape', async () => {
    const packsDir = await temporaryPacksRoot();
    const escapeProbe = path.join(path.dirname(packsDir), 'escape-sentinel-cleanup.txt');
    await fsp.writeFile(escapeProbe, 'untouched');
    temporaryRoots.push(escapeProbe);

    await expect(cleanupAssetPackGenerations(packsDir, '../escape', null, [])).rejects.toThrow();
    await expect(cleanupAssetPackGenerations(packsDir, 'bad/id', null, [])).rejects.toThrow();
    await expect(cleanupAssetPackGenerations(packsDir, 'bad id', null, [])).rejects.toThrow();
    await expect(fsp.readFile(escapeProbe, 'utf8')).resolves.toBe('untouched');
    await expect(fsp.readdir(packsDir)).resolves.toEqual([]);
  });

  it('fail-closes when a pack-owned generation reference is not safely interpretable', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    await writeGeneration(packsDir, packUuid, OLD_UNREF, 'old');
    await writeGeneration(packsDir, packUuid, CURRENT, 'current');

    const removed = await cleanupAssetPackGenerations(packsDir, packUuid, CURRENT, [
      `/packs/${packUuid}/generations/../${OLD_UNREF}/evil.png`,
    ]);

    expect(removed).toEqual([]);
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', OLD_UNREF, 'asset.bin'))).resolves.toEqual(
      Buffer.from('old'),
    );
    await expect(fsp.readFile(path.join(packsDir, packUuid, 'generations', CURRENT, 'asset.bin'))).resolves.toEqual(
      Buffer.from('current'),
    );
  });

  it('skips cleanup when generations root is a symlink', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    const hostGen = path.join(packsDir, 'host-pack', 'generations');
    await fsp.mkdir(path.join(hostGen, OLD_UNREF), { recursive: true });
    await fsp.writeFile(path.join(hostGen, OLD_UNREF, 'asset.bin'), Buffer.from('via-symlink'));
    await fsp.mkdir(path.join(packsDir, packUuid), { recursive: true });
    await fsp.symlink(hostGen, path.join(packsDir, packUuid, 'generations'));

    const removed = await cleanupAssetPackGenerations(packsDir, packUuid, null, []);
    expect(removed).toEqual([]);
    await expect(fsp.readFile(path.join(hostGen, OLD_UNREF, 'asset.bin'))).resolves.toEqual(Buffer.from('via-symlink'));
  });
});
