import { Client, Room } from 'colyseus.js';
import { logger } from './logger';
import { readTimeoutMs } from './runtimeConfig';

export async function joinWorld(serverUrl: string, identity?: string, name?: string, position?: { x: number; y: number; direction?: string }, mapName?: string) {
  let baseUrl = serverUrl;
  // Defensive check: ensure serverUrl is actually a string
  if (typeof baseUrl !== 'string') {
    logger.error('[Colyseus] serverUrl is not a string:', baseUrl, typeof baseUrl);
    throw new Error(`Invalid serverUrl type: ${typeof baseUrl}`);
  }

  logger.debug('[Colyseus] joinWorld called with serverUrl:', baseUrl);

  // normalize base: remove trailing slashes to avoid double '//'
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.replace(/\/+$/g, '');
  // Properly handle both http and https URLs
  let wsUrl = baseUrl;
  if (baseUrl.startsWith('https://')) {
    wsUrl = baseUrl.replace('https://', 'wss://');
  } else if (baseUrl.startsWith('http://')) {
    wsUrl = baseUrl.replace('http://', 'ws://');
  }

  logger.debug('[Colyseus] wsUrl after conversion:', wsUrl, 'type:', typeof wsUrl);

  // Derive tenant from browser hostname (first label), fallback to 'default'
  // In Tauri: Use __MEETROPOLIS_WEB_BASE__ as the hostname is localhost
  let tenant = 'default';
  try {
    const anyWin = typeof window !== 'undefined' ? (window as any) : {};
    const webBase = anyWin.__MEETROPOLIS_WEB_BASE__ || '';

    // Extract tenant from subdomain (≥3 hostname parts)
    // e.g., "https://demo.meetropolis.me" → "demo"
    // Apex domains (e.g., "https://meetropolis.me") → keep default
    if (webBase) {
      try {
        const hostname = new URL(webBase).hostname;
        const parts = hostname.split('.');
        if (parts.length >= 3) tenant = parts[0];
      } catch {}
    } else {
      // Fallback: extract from browser hostname (Web)
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const parts = host.split('.');
      if (parts.length >= 3) tenant = parts[0];
    }
  } catch {}

  logger.debug('[Colyseus] Creating client with wsUrl:', wsUrl, 'tenant:', tenant);

  try {
    const client = new Client(wsUrl);
    logger.debug('[Colyseus] Client created, joining room...');
    const avatarId = typeof window !== 'undefined' ? localStorage.getItem('avatarId') || undefined : undefined;

    const joinTimeoutMs = readTimeoutMs('VITE_COLYSEUS_JOIN_TIMEOUT_MS', 15_000);
    const JOIN_TIMEOUT_SENTINEL = Symbol('colyseus_join_timeout');
    const joinPromise = client.joinOrCreate('world', {
      identity,
      name,
      x: position?.x,
      y: position?.y,
      direction: position?.direction,
      tenant,
      avatarId,
      mapName,
    });
    let joinTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const joinTimeoutPromise = new Promise<typeof JOIN_TIMEOUT_SENTINEL>((resolve) => {
      joinTimeoutId = setTimeout(() => resolve(JOIN_TIMEOUT_SENTINEL), joinTimeoutMs);
    });

    let room: Room<any>;
    try {
      const result = await Promise.race([joinPromise, joinTimeoutPromise]);
      if (result === JOIN_TIMEOUT_SENTINEL) {
        // Best-effort: if the join eventually succeeds, make sure we leave.
        joinPromise.then((r) => { try { (r as any).leave?.(); } catch {} }).catch(() => {});
        throw new Error('colyseus_join_timeout');
      }
      room = result as Room<any>;
    } finally {
      if (joinTimeoutId !== undefined) clearTimeout(joinTimeoutId);
    }

    // Wait for initial state sync — but bound the wait so we never hang forever.
    const stateTimeoutMs = readTimeoutMs('VITE_COLYSEUS_STATE_TIMEOUT_MS', 5_000);
    const stopAt = Date.now() + stateTimeoutMs;
    await new Promise<void>((resolve, reject) => {
      const checkState = () => {
        if (room.state && (room.state as any).players) {
          resolve();
          return;
        }
        if (Date.now() >= stopAt) {
          reject(new Error('colyseus_state_timeout'));
          return;
        }
        setTimeout(checkState, 100);
      };
      // Give it one tick to potentially sync
      setTimeout(checkState, 0);
    });

    return room;
  } catch (error) {
    throw error;
  }
}
