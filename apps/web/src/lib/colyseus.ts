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
    const room = await client.joinOrCreate('world');
    console.log('[Colyseus] Successfully joined room:', room.sessionId);
    
    // Wait for initial state sync
    await new Promise<void>((resolve) => {
      const checkState = () => {
        if (room.state && room.state.players) {
          console.log('[Colyseus] State is ready, players:', room.state.players.size);
          resolve();
        } else {
          console.log('[Colyseus] Waiting for state...');
          setTimeout(checkState, 100);
        }
      };
      // Give it one tick to potentially sync
      setTimeout(checkState, 0);
    });
    
    console.log('[Colyseus] Room state after sync:', room.state);
    
    // Debug: Listen for all state changes
    room.state.listen('players', (change: any) => {
      console.log('[Colyseus] Players collection changed:', change);
      
      // Log all changes
      if (room.state.players) {
        console.log('[Colyseus] Current players after change:');
        room.state.players.forEach((player: any, id: string) => {
          console.log('[Colyseus] - Player', id, ':', player);
        });
      }
    });
    
    // Debug: Log initial state
    setTimeout(() => {
      console.log('[Colyseus] Initial state after 1s:', {
        hasState: !!room.state,
        hasPlayers: !!room.state?.players,
        playersSize: room.state?.players?.size || 0
      });
      if (room.state?.players) {
        room.state.players.forEach((player: any, id: string) => {
          console.log('[Colyseus] Initial player:', id, player);
        });
      }
    }, 1000);
    
    return room as Room<any>;
  } catch (error) {
    console.error('[Colyseus] Failed to join room:', error);
    throw error;
  }
}

