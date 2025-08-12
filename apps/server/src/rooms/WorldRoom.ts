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
    this.onMessage('move', (client, data: { x: number; y: number; direction: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;
    });
  }

  override onJoin(client: Client) {
    const player = new Player();
    player.id = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}
