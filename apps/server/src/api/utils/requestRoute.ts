import type { Request } from 'express';

/**
 * Bestimmt das Routen-Template eines Requests für Logs und Metriklabels.
 *
 * Gibt bei bekanntem Routen-Template `baseUrl + route.path` zurück, sonst
 * exakt `"<unmatched>"`. Es werden ausschließlich `baseUrl` und ein
 * stringförmiges `route.path` gelesen; konkrete Pfade, URLs, Parameter und
 * Querystrings fließen nie ein. Vor dem Routing ist die Route noch nicht
 * bekannt, daher meldet ein früher Aufruf `"<unmatched>"`.
 */
export function getRequestRouteTemplate(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return `${req.baseUrl}${route.path}`;
  return '<unmatched>';
}
