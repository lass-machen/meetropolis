import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssetPackGeneration, publishAssetPackGeneration } from './assetPackGenerations.js';

const temporaryRoots: string[] = [];

async function temporaryPacksRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meetropolis-asset-pack-gen-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map(async (root) => {
      if (root.startsWith(os.tmpdir() + path.sep)) {
        await fsp.rm(root, { recursive: true, force: true });
      }
    }),
  );
});

describe('asset pack generation paths', () => {
  it('creates distinct generations and publishes full bytes without touching legacy files', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    const legacyPath = path.join(packsDir, packUuid, 'chair.legacy.png');
    await fsp.mkdir(path.dirname(legacyPath), { recursive: true });
    const legacyBytes = Buffer.from('legacy-sentinel-bytes-v1');
    await fsp.writeFile(legacyPath, legacyBytes);

    const first = await createAssetPackGeneration(packsDir, packUuid);
    const second = await createAssetPackGeneration(packsDir, packUuid);

    expect(first.id).not.toBe(second.id);
    expect(first.tmpDir).not.toBe(second.tmpDir);
    expect(first.finalDir).not.toBe(second.finalDir);
    expect(first.publicPrefix).toBe(`/packs/${packUuid}/generations/${first.id}/`);
    expect(second.publicPrefix).toBe(`/packs/${packUuid}/generations/${second.id}/`);
    expect(first.tmpDir).toBe(path.resolve(packsDir, `.tmp-${packUuid}-${first.id}`));
    expect(first.finalDir).toBe(path.resolve(packsDir, packUuid, 'generations', first.id));
    expect(second.tmpDir).toBe(path.resolve(packsDir, `.tmp-${packUuid}-${second.id}`));
    expect(second.finalDir).toBe(path.resolve(packsDir, packUuid, 'generations', second.id));

    const firstBytes = Buffer.from('generation-one-payload');
    const secondBytes = Buffer.from('generation-two-payload');
    await fsp.writeFile(path.join(first.tmpDir, 'chair.12ab34cd.png'), firstBytes);
    await fsp.writeFile(path.join(second.tmpDir, 'desk.98fe76dc.png'), secondBytes);

    await publishAssetPackGeneration(first);
    await publishAssetPackGeneration(second);

    await expect(fsp.readFile(path.join(first.finalDir, 'chair.12ab34cd.png'))).resolves.toEqual(firstBytes);
    await expect(fsp.readFile(path.join(second.finalDir, 'desk.98fe76dc.png'))).resolves.toEqual(secondBytes);
    await expect(fsp.readFile(legacyPath)).resolves.toEqual(legacyBytes);
    await expect(fsp.stat(first.tmpDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(second.tmpDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects republishing into an existing final generation directory', async () => {
    const packsDir = await temporaryPacksRoot();
    const packUuid = 'office-kit';
    const generation = await createAssetPackGeneration(packsDir, packUuid);
    await fsp.writeFile(path.join(generation.tmpDir, 'asset.bin'), Buffer.from('first'));
    await publishAssetPackGeneration(generation);

    const colliding = await createAssetPackGeneration(packsDir, packUuid);
    await fsp.rm(colliding.tmpDir, { recursive: true, force: true });
    const forced: typeof generation = {
      ...colliding,
      id: generation.id,
      tmpDir: path.resolve(packsDir, `.tmp-${packUuid}-${generation.id}-retry`),
      finalDir: generation.finalDir,
      publicPrefix: generation.publicPrefix,
    };
    await fsp.mkdir(forced.tmpDir);
    await fsp.writeFile(path.join(forced.tmpDir, 'asset.bin'), Buffer.from('overwrite-attempt'));

    await expect(publishAssetPackGeneration(forced)).rejects.toThrow();
    await expect(fsp.readFile(path.join(generation.finalDir, 'asset.bin'))).resolves.toEqual(Buffer.from('first'));
    await expect(fsp.stat(forced.tmpDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it('rejects unsafe pack ids before touching the filesystem outside the packs root', async () => {
    const packsDir = await temporaryPacksRoot();
    const escapeProbe = path.join(path.dirname(packsDir), 'escape-sentinel.txt');
    await fsp.writeFile(escapeProbe, 'untouched');
    temporaryRoots.push(escapeProbe);

    await expect(createAssetPackGeneration(packsDir, '../escape')).rejects.toThrow();
    await expect(createAssetPackGeneration(packsDir, 'bad/id')).rejects.toThrow();
    await expect(createAssetPackGeneration(packsDir, 'bad id')).rejects.toThrow();
    await expect(fsp.readFile(escapeProbe, 'utf8')).resolves.toBe('untouched');

    const entries = await fsp.readdir(packsDir);
    expect(entries).toEqual([]);
  });
});
