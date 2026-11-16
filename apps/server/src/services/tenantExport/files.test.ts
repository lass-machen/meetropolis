import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { createExportSink, TenantExportError } from './sink.js';
import {
  collectTenantFiles,
  copyPlannedFiles,
  planTenantFiles,
  type FileRoots,
  type TenantFileRows,
} from './files.js';

const PACK_UUID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const AVATAR_UUID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CUSTOM_UUID = 'cccccccc-3333-4333-8333-cccccccccccc';

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-export-files-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

async function makeRoots(): Promise<{ base: string; roots: FileRoots }> {
  const base = await makeTmpDir();
  const roots: FileRoots = {
    packsDir: path.join(base, 'packs'),
    npcMediaDir: path.join(base, 'npc-media'),
    tilesetsDir: path.join(base, 'tilesets'),
  };
  await fsp.mkdir(roots.tilesetsDir, { recursive: true });
  return { base, roots };
}

function baseRows(): TenantFileRows {
  return {
    assetPackUuids: [PACK_UUID],
    avatarPackUuids: [AVATAR_UUID],
    customAvatarUuids: [CUSTOM_UUID],
    npcMediaPaths: ['acme/npc1/abcd1234.wav'],
    tilesetImageUrls: ['/assets/tilesets/grass.png'],
  };
}

function planCode(rows: TenantFileRows, roots: FileRoots, slug = 'acme', exists = () => true): string {
  try {
    planTenantFiles(rows, roots, slug, exists);
  } catch (error) {
    expect(error).toBeInstanceOf(TenantExportError);
    return (error as TenantExportError).code;
  }
  throw new Error('expected TenantExportError');
}

function stubPrisma(rows: TenantFileRows): PrismaClient {
  return {
    assetPack: { findMany: () => Promise.resolve(rows.assetPackUuids.map((uuid) => ({ uuid }))) },
    avatarPack: { findMany: () => Promise.resolve(rows.avatarPackUuids.map((uuid) => ({ uuid }))) },
    customAvatar: { findMany: () => Promise.resolve(rows.customAvatarUuids.map((uuid) => ({ uuid }))) },
    npcMediaFile: {
      findMany: () => Promise.resolve(rows.npcMediaPaths.map((storagePath) => ({ storagePath }))),
    },
    mapTileset: { findMany: () => Promise.resolve(rows.tilesetImageUrls.map((imageUrl) => ({ imageUrl }))) },
  } as unknown as PrismaClient;
}

async function listRelative(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const names = (await fsp.readdir(dir)).sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = await fsp.lstat(full);
      if (stat.isDirectory()) {
        await walk(full, `${prefix}${name}/`);
      } else {
        found.push(`${prefix}${name}`);
      }
    }
  }
  await walk(root, '');
  return found;
}

describe('planTenantFiles', () => {
  it('plans every file kind at its design path', async () => {
    const { roots } = await makeRoots();
    const plan = planTenantFiles(baseRows(), roots, 'acme', () => true);
    expect(plan.dirs).toEqual([
      { relDir: `files/packs/${PACK_UUID}`, sourceDir: path.resolve(roots.packsDir, PACK_UUID) },
      {
        relDir: `files/avatars/${AVATAR_UUID}`,
        sourceDir: path.resolve(roots.packsDir, 'avatars', AVATAR_UUID),
      },
    ]);
    const customDir = path.resolve(roots.packsDir, 'avatars', 'custom');
    expect(plan.files).toEqual([
      {
        relPath: `files/custom-avatars/${CUSTOM_UUID}.png`,
        source: path.join(customDir, `${CUSTOM_UUID}.png`),
      },
      {
        relPath: `files/custom-avatars/${CUSTOM_UUID}_p.png`,
        source: path.join(customDir, `${CUSTOM_UUID}_p.png`),
      },
      {
        relPath: 'files/npc-media/acme/npc1/abcd1234.wav',
        source: path.resolve(roots.npcMediaDir, 'acme/npc1/abcd1234.wav'),
      },
      {
        relPath: 'files/tilesets/grass.png',
        source: path.resolve(roots.tilesetsDir, 'grass.png'),
      },
    ]);
    expect(plan.tilesetsNotFound).toEqual([]);
  });

  it('rejects a uuid with a path separator', async () => {
    const { roots } = await makeRoots();
    expect(planCode({ ...baseRows(), assetPackUuids: ['../x'] }, roots)).toBe('unsafe_path');
  });

  it('rejects an npc storage path of another tenant slug', async () => {
    const { roots } = await makeRoots();
    expect(planCode({ ...baseRows(), npcMediaPaths: ['other/npc1/abcd1234.wav'] }, roots)).toBe('unsafe_path');
  });

  it('rejects a storage path that climbs out of its root', async () => {
    const { roots } = await makeRoots();
    expect(planCode({ ...baseRows(), npcMediaPaths: ['a/../../b'] }, roots)).toBe('unsafe_path');
  });

  it('ignores tileset urls outside the imported tilesets prefix', async () => {
    const { roots } = await makeRoots();
    const plan = planTenantFiles(
      { ...baseRows(), tilesetImageUrls: ['https://cdn.example.com/tiles.png', '/other/path.png'] },
      roots,
      'acme',
      () => true,
    );
    expect(plan.files.filter((file) => file.relPath.startsWith('files/tilesets/'))).toEqual([]);
    expect(plan.tilesetsNotFound).toEqual([]);
  });

  it('reports a missing tileset file instead of planning it', async () => {
    const { roots } = await makeRoots();
    const plan = planTenantFiles(baseRows(), roots, 'acme', () => false);
    expect(plan.files.filter((file) => file.relPath.startsWith('files/tilesets/'))).toEqual([]);
    expect(plan.tilesetsNotFound).toEqual(['grass.png']);
  });
});

describe('copyPlannedFiles', () => {
  it('copies a nested pack directory with the same relative structure', async () => {
    const { roots } = await makeRoots();
    const packDir = path.join(roots.packsDir, PACK_UUID);
    await fsp.mkdir(path.join(packDir, 'sprites', 'deep'), { recursive: true });
    await fsp.writeFile(path.join(packDir, 'pack.json'), '{"name":"pack"}', 'utf8');
    await fsp.writeFile(path.join(packDir, 'sprites', 'tile.png'), 'tile-bytes', 'utf8');
    await fsp.writeFile(path.join(packDir, 'sprites', 'deep', 'leaf.txt'), 'leaf', 'utf8');

    const rows: TenantFileRows = {
      assetPackUuids: [PACK_UUID],
      avatarPackUuids: [],
      customAvatarUuids: [],
      npcMediaPaths: [],
      tilesetImageUrls: [],
    };
    const outDir = await makeTmpDir();
    const { sink } = createExportSink(outDir);
    await copyPlannedFiles(planTenantFiles(rows, roots, 'acme', () => true), sink);

    expect(await listRelative(path.join(outDir, 'files', 'packs', PACK_UUID))).toEqual([
      'pack.json',
      'sprites/deep/leaf.txt',
      'sprites/tile.png',
    ]);
    expect(await fsp.readFile(path.join(outDir, 'files', 'packs', PACK_UUID, 'sprites', 'tile.png'), 'utf8')).toBe(
      'tile-bytes',
    );
  });

  it('records a missing pack directory through the sink', async () => {
    const { roots } = await makeRoots();
    const outDir = await makeTmpDir();
    const { sink, finalize } = createExportSink(outDir);
    const rows: TenantFileRows = {
      assetPackUuids: ['99999999-9999-4999-8999-999999999999'],
      avatarPackUuids: [],
      customAvatarUuids: [],
      npcMediaPaths: [],
      tilesetImageUrls: [],
    };
    await copyPlannedFiles(planTenantFiles(rows, roots, 'acme', () => true), sink);
    const totals = await finalize({
      exportedAt: new Date(0).toISOString(),
      tenant: { id: 't', slug: 'acme', name: 'Acme' },
      enterprise: false,
      maps: [],
      tilesetsNotFound: [],
    });
    expect(totals.missing).toBe(1);
    expect(totals.files).toBe(0);
  });

  it('does not follow a symlink inside a pack directory', async () => {
    const { roots } = await makeRoots();
    const packDir = path.join(roots.packsDir, PACK_UUID);
    await fsp.mkdir(packDir, { recursive: true });
    await fsp.writeFile(path.join(packDir, 'real.txt'), 'real', 'utf8');
    const outside = path.join(roots.packsDir, 'outside.txt');
    await fsp.writeFile(outside, 'outside', 'utf8');
    await fsp.symlink(outside, path.join(packDir, 'link.txt'));

    const rows: TenantFileRows = {
      assetPackUuids: [PACK_UUID],
      avatarPackUuids: [],
      customAvatarUuids: [],
      npcMediaPaths: [],
      tilesetImageUrls: [],
    };
    const outDir = await makeTmpDir();
    const { sink } = createExportSink(outDir);
    await copyPlannedFiles(planTenantFiles(rows, roots, 'acme', () => true), sink);

    expect(await listRelative(path.join(outDir, 'files', 'packs', PACK_UUID))).toEqual(['real.txt']);
  });
});

describe('collectTenantFiles', () => {
  it('copies every kind end to end and reports missing tilesets', async () => {
    const { roots } = await makeRoots();
    await fsp.mkdir(path.join(roots.packsDir, PACK_UUID), { recursive: true });
    await fsp.writeFile(path.join(roots.packsDir, PACK_UUID, 'pack.json'), '{}', 'utf8');
    const customDir = path.join(roots.packsDir, 'avatars', 'custom');
    await fsp.mkdir(customDir, { recursive: true });
    await fsp.writeFile(path.join(customDir, `${CUSTOM_UUID}.png`), 'sheet', 'utf8');
    await fsp.writeFile(path.join(customDir, `${CUSTOM_UUID}_p.png`), 'preview', 'utf8');
    const mediaFile = path.join(roots.npcMediaDir, 'acme', 'npc1', 'abcd1234.wav');
    await fsp.mkdir(path.dirname(mediaFile), { recursive: true });
    await fsp.writeFile(mediaFile, 'audio', 'utf8');

    const rows: TenantFileRows = {
      ...baseRows(),
      avatarPackUuids: [],
      tilesetImageUrls: ['/assets/tilesets/missing.png', 'https://cdn.example.com/foreign.png'],
    };
    const outDir = await makeTmpDir();
    const { sink } = createExportSink(outDir);
    const result = await collectTenantFiles(stubPrisma(rows), { id: 't', slug: 'acme' }, sink, roots);

    expect(result).toEqual({ tilesetsNotFound: ['missing.png'] });
    expect(await listRelative(path.join(outDir, 'files'))).toEqual([
      'custom-avatars/cccccccc-3333-4333-8333-cccccccccccc.png',
      'custom-avatars/cccccccc-3333-4333-8333-cccccccccccc_p.png',
      'npc-media/acme/npc1/abcd1234.wav',
      'packs/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/pack.json',
    ]);
  });
});
