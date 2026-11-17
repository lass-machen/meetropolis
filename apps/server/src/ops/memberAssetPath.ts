/**
 * Path checks for member-served files under /packs and /npc-media.
 *
 * No authorization here: only shape checks (namespace, UUID/key format,
 * traversal rejection) and containment checks (realpath inside a root).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type MemberAssetNamespace = 'packs' | 'npc-media';
export type MemberAssetTarget =
  | { kind: 'asset-pack'; packUuid: string; relativePath: string }
  | { kind: 'avatar-pack'; packUuid: string; relativePath: string }
  | { kind: 'custom-avatar'; avatarUuid: string; variant: 'sprite' | 'preview'; relativePath: string }
  | { kind: 'npc-media'; storagePath: string; relativePath: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Upload charset for avatar-pack keys (avatarPacks.ts handleSpriteUpload).
const AVATAR_PACK_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Decode one segment; reject on encoding errors and dangerous content.
function decodeSegment(raw: string): string | null {
  if (raw === '' || raw === '.' || raw === '..' || raw.startsWith('.')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  for (const ch of decoded) {
    if (ch === '/' || ch === '\\' || ch === '%' || ch < ' ') return null;
  }
  return decoded;
}

export function parseMemberAssetPath(namespace: MemberAssetNamespace, rawPath: string): MemberAssetTarget | null {
  if (rawPath === '') return null;
  const segments = rawPath.split('/').map(decodeSegment);
  if (segments.includes(null)) return null;
  const parts = segments as string[];
  const relativePath = parts.join('/');

  if (namespace === 'packs') {
    if (parts[0] === 'avatars') {
      // Custom-avatar rule first: 'custom' never falls through to avatar-pack.
      if (parts[1] === 'custom') {
        if (parts.length !== 3) return null;
        const file = parts[2];
        if (file.endsWith('_p.png')) {
          const stem = file.slice(0, -'_p.png'.length);
          if (!UUID_RE.test(stem)) return null;
          return { kind: 'custom-avatar', avatarUuid: stem.toLowerCase(), variant: 'preview', relativePath };
        }
        if (file.endsWith('.png')) {
          const stem = file.slice(0, -'.png'.length);
          if (!UUID_RE.test(stem)) return null;
          return { kind: 'custom-avatar', avatarUuid: stem.toLowerCase(), variant: 'sprite', relativePath };
        }
        return null;
      }
      if (parts.length === 3 && AVATAR_PACK_KEY_RE.test(parts[1])) {
        return { kind: 'avatar-pack', packUuid: parts[1], relativePath };
      }
      return null;
    }
    if (parts[0] !== undefined && UUID_RE.test(parts[0]) && parts.length >= 2) {
      return { kind: 'asset-pack', packUuid: parts[0], relativePath };
    }
    return null;
  }

  if (parts.length !== 3) return null;
  return { kind: 'npc-media', storagePath: relativePath, relativePath };
}

export async function resolveFileInRoot(root: string, relativePath: string): Promise<string | null> {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, relativePath);
  if (!candidate.startsWith(realRoot + path.sep)) return null;
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return null;
    }
    throw err;
  }
  if (!real.startsWith(realRoot + path.sep)) return null;
  const stat = await fs.stat(real);
  if (!stat.isFile()) return null;
  return real;
}
