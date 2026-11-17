/**
 * Desktop client-compatibility gate for the protected member assets.
 *
 * Desktop webviews announce the asset protocol version they implement in
 * the `X-Asset-Protocol` header. While `MEMBER_ASSETS_ENFORCE` is not
 * exactly `true`, every request passes through. Once enforced, a request
 * from a desktop origin without a current protocol version is answered
 * with 426 and a machine-readable update code; the client shows its
 * existing update hint. Web origins, health checks and the desktop bundle
 * paths never carry the marker and always pass through.
 */
import type { RequestHandler } from 'express';
import {
  ASSET_PROTOCOL_HEADER,
  CLIENT_UPDATE_REQUIRED_CODE,
  DESKTOP_APP_ORIGINS,
  MIN_ASSET_PROTOCOL_VERSION,
  parseAssetProtocolVersion,
} from '@meetropolis/shared';
import type { OriginPolicy } from './originPolicy.js';

/** Environment key that switches the 426 enforcement on. */
export const MEMBER_ASSETS_ENFORCE_ENV_KEY = 'MEMBER_ASSETS_ENFORCE';

/** Exact body text of the 426 response, shown by the desktop update hint. */
export const CLIENT_UPDATE_REQUIRED_MESSAGE =
  'Bitte aktualisieren. Diese Desktop-Version unterstützt die geschützten Dateien noch nicht. ' +
  'Öffne den vorhandenen Update-Hinweis und wähle ›Jetzt aktualisieren‹. ' +
  'Falls kein Update angezeigt wird, starte die App neu.';

/** True only for the exact opt-in value; every other value stays unenforced. */
export function isMemberAssetsEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MEMBER_ASSETS_ENFORCE_ENV_KEY] === 'true';
}

/**
 * True when the origin is a desktop webview origin AND that origin is on
 * the configured allowlist. Either condition alone never marks a request
 * as desktop: an unlisted origin may be spoofed, and a listed non-desktop
 * origin is a browser.
 */
export function isDesktopAppOrigin(origin: string | null | undefined, policy: OriginPolicy): boolean {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  return DESKTOP_APP_ORIGINS.includes(origin) && policy.isAllowed(origin);
}

/**
 * True when the client must update: a desktop request whose announced
 * protocol version is missing or older than the enforced minimum.
 */
export function needsAssetProtocolUpdate(
  origin: string | null | undefined,
  announced: unknown,
  policy: OriginPolicy,
): boolean {
  if (!isDesktopAppOrigin(origin, policy)) return false;
  return (parseAssetProtocolVersion(announced) ?? 0) < MIN_ASSET_PROTOCOL_VERSION;
}

/** Paths that never carry the protocol marker and always pass through. */
const EXEMPT_EXACT_PATHS: readonly string[] = ['/health', '/healthz', '/readyz'];

/** Prefix of the desktop bundle paths served by this server. */
const DESKTOP_PATH_PREFIX = '/desktop/';

export interface ClientCompatibilityOptions {
  policy: OriginPolicy;
  isEnforced?: () => boolean;
}

/**
 * Express middleware answering outdated desktop clients with 426. The
 * default `isEnforced` reads the environment on every request so tests
 * and operators can flip the switch without a restart.
 */
export function createClientCompatibilityMiddleware(opts: ClientCompatibilityOptions): RequestHandler {
  const isEnforced = opts.isEnforced ?? (() => isMemberAssetsEnforced());
  return (req, res, next) => {
    if (!isEnforced()) {
      next();
      return;
    }
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    if (req.path === DESKTOP_PATH_PREFIX || req.path.startsWith(DESKTOP_PATH_PREFIX)) {
      next();
      return;
    }
    if (EXEMPT_EXACT_PATHS.includes(req.path)) {
      next();
      return;
    }
    if (needsAssetProtocolUpdate(req.headers.origin, req.get(ASSET_PROTOCOL_HEADER), opts.policy)) {
      res.status(426).set('Cache-Control', 'no-store').json({
        error: CLIENT_UPDATE_REQUIRED_MESSAGE,
        code: CLIENT_UPDATE_REQUIRED_CODE,
        minAssetProtocol: MIN_ASSET_PROTOCOL_VERSION,
      });
      return;
    }
    next();
  };
}
