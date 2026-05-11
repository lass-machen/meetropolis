import type { Request } from 'express';

/**
 * Express 5 / @types/express@5 type `req.params[k]` as `string | string[]`
 * because path-to-regexp@8 supports wildcard splats (`/foo/*splat`) that
 * deliver multiple path segments as an array.
 *
 * This repo only uses named single-segment params (`:id`, `:objId`,
 * `:userId`, ...). The value is therefore always a single string, never an
 * array.
 *
 * This helper centralises the cast while keeping runtime safety: if Express
 * ever returns an array (for example after someone adds a wildcard route),
 * the first segment is used.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
