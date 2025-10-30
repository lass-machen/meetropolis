import { logger } from './logger';
import { buildCorrelationHeaders, getCorrelationSessionId } from './correlation';

type AvLevel = 'debug' | 'info' | 'warn' | 'error';

// Simple rate limiter to avoid console spam for high-frequency debug events
const lastLogAtMs = new Map<string, number>();
const DEBUG_MIN_INTERVAL_MS = 1500;

export function avLog(level: AvLevel, event: string, details?: Record<string, unknown>, extra?: { identity?: string; roomName?: string }) {
  const corr = {
    correlationId: getCorrelationSessionId(),
    identity: extra?.identity || undefined,
    roomName: extra?.roomName || undefined,
  } as Record<string, unknown>;
  const payload = { event, ...corr, ...(details || {}) };
  try {
    if (level === 'debug') {
      const key = event;
      const now = Date.now();
      const last = lastLogAtMs.get(key) || 0;
      if (now - last < DEBUG_MIN_INTERVAL_MS) return;
      lastLogAtMs.set(key, now);
    }
  } catch {}
  try {
    (logger as any)[level]('[AV]', payload);
  } catch {
    try { logger.info('[AV]', payload); } catch {}
  }
}

export { buildCorrelationHeaders };


