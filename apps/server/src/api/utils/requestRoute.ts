import type { Request } from 'express';

/**
 * Returns a route template for request logs and metric labels.
 *
 * Uses only baseUrl and a string route.path; concrete request paths, URLs,
 * parameters and query strings are never read. Requests without a route
 * template produce `"<unmatched>"`. Early http.request logs omit the path
 * field.
 */
export function getRequestRouteTemplate(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return `${req.baseUrl}${route.path}`;
  return '<unmatched>';
}
