import { Client, Room } from 'colyseus.js';

export async function joinWorld(serverUrl: string, identity?: string, name?: string, position?: { x: number; y: number; direction?: string }) {
  // Properly handle both http and https URLs
  let wsUrl = serverUrl;
  if (serverUrl.startsWith('https://')) {
    wsUrl = serverUrl.replace('https://', 'wss://');
  } else if (serverUrl.startsWith('http://')) {
    wsUrl = serverUrl.replace('http://', 'ws://');
  }
  
  try {
    const client = new Client(wsUrl);
    const room = await client.joinOrCreate('world', { 
      identity, 
      name,
      x: position?.x,
      y: position?.y,
      direction: position?.direction
    });
    // Vorsorgliche No-Op Handler, um Colyseus-Warnungen zu vermeiden,
    // falls UI-Handler noch nicht registriert sind (Race direkt nach Join).
    try {
      const noop = () => {};
      room.onMessage('player_moved', noop);
      room.onMessage('player_joined', noop);
      room.onMessage('player_left', noop);
      room.onMessage('player_dnd', noop);
      room.onMessage('editor_update', noop);
      room.onMessage('bubble_state', noop);
      room.onMessage('remote_control', noop);
    } catch {}
    
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

