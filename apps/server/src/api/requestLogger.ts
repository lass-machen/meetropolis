import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import crypto from 'crypto';

function genId(): string {
  if (typeof (crypto as any).randomUUID === 'function') return (crypto as any).randomUUID();
  return crypto.randomBytes(12).toString('hex');
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const reqId = (req.headers['x-correlation-id'] as string) || genId();
  (req as any).id = reqId;
  res.setHeader('x-correlation-id', reqId);
  try {
    logger.info({ event: 'http.request', id: reqId, method: req.method, path: req.path, ua: (req.headers['user-agent'] || '').toString() });
  } catch {}
  res.on('finish', () => {
    const ms = Date.now() - start;
    try {
      logger.info({ event: 'http.response', id: reqId, method: req.method, path: req.path, status: res.statusCode, durationMs: ms });
    } catch {}
  });
  next();
}


