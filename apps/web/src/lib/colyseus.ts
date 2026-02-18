import { Client, Room } from 'colyseus.js';
import { logger } from './logger';

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
    
    // Try to extract tenant from web_base first (Tauri)
    const webBaseMatch = webBase.match(/https?:\/\/([^.]+)\./);
    if (webBaseMatch?.[1]) {
      tenant = webBaseMatch[1];
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
    const room = await client.joinOrCreate('world', {
      identity,
      name,
      x: position?.x,
      y: position?.y,
      direction: position?.direction,
      tenant,
      avatarId,
      mapName,
    });
    // Wait for initial state sync
    await new Promise<void>((resolve) => {
      const checkState = () => {
        if (room.state && (room.state as any).players) {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      // Give it one tick to potentially sync
      setTimeout(checkState, 0);
    });
    
    return room as Room<any>;
  } catch (error) {
    throw error;
  }
}
