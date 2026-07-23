import type { Response } from 'express';

export type ApiSuccess<T> = { success: true; data: T };
export type ApiError = { success: false; error: { code: string; message: string } };

// Express's Response generic is rarely useful for body shape (the framework
// does not enforce it at runtime) and propagates as `any` through downstream
// type inference. Returning the bare `Response` keeps the public contract
// honest and quiet under no-unsafe-return.
export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data } satisfies ApiSuccess<T>);
}

export function fail(res: Response, status: number, code: string, message: string): Response {
  return res.status(status).json({ success: false, error: { code, message } } satisfies ApiError);
}
