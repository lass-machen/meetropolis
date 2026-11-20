/**
 * Member-asset protocol: client/server compatibility marker.
 *
 * Clients that load protected pack and NPC media files through the
 * authenticated member-asset endpoint announce the protocol version they
 * implement. Desktop apps without this marker still request the legacy
 * public paths and are asked to update once enforcement is switched on.
 *
 * The marker is a compatibility statement, not a credential: it never
 * grants access to anything. Authorization of every byte request stays
 * with the session and membership checks on the server.
 */
export const ASSET_PROTOCOL_VERSION = 1;

/** Minimum asset protocol a desktop client must announce once enforcement is on. */
export const MIN_ASSET_PROTOCOL_VERSION = 1;

/** HTTP request header carrying the asset protocol version. */
export const ASSET_PROTOCOL_HEADER = 'X-Asset-Protocol';

/** Colyseus join option carrying the asset protocol version. */
export const ASSET_PROTOCOL_JOIN_OPTION = 'assetProtocol';

/** Machine-readable error code of the HTTP 426 response. */
export const CLIENT_UPDATE_REQUIRED_CODE = 'client_update_required';

/**
 * Origins of the desktop app webviews (macOS/Linux and Windows WebView2).
 * A request counts as desktop only if its origin is one of these AND the
 * origin is on the configured allowlist; the origin is never authentication.
 */
export const DESKTOP_APP_ORIGINS: readonly string[] = ['tauri://localhost', 'http://tauri.localhost'];

/**
 * Parse an announced asset protocol version from a header or join option.
 * Accepts a positive integer as number or decimal string; anything else
 * (missing, empty, negative, fractional, non-numeric) yields null.
 */
export function parseAssetProtocolVersion(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,8}$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}
