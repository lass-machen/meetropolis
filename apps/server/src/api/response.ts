import type { Response } from 'express';

export type ApiSuccess<T> = { success: true; data: T };
export type ApiError = { success: false; error: { code: string; message: string } };

export function ok<T>(res: Response, data: T, status = 200): Response<ApiSuccess<T>> {
  return res.status(status).json({ success: true, data });
}

export function fail(res: Response, status: number, code: string, message: string): Response<ApiError> {
  return res.status(status).json({ success: false, error: { code, message } });
}


