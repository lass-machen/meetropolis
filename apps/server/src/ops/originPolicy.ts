/**
 * Origin policy: the single place that decides whether a browser origin may
 * talk to this server.
 *
 * The allowlist comes from CORS_ORIGIN and holds exact origins
 * (`scheme://host[:port]`). There is no wildcard, no suffix rule, no host
 * equality and no implicit allowance: an origin is served when it is listed
 * and refused when it is not. Express, the Colyseus matchmaking route and the
 * websocket upgrade all ask this module, so one request cannot be allowed on
 * one path and refused on another.
 *
 * The module is pure: it parses, compares and renders headers. Deciding
 * whether a deployment may start at all belongs to the caller (see
 * `resolveOriginPolicy`).
 */

/** Environment key that holds the comma separated allowlist. */
export const ORIGIN_ENV_KEY = 'CORS_ORIGIN';

/** Request headers a cross-origin request may carry. A fixed list, never echoed. */
// traceparent: the browser telemetry SDK adds it to every fetch and XHR, so a
// preflight without it would fail every API call while telemetry is active.
// X-Asset-Protocol: desktop webviews announce the member-asset protocol version.
// x-signalyr-sdk-*: the same SDK names itself on every relay post; without them
// the browser blocks each event before it reaches the relay.
export const ALLOWED_REQUEST_HEADERS =
  'Origin, X-Requested-With, Content-Type, Accept, Authorization, ' +
  'x-tenant, x-correlation-id, x-av-identity, x-av-room, traceparent, X-Asset-Protocol, ' +
  'x-signalyr-sdk-name, x-signalyr-sdk-version';

/** Methods a cross-origin request may use. */
export const ALLOWED_REQUEST_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/** Response headers a browser may read from a cross-origin response. */
export const EXPOSED_RESPONSE_HEADERS = 'x-correlation-id';

/** How long a browser may cache a preflight answer, in seconds. */
export const ALLOWED_MAX_AGE = '86400';

/**
 * Paths that keep their own CORS contract: the public static assets and the
 * operator tools. They answer without the browser CORS handshake, so the
 * origin policy does not apply to them.
 */
const OWN_CORS_CONTRACT_PREFIXES = ['/packs', '/assets', '/npc-media', '/tools'];

export function keepsOwnCorsContract(pathname: string): boolean {
  return OWN_CORS_CONTRACT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface OriginPolicy {
  /** The configured origins, in configuration order. */
  readonly allowedOrigins: readonly string[];
  /** Whether a concrete Origin header value is allowed. */
  isAllowed(origin: string): boolean;
}

export interface OriginPolicyResolution {
  /** False when the allowlist is missing or invalid: the server must not start. */
  readonly ok: boolean;
  /** The parsed policy. Nothing is allowed when `ok` is false. */
  readonly policy: OriginPolicy;
}

/**
 * `scheme://host[:port]` with a lowercase scheme and a plain host. No path, no
 * query, no fragment, no wildcard, no userinfo and no `null`: a value that does
 * not match is not an origin this server can compare exactly.
 */
const ORIGIN_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/;

export function isValidOrigin(value: string): boolean {
  if (!ORIGIN_PATTERN.test(value)) return false;
  const authority = value.slice(value.indexOf('://') + 3);
  const separator = authority.lastIndexOf(':');
  if (separator === -1) return true;
  const port = Number(authority.slice(separator + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function parseOriginAllowlist(raw: string | undefined): { origins: string[]; invalid: string[] } {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    if (isValidOrigin(entry)) origins.push(entry);
    else invalid.push(entry);
  }
  return { origins, invalid };
}

export function createOriginPolicy(origins: readonly string[]): OriginPolicy {
  const allowed = new Set(origins);
  return {
    allowedOrigins: origins,
    isAllowed: (origin: string) => allowed.has(origin),
  };
}

/**
 * Read the allowlist from the environment. A missing, empty or malformed list
 * is not a startable configuration: the caller must refuse the start and name
 * the key, never the value.
 */
export function resolveOriginPolicy(env: NodeJS.ProcessEnv): OriginPolicyResolution {
  const raw = env[ORIGIN_ENV_KEY];
  const { origins, invalid } = parseOriginAllowlist(raw);
  const usable = raw !== undefined && raw.trim() !== '' && origins.length > 0 && invalid.length === 0;
  if (!usable) return { ok: false, policy: createOriginPolicy([]) };
  return { ok: true, policy: createOriginPolicy(origins) };
}

/**
 * The CORS headers for a request that carries `origin`, or none at all when
 * the origin is not allowed. A request without an origin (native clients,
 * webhooks, health checks) gets no CORS headers: the route's own auth decides.
 *
 * `Vary: Origin` is not part of the record: the caller adds it, because the
 * answer differs per origin and an existing Vary header must be extended
 * rather than replaced.
 */
export function corsHeadersFor(origin: string | null | undefined, policy: OriginPolicy): Record<string, string> {
  if (origin === null || origin === undefined || origin === '' || !policy.isAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_REQUEST_METHODS,
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS,
  };
}

/**
 * Whether a websocket upgrade may proceed. An upgrade without an origin is
 * left to the matchmaking auth and the seat reservation; an upgrade that
 * carries an origin is only allowed when the origin is listed.
 */
export function isUpgradeOriginAllowed(policy: OriginPolicy, origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  return policy.isAllowed(origin);
}
