import { Client, Room } from 'colyseus.js';

export async function joinWorld(serverUrl: string) {
  // Properly handle both http and https URLs
  let wsUrl = serverUrl;
  if (serverUrl.startsWith('https://')) {
    wsUrl = serverUrl.replace('https://', 'wss://');
  } else if (serverUrl.startsWith('http://')) {
    wsUrl = serverUrl.replace('http://', 'ws://');
  }
  
  console.log('[Colyseus] Connecting to:', wsUrl);
  
  try {
    const client = new Client(wsUrl);
    const room = await client.joinOrCreate<any>('world');
    console.log('[Colyseus] Successfully joined room:', room.sessionId);
    return room as Room<any>;
  } catch (error) {
    console.error('[Colyseus] Failed to join room:', error);
    throw error;
  }
}

