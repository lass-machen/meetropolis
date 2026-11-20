import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { logger } from '../logger.js';
import { customAvatarPacksDir, customAvatarDir } from './avatarComposer.js';
import { npcMediaDir } from '../api/routes/npcMedia.js';

/** The tenant's NPC media directory, or null when the slug would leave the storage root. */
export function tenantNpcMediaDir(tenantSlug: string): string | null {
  return resolveInside(npcMediaDir(), tenantSlug);
}

/**
 * File cleanup for a deleted tenant. Removes pack directories (tenant-owned
 * packs only — catalogue packs belong to no tenant and are never passed in),
 * the tenant's NPC media directory and the tenant-scoped custom avatar files.
 * Storage roots are resolved exactly like the routes that write them
 * (ASSET_PACKS_DIR like assetPacks.ts/avatarComposer.ts, NPC_MEDIA_DIR like
 * npcMedia.ts); when resolution differs, files stay behind and are logged
 * instead of deleted.
 */

/** Resolve `segments` under `base`, or null when a segment escapes it. */
export function resolveInside(base: string, ...segments: string[]): string | null {
  if (segments.some((s) => s.length === 0 || s === '..' || s.includes('/') || s.includes('\\'))) {
    return null;
  }
  const resolved = path.resolve(base, ...segments);
  const relative = path.relative(base, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function removePath(resolved: string | null, tenantSlug: string, kind: string): Promise<void> {
  if (resolved === null) {
    logger.warn({ event: 'tenant.files_cleanup_refused', tenantSlug, kind });
    return;
  }
  try {
    await fsp.rm(resolved, { recursive: true, force: true });
  } catch (error) {
    logger.warn({ event: 'tenant.files_cleanup_failed', tenantSlug, kind, error: String(error) });
  }
}

/** Delete the tenant's files. Never throws. */
export async function removeTenantFiles(params: {
  tenantSlug: string;
  assetPackUuids: string[];
  avatarPackUuids: string[];
  customAvatarUuids: string[];
  npcIds: string[];
}): Promise<void> {
  const { tenantSlug } = params;
  const packsDir = customAvatarPacksDir();
  for (const uuid of params.assetPackUuids) {
    await removePath(resolveInside(packsDir, uuid), tenantSlug, 'pack');
  }
  for (const uuid of params.avatarPackUuids) {
    await removePath(resolveInside(packsDir, 'avatars', uuid), tenantSlug, 'pack');
  }
  await removePath(tenantNpcMediaDir(tenantSlug), tenantSlug, 'npc');
  const avatarDir = customAvatarDir(packsDir);
  for (const uuid of params.customAvatarUuids) {
    await removePath(resolveInside(avatarDir, `${uuid}.png`), tenantSlug, 'avatar');
    await removePath(resolveInside(avatarDir, `${uuid}_p.png`), tenantSlug, 'avatar');
  }
}
