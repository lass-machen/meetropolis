import { logger } from './logger.js';

/**
 * Resolve the Express `trust proxy` setting from `TRUST_PROXY`.
 *
 * `req.ip` (used for request logging and IP-based rate limiting, see
 * api/middleware/rateLimit.ts) is only trustworthy when this matches the
 * deployment topology. Behind a reverse proxy prefer a numeric hop count
 * (e.g. `1` for a single Traefik in front): Express then derives `req.ip` from
 * the proxy-verified end of `X-Forwarded-For`, which a client cannot spoof.
 * `true` trusts the entire forwarded chain and is permissive — a client can
 * forge its IP and bypass IP-based rate limiting, which
 * api/middleware/rateLimit.trustProxy.test.ts demonstrates rather than
 * asserts; `false` disables proxy trust for direct connections.
 *
 * Accepted values: a non-negative integer (hop count), `true` or `false`.
 * When unset the default is unchanged — trust the chain in production, none
 * otherwise; an unrecognized value falls back to that same default with a
 * warning.
 */
export function resolveTrustProxySetting(): boolean | number {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  const fallback = process.env.NODE_ENV === 'production';
  if (raw === '') return fallback;
  if (raw.toLowerCase() === 'true') return true;
  if (raw.toLowerCase() === 'false') return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  logger.warn({ event: 'trust_proxy.invalid_value', value: raw, fallback });
  return fallback;
}
