/**
 * Central member-asset adapter (web client).
 *
 * Stored references in cards and manifests keep the legacy shapes
 * `/packs/<rest>` and `/npc-media/<rest>`. The server only serves the
 * protected bytes below `<apiBase>/member-assets/v1/...`, and Phaser and
 * `<img>` cannot send auth headers, so this adapter fetches the bytes
 * itself (the session cookie travels via `credentials: 'include'`, the
 * desktop shell replays its bearer token through its own fetch
 * interceptor) and hands out a blob URL for rendering.
 */

import { ASSET_PROTOCOL_HEADER, ASSET_PROTOCOL_VERSION } from '@meetropolis/shared';
import { getApiBaseFromWindow } from './runtimeConfig';

/** Failure of a member-asset byte request. `status` is the HTTP status, or 0 when no response arrived. */
export class MemberAssetError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Member asset request failed with status ${status}`);
    this.name = 'MemberAssetError';
    this.status = status;
  }
}

const PACK_PREFIX = '/packs/';
const NPC_MEDIA_PREFIX = '/npc-media/';
const MEMBER_BASE_PATH = '/member-assets/v1';

type MemberAssetKind = 'packs' | 'npc-media';

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '');
}

/** True for a literal `..` segment or an encoded dot-dot / slash (`%2e`, `%2f`, any case). */
function hasTraversal(path: string): boolean {
  if (/%2e|%2f/i.test(path)) return true;
  return path.split('/').includes('..');
}

function buildMemberUrl(kind: MemberAssetKind, rest: string, apiBase: string): string | null {
  if (!rest || hasTraversal(`/${rest}`)) return null;
  return `${stripTrailingSlashes(apiBase)}${MEMBER_BASE_PATH}/${kind}/${rest}`;
}

function matchLegacyPath(path: string): { kind: MemberAssetKind; rest: string } | null {
  if (path.startsWith(PACK_PREFIX)) return { kind: 'packs', rest: path.slice(PACK_PREFIX.length) };
  if (path.startsWith(NPC_MEDIA_PREFIX)) {
    return { kind: 'npc-media', rest: path.slice(NPC_MEDIA_PREFIX.length) };
  }
  return null;
}

function dropQueryAndFragment(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * Translate a stored asset reference into the protected member-asset URL.
 * Accepts `/packs/<rest>`, `/npc-media/<rest>` and the same paths as an
 * absolute URL on exactly the apiBase origin. Drops query and fragment.
 * Returns null for anything else.
 */
export function toMemberAssetUrl(ref: string): string | null {
  if (!ref || ref.startsWith('//')) return null;
  const apiBase = stripTrailingSlashes(getApiBaseFromWindow());
  if (ref.startsWith('/')) {
    const matched = matchLegacyPath(dropQueryAndFragment(ref));
    if (!matched) return null;
    return buildMemberUrl(matched.kind, matched.rest, apiBase);
  }
  let parsed: URL;
  try {
    parsed = new URL(ref);
  } catch {
    return null;
  }
  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin) return null;
  const basePath = stripTrailingSlashes(base.pathname);
  let path = parsed.pathname;
  if (basePath) {
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
    path = path.slice(basePath.length);
  }
  const matched = matchLegacyPath(path);
  if (!matched) return null;
  return buildMemberUrl(matched.kind, matched.rest, apiBase);
}

/** True when the reference points at a protected member asset. */
export function isMemberAssetRef(ref: string): boolean {
  return toMemberAssetUrl(ref) !== null;
}

export interface AcquiredMemberAsset {
  url: string;
  release: () => void;
}

interface MemberAssetEntry {
  refCount: number;
  objectUrl: string | null;
  promise: Promise<string> | null;
  controller: AbortController | null;
  generation: number;
}

let generation = 0;
const entries = new Map<string, MemberAssetEntry>();

function failEntry(ref: string, entry: MemberAssetEntry, status: number, message: string): never {
  if (entries.get(ref) === entry && entry.objectUrl === null) entries.delete(ref);
  throw new MemberAssetError(status, message);
}

/**
 * Load a member asset and hand out a blob URL with reference counting.
 * Non-member refs pass through untouched without any fetch. Shares one
 * inflight request and one blob URL per ref within the same generation;
 * `release()` drops a reference and revokes the blob URL at zero.
 */
export async function acquireMemberAsset(ref: string, opts?: { signal?: AbortSignal }): Promise<AcquiredMemberAsset> {
  const memberUrl = toMemberAssetUrl(ref);
  if (memberUrl === null) return { url: ref, release: () => {} };

  const current = entries.get(ref);
  if (current && current.generation === generation && current.promise) {
    current.refCount += 1;
    return wrapEntry(ref, current, current.promise);
  }

  const controller = new AbortController();
  const entry: MemberAssetEntry = {
    refCount: 1,
    objectUrl: null,
    promise: null,
    controller,
    generation,
  };
  entries.set(ref, entry);
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const pending: Promise<string> = (async (): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(memberUrl, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: { [ASSET_PROTOCOL_HEADER]: String(ASSET_PROTOCOL_VERSION) },
      });
    } catch {
      failEntry(ref, entry, 0, `Member asset request failed for ${ref}`);
    }
    if (entry.generation !== generation) {
      failEntry(ref, entry, 0, `Member asset request for ${ref} was superseded by reset`);
    }
    if (!response.ok)
      failEntry(ref, entry, response.status, `Member asset request failed with status ${response.status}`);
    const blob = await response.blob();
    if (entry.generation !== generation) {
      failEntry(ref, entry, 0, `Member asset request for ${ref} was superseded by reset`);
    }
    const objectUrl = URL.createObjectURL(blob);
    entry.objectUrl = objectUrl;
    entry.controller = null;
    return objectUrl;
  })();
  entry.promise = pending;

  return wrapEntry(ref, entry, pending);
}

async function wrapEntry(ref: string, entry: MemberAssetEntry, promise: Promise<string>): Promise<AcquiredMemberAsset> {
  const url = await promise;
  let released = false;
  return {
    url,
    release: () => {
      if (released) return;
      released = true;
      if (entries.get(ref) !== entry) return;
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      entries.delete(ref);
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
        entry.objectUrl = null;
      }
    },
  };
}

/**
 * Invalidate every cached and inflight member asset: abort running
 * requests, revoke all blob URLs, drop all entries. A request that
 * finishes after the reset stores nothing and fails with status 0.
 */
export function resetMemberAssets(): void {
  generation += 1;
  for (const entry of entries.values()) {
    try {
      entry.controller?.abort();
    } catch {
      /* ignore: already settled */
    }
    if (entry.objectUrl) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch {
        /* ignore: already revoked */
      }
      entry.objectUrl = null;
    }
  }
  entries.clear();
}
