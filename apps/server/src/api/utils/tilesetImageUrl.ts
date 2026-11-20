const MAX_TILESET_IMAGE_URL_LENGTH = 2048;

const ALLOWED_PATH_PATTERNS = [
  /^\/assets\/[^/]/,
  /^\/packs\/[A-Za-z0-9_-]+\/[^/]/,
  /^\/member-assets\/v1\/packs\/[A-Za-z0-9_-]+\/[^/]/,
];

/** Dot segments, encoded dots or separators, backslashes, query and fragment are never part of an asset path. */
function hasPathTricks(value: string): boolean {
  if (/[\\?#]/.test(value)) return true;
  if (/%(2e|2f|5c)/i.test(value)) return true;
  return value.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * Normalizes a tileset image reference to a same-origin asset path.
 *
 * Clients send their API base in front of the path, so absolute http(s) URLs
 * are accepted, but only their path is kept: the origin is dropped and no
 * client is ever pointed at another host. Returns null for anything that is
 * not a plain path under /assets/, /packs/<uuid>/ or /member-assets/v1/packs/<uuid>/.
 */
export function normalizeTilesetImageUrl(raw: string): string | null {
  if (raw.length > MAX_TILESET_IMAGE_URL_LENGTH || hasPathTricks(raw)) return null;
  let pathname: string;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return null;
    }
    const rawPath = raw.replace(/^https?:\/\/[^/]*/i, '');
    if (rawPath !== pathname) return null;
  } else {
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    pathname = raw;
  }
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) ? pathname : null;
}
