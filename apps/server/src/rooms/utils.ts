import { logger } from '../logger.js';

export function safeBroadcast<T>(
  room: { broadcast: (type: string, message?: unknown, options?: unknown) => void },
  type: string,
  payload: T,
  options?: { except?: unknown }
) {
  try {
    room.broadcast(type, payload as any, options as any);
  } catch (e: unknown) {
    try { logger.debug('[Rooms] broadcast failed', { type, error: e instanceof Error ? e.message : String(e) || String(e) }); } catch {}
  }
}


