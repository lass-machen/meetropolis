import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const isProd = process.env.NODE_ENV === 'production';
  // Normalize error
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const code = 'INTERNAL_ERROR';
  try {
    logger.error({ event: 'http.error', code, message: err instanceof Error ? err.message : String(err) });
  } catch {}
  res.status(500).json({
    success: false,
    error: {
      code,
      message: isProd ? 'Internal Server Error' : message,
    },
  });
}


