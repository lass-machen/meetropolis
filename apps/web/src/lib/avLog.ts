import { logger } from './logger';
import { buildCorrelationHeaders, getCorrelationSessionId } from './correlation';

type AvLevel = 'debug' | 'info' | 'warn' | 'error';

export function avLog(level: AvLevel, event: string, details?: Record<string, unknown>, extra?: { identity?: string; roomName?: string }) {
  const corr = {
    correlationId: getCorrelationSessionId(),
    identity: extra?.identity || undefined,
    roomName: extra?.roomName || undefined,
  } as Record<string, unknown>;
  const payload = { event, ...corr, ...(details || {}) };
  try {
    (logger as any)[level]('[AV]', payload);
  } catch {
    try { logger.info('[AV]', payload); } catch {}
  }
}

export { buildCorrelationHeaders };


