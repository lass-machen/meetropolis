import path from 'node:path';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DeletionTaskTargetInput,
  fsErrorCode,
  removeTarget,
  resolveTaskTargets,
  targetExists,
} from './deletionTaskTargets.js';

const OBJECT_ID = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PACK_SYSTEMS = ['asset_packs', 'avatar_packs', 'custom_avatars'];
const INVALID_OBJECT_IDS = ['..', 'a/b', ''];

let root = '';
let packs = '';
let npcDir = '';
let savedAssetPacksDir: string | undefined;
let savedNpcMediaDir: string | undefined;

function restoreEnv(key: 'ASSET_PACKS_DIR' | 'NPC_MEDIA_DIR', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function task(overrides: Partial<DeletionTaskTargetInput> = {}): DeletionTaskTargetInput {
  return { kind: 'file', targetSystem: 'asset_packs', objectId: OBJECT_ID, storageKey: null, ...overrides };
}

async function writeFile(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deletion-task-targets-'));
  packs = path.join(root, 'packs');
  npcDir = path.join(root, 'npc-media');
  await fsp.mkdir(packs);
  savedAssetPacksDir = process.env.ASSET_PACKS_DIR;
  savedNpcMediaDir = process.env.NPC_MEDIA_DIR;
  process.env.ASSET_PACKS_DIR = packs;
  process.env.NPC_MEDIA_DIR = npcDir;
});

afterEach(async () => {
  restoreEnv('ASSET_PACKS_DIR', savedAssetPacksDir);
  restoreEnv('NPC_MEDIA_DIR', savedNpcMediaDir);
  await fsp.rm(root, { recursive: true, force: true });
});

describe('resolveTaskTargets rejects tasks that do not describe one owned file', () => {
  it('maps each target system to its storage root and to the owned path', () => {
    const customDir = path.join(packs, 'avatars', 'custom');
    expect(resolveTaskTargets(task({ targetSystem: 'asset_packs' }))).toEqual({
      ok: true,
      targets: [{ base: packs, path: path.join(packs, OBJECT_ID) }],
    });
    expect(resolveTaskTargets(task({ targetSystem: 'avatar_packs' }))).toEqual({
      ok: true,
      targets: [{ base: packs, path: path.join(packs, 'avatars', OBJECT_ID) }],
    });
    expect(resolveTaskTargets(task({ targetSystem: 'custom_avatars' }))).toEqual({
      ok: true,
      targets: [
        { base: packs, path: path.join(customDir, `${OBJECT_ID}.png`) },
        { base: packs, path: path.join(customDir, `${OBJECT_ID}_p.png`) },
      ],
    });
    expect(resolveTaskTargets(task({ targetSystem: 'npc_media', storageKey: 'acme' }))).toEqual({
      ok: true,
      targets: [{ base: npcDir, path: path.join(npcDir, 'acme') }],
    });
  });

  it.each(PACK_SYSTEMS.flatMap((targetSystem) => INVALID_OBJECT_IDS.map((objectId) => ({ targetSystem, objectId }))))(
    'rejects $targetSystem with object id $objectId as invalid_target',
    ({ targetSystem, objectId }) => {
      expect(resolveTaskTargets(task({ targetSystem, objectId }))).toEqual({ ok: false, code: 'invalid_target' });
    },
  );

  it.each(PACK_SYSTEMS)(
    'rejects a %s task whose storage key differs from the object id as inconsistent_target',
    (targetSystem) => {
      expect(resolveTaskTargets(task({ targetSystem, storageKey: 'other-key' }))).toEqual({
        ok: false,
        code: 'inconsistent_target',
      });
    },
  );

  it.each([null, '..', 'a/b'])('rejects an npc media task with storage key %j as invalid_target', (storageKey) => {
    expect(resolveTaskTargets(task({ targetSystem: 'npc_media', storageKey }))).toEqual({
      ok: false,
      code: 'invalid_target',
    });
  });

  it('rejects an unknown target system as unknown_target_system', () => {
    expect(resolveTaskTargets(task({ targetSystem: 'bogus_system' }))).toEqual({
      ok: false,
      code: 'unknown_target_system',
    });
  });

  it.each(['directory', ''])('rejects the task kind %j as unknown_task_kind', (kind) => {
    expect(resolveTaskTargets(task({ kind }))).toEqual({ ok: false, code: 'unknown_task_kind' });
  });
});

describe('removeTarget removes only owned targets and refuses symbolic links', () => {
  it('removes an existing asset pack directory with its contents and keeps other packs', async () => {
    await writeFile(path.join(packs, OBJECT_ID, 'nested', 'sprite.png'), 'pack');
    await writeFile(path.join(packs, OTHER_ID, 'keep.txt'), 'other');
    const outcome = await removeTarget({ base: packs, path: path.join(packs, OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'removed' });
    expect(await isPresent(path.join(packs, OBJECT_ID))).toBe(false);
    expect(await fsp.readFile(path.join(packs, OTHER_ID, 'keep.txt'), 'utf8')).toBe('other');
  });

  it('removes an avatar pack directory below the avatars folder and keeps the folder', async () => {
    await writeFile(path.join(packs, 'avatars', OBJECT_ID, 'sprite.png'), 'pack');
    const outcome = await removeTarget({ base: packs, path: path.join(packs, 'avatars', OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'removed' });
    expect(await isPresent(path.join(packs, 'avatars', OBJECT_ID))).toBe(false);
    expect(await isPresent(path.join(packs, 'avatars'))).toBe(true);
  });

  it('reports a missing target as missing', async () => {
    const outcome = await removeTarget({ base: packs, path: path.join(packs, OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'missing' });
  });

  it('reports a missing avatars folder as missing rather than as a missing storage root', async () => {
    const outcome = await removeTarget({ base: packs, path: path.join(packs, 'avatars', OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'missing' });
  });

  it('reports a missing storage root as target_root_missing', async () => {
    const base = path.join(root, 'no-such-root');
    const outcome = await removeTarget({ base, path: path.join(base, OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'error', code: 'target_root_missing' });
  });

  it('refuses a symbolic link at the target and leaves the link and its destination untouched', async () => {
    const destination = path.join(root, 'outside', OBJECT_ID);
    await writeFile(path.join(destination, 'keep.txt'), 'outside');
    const link = path.join(packs, OBJECT_ID);
    await fsp.symlink(destination, link);
    const outcome = await removeTarget({ base: packs, path: link });
    expect(outcome).toEqual({ kind: 'refused', code: 'target_is_symlink' });
    expect((await fsp.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fsp.readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('outside');
  });

  it('refuses a target whose parent folder is a symbolic link leaving the storage root', async () => {
    const outsideAvatars = path.join(root, 'outside', 'avatars');
    await writeFile(path.join(outsideAvatars, OBJECT_ID, 'keep.txt'), 'outside');
    await fsp.symlink(outsideAvatars, path.join(packs, 'avatars'));
    const outcome = await removeTarget({ base: packs, path: path.join(packs, 'avatars', OBJECT_ID) });
    expect(outcome).toEqual({ kind: 'refused', code: 'target_is_symlink' });
    expect((await fsp.lstat(path.join(packs, 'avatars'))).isSymbolicLink()).toBe(true);
    expect(await fsp.readFile(path.join(outsideAvatars, OBJECT_ID, 'keep.txt'), 'utf8')).toBe('outside');
  });
});

describe('fsErrorCode maps file system errors to short stable codes', () => {
  it('maps an errno code to a lower case fs_ code', () => {
    expect(fsErrorCode(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe('fs_eacces');
  });

  it('maps an error without a code to fs_error', () => {
    expect(fsErrorCode(new Error('no code'))).toBe('fs_error');
  });

  it.each(['eacces', 'E-ACCES'])('maps the malformed code %j to fs_error', (code) => {
    expect(fsErrorCode(Object.assign(new Error('malformed'), { code }))).toBe('fs_error');
  });

  it('shortens long codes to 64 characters', () => {
    const code = fsErrorCode(Object.assign(new Error('long'), { code: `E${'A'.repeat(100)}` }));
    expect(code).toHaveLength(64);
    expect(code).toMatch(/^fs_e[a-z]*$/);
  });
});

describe('targetExists reports what sits at the target path', () => {
  it('reports an existing file as present', async () => {
    const file = path.join(packs, OBJECT_ID);
    await writeFile(file, 'pack');
    expect(await targetExists({ base: packs, path: file })).toBe(true);
  });

  it('reports a missing path as absent', async () => {
    expect(await targetExists({ base: packs, path: path.join(packs, OBJECT_ID) })).toBe(false);
  });

  it('reports a dangling symbolic link as present', async () => {
    const link = path.join(packs, OBJECT_ID);
    await fsp.symlink(path.join(root, 'nowhere'), link);
    expect(await targetExists({ base: packs, path: link })).toBe(true);
  });

  it('counts errors other than a missing path as present', async () => {
    const plain = path.join(packs, 'plain.txt');
    await writeFile(plain, 'x');
    expect(await targetExists({ base: packs, path: path.join(plain, 'child') })).toBe(true);
  });
});
