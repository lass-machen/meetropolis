import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const PACK_UUID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface AssetPackGenerationPaths {
  id: string;
  tmpDir: string;
  finalDir: string;
  publicPrefix: string;
}

function assertSafePackUuid(packUuid: string): void {
  if (!PACK_UUID_PATTERN.test(packUuid)) {
    throw new Error('invalid asset pack uuid');
  }
}

export async function createAssetPackGeneration(packsDir: string, packUuid: string): Promise<AssetPackGenerationPaths> {
  assertSafePackUuid(packUuid);

  const id = randomUUID();
  const tmpDir = path.resolve(packsDir, `.tmp-${packUuid}-${id}`);
  const finalDir = path.resolve(packsDir, packUuid, 'generations', id);
  const publicPrefix = `/packs/${packUuid}/generations/${id}/`;

  await fsp.mkdir(packsDir, { recursive: true });
  await fsp.mkdir(tmpDir);

  return { id, tmpDir, finalDir, publicPrefix };
}

export async function publishAssetPackGeneration(generation: AssetPackGenerationPaths): Promise<void> {
  try {
    await fsp.stat(generation.finalDir);
    throw new Error('asset pack generation already published');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fsp.mkdir(path.dirname(generation.finalDir), { recursive: true });
  await fsp.rename(generation.tmpDir, generation.finalDir);
}
