import type Colyseus from 'colyseus';
import { logger } from '../logger.js';

export function safeBroadcast<T>(room: Colyseus.Room, type: string, payload: T, options?: Parameters<Colyseus.Room['broadcast']>[2]) {
  try {
    room.broadcast(type, payload as any, options as any);
  } catch (e: any) {
    try { logger.debug('[Rooms] broadcast failed', { type, error: e?.message || String(e) }); } catch {}
  }
}


