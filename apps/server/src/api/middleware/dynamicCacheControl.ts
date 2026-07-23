import type express from 'express';

/**
 * Path prefixes that serve dynamic, tenant- or account-scoped data (pricing
 * plans, runtime config, billing status, admin stats/settings). These routes
 * already send an `ETag`, but without an explicit `Cache-Control` directive
 * browsers are free to cache the response heuristically and keep serving a
 * stale copy for a long time — e.g. a user who still saw the old, empty
 * pricing page after the catalog had been populated. Asset/map/pack routes
 * (which intentionally cache for a long time, e.g. `/packs`, `/assets`) are
 * deliberately excluded.
 */
const DYNAMIC_API_PREFIXES = ['/public', '/billing', '/admin'];

function matchesDynamicPrefix(path: string): boolean {
  return DYNAMIC_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Forces revalidation on every response under /public, /billing or /admin by
 * setting `Cache-Control: no-cache`. This still permits the browser to cache
 * the response body, but it must revalidate against the server (via the
 * ETag these routes already send) before reusing it — cheap thanks to 304s,
 * and always fresh.
 *
 * Applied defensively to every HTTP method on these prefixes; GET/HEAD is the
 * case that matters in practice, and the directive is harmless on write
 * methods. Must run before route registration so the header is present on
 * the final response, but a route handler further down the chain is free to
 * call `res.setHeader('Cache-Control', ...)` again to override it (e.g. for
 * a route that legitimately wants a different directive).
 */
export const dynamicApiCacheControl: express.RequestHandler = (req, res, next) => {
  if (matchesDynamicPrefix(req.path)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  next();
};
