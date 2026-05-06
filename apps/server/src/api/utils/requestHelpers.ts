import type { Request } from 'express';

/**
 * Express 5 / @types/express@5 typen `req.params[k]` als `string | string[]`,
 * weil path-to-regexp@8 Wildcard-Splats (`/foo/*splat`) unterstützt, die
 * mehrere Pfadsegmente als Array liefern.
 *
 * In diesem Repo werden ausschließlich benannte Single-Segment-Params
 * (`:id`, `:objId`, `:userId`, …) verwendet. Praktisch ist der Wert daher
 * immer ein einzelner String — nie ein Array.
 *
 * Dieser Helper kapselt den Cast an einer Stelle und bewahrt die runtime
 * sicher: falls Express je doch ein Array liefern sollte (z. B. wenn jemand
 * eine Wildcard-Route hinzufügt), wird das erste Segment genommen.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
