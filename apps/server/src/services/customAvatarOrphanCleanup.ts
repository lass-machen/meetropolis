/**
 * Register displaced custom-avatar UUIDs under a dot-directory and
 * remove unreferenced PNG pairs only after a 365-day retirement window.
 * Triggered from the compose path; no background service.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { customAvatarDir, deleteCustomAvatarFiles } from './avatarComposer.js';
import { logger } from '../logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETIREMENTS_DIR_NAME = '.custom-avatar-retirements';
export const CUSTOM_AVATAR_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT = 25;

export type CustomAvatarOrphanRefs = {
  /** Which of the candidate UUIDs still have a CustomAvatar row. */
  listPresentCustomAvatarUuids: (uuids: string[]) => Promise<ReadonlySet<string>>;
  /** Re-check CustomAvatar.uuid and User.avatarId before deleting a due UUID. */
  isActivelyReferenced: (uuid: string) => Promise<boolean>;
};

export type RunCustomAvatarOrphanCleanupOptions = {
  packsDir: string;
  refs: CustomAvatarOrphanRefs;
  now?: () => Date;
};

type RetirementRecord = {
  uuid: string;
  retiredAt: string;
};

export function customAvatarRetirementsDir(packsDir: string): string {
  return path.resolve(packsDir, RETIREMENTS_DIR_NAME);
}

function retirementMarkerPath(packsDir: string, uuid: string): string {
  return path.resolve(customAvatarRetirementsDir(packsDir), `${uuid}.json`);
}

async function readRetirementRecord(filePath: string): Promise<RetirementRecord | null> {
  let raw: string;
  try {
    const st = await fs.lstat(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { uuid?: unknown; retiredAt?: unknown };
    if (typeof parsed.uuid !== 'string' || typeof parsed.retiredAt !== 'string') return null;
    if (!UUID_RE.test(parsed.uuid)) return null;
    const retiredAtMs = Date.parse(parsed.retiredAt);
    if (!Number.isFinite(retiredAtMs)) return null;
    return { uuid: parsed.uuid, retiredAt: parsed.retiredAt };
  } catch {
    return null;
  }
}

async function writeRetirementRecordAtomic(packsDir: string, record: RetirementRecord): Promise<void> {
  const dir = customAvatarRetirementsDir(packsDir);
  await fs.mkdir(dir, { recursive: true });
  const target = retirementMarkerPath(packsDir, record.uuid);
  if (!target.startsWith(dir + path.sep)) {
    throw new Error('refusing retirement path outside retirements dir');
  }
  const tmp = path.join(dir, `.${record.uuid}.${randomBytes(8).toString('hex')}.tmp`);
  const body = JSON.stringify({ uuid: record.uuid, retiredAt: record.retiredAt });
  await fs.writeFile(tmp, body, 'utf8');
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Register a displaced UUID. Existing markers keep their original retiredAt. */
export async function registerRetiredCustomAvatar(
  packsDir: string,
  uuid: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (!UUID_RE.test(uuid)) return;
  const marker = retirementMarkerPath(packsDir, uuid);
  const existing = await readRetirementRecord(marker);
  if (existing && existing.uuid === uuid) return;
  await writeRetirementRecordAtomic(packsDir, {
    uuid,
    retiredAt: now().toISOString(),
  });
}

async function listPngPairUuids(packsDir: string): Promise<string[]> {
  const dir = customAvatarDir(packsDir);
  let names: string[];
  try {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return [];
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const uuids: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.png') || name.endsWith('_p.png')) continue;
    const uuid = name.slice(0, -'.png'.length);
    if (!UUID_RE.test(uuid)) continue;
    const sheet = path.resolve(dir, `${uuid}.png`);
    const preview = path.resolve(dir, `${uuid}_p.png`);
    try {
      const sheetSt = await fs.lstat(sheet);
      const previewSt = await fs.lstat(preview);
      if (sheetSt.isSymbolicLink() || previewSt.isSymbolicLink()) continue;
      if (!sheetSt.isFile() || !previewSt.isFile()) continue;
      uuids.push(uuid);
    } catch {
      // incomplete pair or vanished entry
    }
  }
  return uuids;
}

async function registerLegacyOrphans(packsDir: string, refs: CustomAvatarOrphanRefs, now: () => Date): Promise<void> {
  const onDisk = await listPngPairUuids(packsDir);
  if (onDisk.length === 0) return;
  const present = await refs.listPresentCustomAvatarUuids(onDisk);
  for (const uuid of onDisk) {
    if (present.has(uuid)) continue;
    await registerRetiredCustomAvatar(packsDir, uuid, now);
  }
}

async function listDueRetirements(
  packsDir: string,
  nowMs: number,
): Promise<Array<{ uuid: string; retiredAtMs: number; markerPath: string }>> {
  const dir = customAvatarRetirementsDir(packsDir);
  let names: string[];
  try {
    const st = await fs.lstat(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return [];
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const due: Array<{ uuid: string; retiredAtMs: number; markerPath: string }> = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const uuidFromName = name.slice(0, -'.json'.length);
    if (!UUID_RE.test(uuidFromName)) continue;
    const markerPath = path.resolve(dir, name);
    if (!markerPath.startsWith(dir + path.sep)) continue;
    const record = await readRetirementRecord(markerPath);
    if (!record || record.uuid !== uuidFromName) continue;
    const retiredAtMs = Date.parse(record.retiredAt);
    if (!Number.isFinite(retiredAtMs)) continue;
    // Remove only once retiredAt + 365d <= now (boundary inclusive).
    if (retiredAtMs + CUSTOM_AVATAR_RETENTION_MS > nowMs) continue;
    due.push({ uuid: record.uuid, retiredAtMs, markerPath });
  }
  due.sort((a, b) => a.retiredAtMs - b.retiredAtMs || a.uuid.localeCompare(b.uuid));
  return due;
}

async function removeRegularFile(filePath: string): Promise<void> {
  try {
    const st = await fs.lstat(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    await fs.rm(filePath, { force: true });
  } catch {
    // absent is fine
  }
}

async function removeDueUuid(packsDir: string, uuid: string, markerPath: string): Promise<void> {
  // Prefer the shared delete helper for the PNG pair, then drop the marker.
  // Symlinked avatar files are skipped via lstat guards around the helper paths.
  const dir = customAvatarDir(packsDir);
  const sheet = path.resolve(dir, `${uuid}.png`);
  const preview = path.resolve(dir, `${uuid}_p.png`);
  for (const filePath of [sheet, preview]) {
    try {
      const st = await fs.lstat(filePath);
      if (st.isSymbolicLink()) return;
    } catch {
      // missing is ok
    }
  }
  await deleteCustomAvatarFiles(packsDir, uuid);
  await removeRegularFile(markerPath);
}

/**
 * Discover legacy orphans (register with now), then remove up to
 * CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT due, unreferenced retirements.
 */
export async function runCustomAvatarOrphanCleanup(
  options: RunCustomAvatarOrphanCleanupOptions,
): Promise<{ removed: string[] }> {
  const nowFn = options.now ?? (() => new Date());
  const nowMs = nowFn().getTime();
  const removed: string[] = [];

  await registerLegacyOrphans(options.packsDir, options.refs, nowFn);

  const due = await listDueRetirements(options.packsDir, nowMs);
  const batch = due.slice(0, CUSTOM_AVATAR_CLEANUP_BATCH_LIMIT);
  for (const item of batch) {
    let referenced = false;
    try {
      referenced = await options.refs.isActivelyReferenced(item.uuid);
    } catch (err) {
      logger.warn('[customAvatarOrphanCleanup] reference check failed (skipped)', {
        uuid: item.uuid,
        error: String(err),
      });
      continue;
    }
    if (referenced) continue;
    try {
      await removeDueUuid(options.packsDir, item.uuid, item.markerPath);
      removed.push(item.uuid);
    } catch (err) {
      logger.warn('[customAvatarOrphanCleanup] removal failed (non-fatal)', {
        uuid: item.uuid,
        error: String(err),
      });
    }
  }
  return { removed };
}
