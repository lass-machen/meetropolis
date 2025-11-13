import type { Room, IBroadcastOptions } from 'colyseus';
import { logger } from '../logger.js';

export function safeBroadcast<T>(room: Room, type: string, payload: T, options?: IBroadcastOptions) {
  try {
    room.broadcast(type, payload as any, options as any);
  } catch (e: any) {
    try { logger.debug('[Rooms] broadcast failed', { type, error: e?.message || String(e) }); } catch {}
  }
}


