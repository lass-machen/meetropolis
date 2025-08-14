import type { Client } from 'colyseus';
import Colyseus from 'colyseus';
import { Schema, type, MapSchema } from '@colyseus/schema';

class Player extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') direction: string = 'down';
}

class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

export class WorldRoom extends Colyseus.Room<WorldState> {
  override onCreate() {
    this.setState(new WorldState());
    console.log('[WorldRoom] Room created with initial state');
    this.onMessage('move', (client, data: { x: number; y: number; direction: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        console.log('[WorldRoom] Move from unknown player:', client.sessionId);
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
  }

  override onJoin(client: Client) {
    const player = new Player();
    player.id = client.sessionId;
    player.x = Math.floor(Math.random() * 200) + 100; // Random initial position
    player.y = Math.floor(Math.random() * 200) + 100;
    player.direction = 'down';
    this.state.players.set(client.sessionId, player);
    console.log('[WorldRoom] Player joined:', client.sessionId, 'at', player.x, player.y);
    console.log('[WorldRoom] Current players:', this.state.players.size);
    
    // Debug: Log all players
    this.state.players.forEach((p, id) => {
      console.log('[WorldRoom] - Player', id, 'at', p.x, p.y);
    });
    
    // Send full state to the new client
    client.send('full_state', {
      players: Array.from(this.state.players.entries()).map(([id, p]) => ({
        id,
        x: p.x,
        y: p.y,
        direction: p.direction
      }))
    });
    
    // Broadcast new player to all other clients
    this.broadcast('player_joined', {
      id: client.sessionId,
      x: player.x,
      y: player.y,
      direction: player.direction
    }, { except: client });
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log('[WorldRoom] Player left:', client.sessionId);
    
    // Broadcast player left to all other clients
    this.broadcast('player_left', {
      id: client.sessionId
    });
  }
}
