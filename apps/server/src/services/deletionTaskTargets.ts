import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { PrismaClient } from '../generated/prisma/index.js';
import { npcMediaDir } from '../api/routes/npcMedia.js';
import { customAvatarDir, customAvatarPacksDir } from './avatarComposer.js';
import { resolveInside, tenantNpcMediaDir } from './tenantFiles.js';

/** The fields of a deletion task that decide which files it owns. */
export interface DeletionTaskTargetInput {
  kind: string;
  targetSystem: string;
  objectId: string;
  storageKey: string | null;
}

/** One path to remove. `base` is the storage root that must contain the parent of `path`. */
export interface ResolvedTarget {
  base: string;
  path: string;
}

export type TargetDefectCode = 'unknown_task_kind' | 'unknown_target_system' | 'invalid_target' | 'inconsistent_target';

export type TargetResolution = { ok: true; targets: ResolvedTarget[] } | { ok: false; code: TargetDefectCode };

export type RemovalOutcome =
  | { kind: 'removed' }
  | { kind: 'missing' }
  | { kind: 'refused'; code: 'target_is_symlink' }
  | { kind: 'error'; code: string };

function storageKeyDefect(task: DeletionTaskTargetInput): TargetDefectCode | null {
  return task.storageKey !== null && task.storageKey !== task.objectId ? 'inconsistent_target' : null;
}

function singleTarget(base: string, target: string | null): TargetResolution {
  if (target === null) return { ok: false, code: 'invalid_target' };
  return { ok: true, targets: [{ base, path: target }] };
}

function resolveAssetPack(task: DeletionTaskTargetInput, packsDir: string): TargetResolution {
  const defect = storageKeyDefect(task);
  if (defect !== null) return { ok: false, code: defect };
  return singleTarget(packsDir, resolveInside(packsDir, task.objectId));
}

function resolveAvatarPack(task: DeletionTaskTargetInput, packsDir: string): TargetResolution {
  const defect = storageKeyDefect(task);
  if (defect !== null) return { ok: false, code: defect };
  return singleTarget(packsDir, resolveInside(packsDir, 'avatars', task.objectId));
}

function resolveCustomAvatar(task: DeletionTaskTargetInput, packsDir: string): TargetResolution {
  const defect = storageKeyDefect(task);
  if (defect !== null) return { ok: false, code: defect };
  const dir = customAvatarDir(packsDir);
  const owner = resolveInside(dir, task.objectId);
  const sprite = resolveInside(dir, `${task.objectId}.png`);
  const preview = resolveInside(dir, `${task.objectId}_p.png`);
  if (owner === null || sprite === null || preview === null) return { ok: false, code: 'invalid_target' };
  return {
    ok: true,
    targets: [
      { base: packsDir, path: sprite },
      { base: packsDir, path: preview },
    ],
  };
}

function resolveNpcMedia(task: DeletionTaskTargetInput): TargetResolution {
  if (task.storageKey === null) return { ok: false, code: 'invalid_target' };
  return singleTarget(npcMediaDir(), tenantNpcMediaDir(task.storageKey));
}

/**
 * Maps a task to the files it owns. Storage roots are read on every call, not at import time.
 */
export function resolveTaskTargets(task: DeletionTaskTargetInput): TargetResolution {
  if (task.kind !== 'file') return { ok: false, code: 'unknown_task_kind' };
  const packsDir = customAvatarPacksDir();
  switch (task.targetSystem) {
    case 'asset_packs':
      return resolveAssetPack(task, packsDir);
    case 'avatar_packs':
      return resolveAvatarPack(task, packsDir);
    case 'custom_avatars':
      return resolveCustomAvatar(task, packsDir);
    case 'npc_media':
      return resolveNpcMedia(task);
    default:
      return { ok: false, code: 'unknown_target_system' };
  }
}

/**
 * True while a live row still points at the task's object. An unknown target system or a
 * missing storage key counts as referenced (fail closed).
 */
export async function hasLiveReference(prisma: PrismaClient, task: DeletionTaskTargetInput): Promise<boolean> {
  const { objectId, storageKey } = task;
  switch (task.targetSystem) {
    case 'asset_packs':
      return (await prisma.assetPack.findFirst({ where: { uuid: objectId }, select: { id: true } })) !== null;
    case 'avatar_packs':
      return (await prisma.avatarPack.findFirst({ where: { uuid: objectId }, select: { id: true } })) !== null;
    case 'custom_avatars':
      return (await prisma.customAvatar.findFirst({ where: { uuid: objectId }, select: { id: true } })) !== null;
    case 'npc_media':
      if (storageKey === null) return true;
      return (await prisma.tenant.findFirst({ where: { slug: storageKey }, select: { id: true } })) !== null;
    default:
      return true;
  }
}

/** Codes of file system errors are short and lower case, for example `fs_enoent`. */
export function fsErrorCode(error: unknown): string {
  const code = errnoCode(error);
  if (code === null || !/^E[A-Z0-9]+$/.test(code)) return 'fs_error';
  return `fs_${code.toLowerCase()}`.slice(0, 64);
}

function errnoCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

async function realRoot(base: string): Promise<string | RemovalOutcome> {
  try {
    const real = await fsp.realpath(base);
    const stat = await fsp.stat(real);
    if (!stat.isDirectory()) return { kind: 'error', code: 'target_root_missing' };
    return real;
  } catch (error) {
    const code = fsErrorCode(error);
    return { kind: 'error', code: code === 'fs_enoent' ? 'target_root_missing' : code };
  }
}

/**
 * Removes the target once its parent resolves to the expected place under the real storage
 * root and the target itself is not a symbolic link.
 */
export async function removeTarget(target: ResolvedTarget): Promise<RemovalOutcome> {
  const root = await realRoot(target.base);
  if (typeof root !== 'string') return root;
  const parent = path.dirname(target.path);
  try {
    const expected = path.join(root, path.relative(target.base, parent));
    if ((await fsp.realpath(parent)) !== expected) return { kind: 'refused', code: 'target_is_symlink' };
    if ((await fsp.lstat(target.path)).isSymbolicLink()) return { kind: 'refused', code: 'target_is_symlink' };
    await fsp.rm(target.path, { recursive: true, force: true });
    return { kind: 'removed' };
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { kind: 'missing' };
    return { kind: 'error', code: fsErrorCode(error) };
  }
}

/** True when something sits at the target path. Errors other than ENOENT count as present (fail closed). */
export async function targetExists(target: ResolvedTarget): Promise<boolean> {
  try {
    await fsp.lstat(target.path);
    return true;
  } catch (error) {
    return errnoCode(error) !== 'ENOENT';
  }
}
