import type { Client } from 'colyseus';
import Colyseus from 'colyseus';
import { logger } from '../logger.js';
import { Schema, type, MapSchema } from '@colyseus/schema';

class Player extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') direction: string = 'down';
  @type('string') identity: string = ''; // User's actual identity for LiveKit
  @type('string') name: string = ''; // User's display name
  @type('boolean') dnd: boolean = false; // Do Not Disturb status
}

class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// Store all active rooms globally for API access
const activeRooms = new Set<WorldRoom>();

export class WorldRoom extends Colyseus.Room<WorldState> {
  override onCreate() {
    this.setState(new WorldState());
    logger.info('[WorldRoom] Room created with initial state');
    activeRooms.add(this);
    
    // Make rooms accessible globally
    (global as any).activeWorldRooms = activeRooms;
    this.onMessage('move', (client, data: { x: number; y: number; direction: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        logger.warn('[WorldRoom] Move from unknown player:', client.sessionId);
        return;
      }
      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;
      
      // Broadcast movement to all other clients
      this.broadcast('player_moved', {
        id: client.sessionId,
        x: data.x,
        y: data.y,
        direction: data.direction
      }, { except: client });
    });
    
    // Handle editor updates
    this.onMessage('editor_update', (client, data: any) => {
      logger.debug('[WorldRoom] Editor update from:', client.sessionId, 'type:', data.type);
      // Broadcast editor update to all other clients
      this.broadcast('editor_update', data, { except: client });
    });
    
    // Handle DND status updates
    this.onMessage('dnd_status', (client, data: { dnd: boolean }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        logger.warn('[WorldRoom] DND status from unknown player:', client.sessionId);
        return;
      }
      player.dnd = data.dnd;
      logger.info('[WorldRoom] Player', client.sessionId, 'DND status:', data.dnd);
      
      // Broadcast DND status to all other clients
      this.broadcast('player_dnd', {
        id: client.sessionId,
        dnd: data.dnd
      }, { except: client });
    });
    
    // Handle remote control messages from API
    this.onMessage('remote_control', (client, data: any) => {
      logger.info('[WorldRoom] Remote control received for:', client.sessionId, 'data:', data);
      // Forward to the specific client
      client.send('remote_control', data);
    });

    // Bubble-Updates: Einfaches globales Mitglieder-Set an alle broadcasten
    this.onMessage('bubble_update', (_client, data: { members: string[] }) => {
      const members = Array.isArray(data?.members) ? data.members : [];
      logger.info('[WorldRoom] bubble_update:', members);
      this.broadcast('bubble_state', { members });
    });
  }

  override onJoin(client: Client, options?: any) {
    const player = new Player();
    player.id = client.sessionId;
    // Use provided position or random initial position
    player.x = options?.x ?? Math.floor(Math.random() * 200) + 100;
    player.y = options?.y ?? Math.floor(Math.random() * 200) + 100;
    player.direction = options?.direction || 'down';
    player.identity = options?.identity || client.sessionId; // Use provided identity or fallback
    player.name = options?.name || options?.identity || client.sessionId; // Use provided name or fallback
    this.state.players.set(client.sessionId, player);
    logger.info('[WorldRoom] Player joined:', client.sessionId, 'identity:', player.identity, 'name:', player.name, 'at', player.x, player.y);
    logger.debug('[WorldRoom] Current players:', this.state.players.size);
    
    // Debug: Log all players
    this.state.players.forEach((p, id) => {
      logger.debug('[WorldRoom] - Player', id, 'identity:', p.identity, 'at', p.x, p.y);
    });
    
    // Send full state to the new client (delay slightly so client can register handlers)
    setTimeout(() => {
      try {
        client.send('full_state', {
          players: Array.from(this.state.players.entries()).map(([id, p]) => ({
            id,
            x: p.x,
            y: p.y,
            direction: p.direction,
            identity: p.identity,
            name: p.name,
            dnd: p.dnd
          }))
        });
      } catch {}
    }, 25);
    
    // Broadcast new player to all other clients
    this.broadcast('player_joined', {
      id: client.sessionId,
      x: player.x,
      y: player.y,
      direction: player.direction,
      identity: player.identity,
      name: player.name,
      dnd: player.dnd
    }, { except: client });
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    logger.info('[WorldRoom] Player left:', client.sessionId);
    
    // Broadcast player left to all other clients
    this.broadcast('player_left', {
      id: client.sessionId
    });
  }
  
  override onDispose() {
    activeRooms.delete(this);
    logger.info('[WorldRoom] Room disposed');
  }
}
