import { Room, Client } from 'colyseus';
import { Schema, type } from '@colyseus/schema';

class Player extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('string') direction: string = 'down';
}

class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

// MapSchema must be imported from @colyseus/schema
import { MapSchema } from '@colyseus/schema';

export class WorldRoom extends Room<WorldState> {
  onCreate() {
    this.setState(new WorldState());
    this.onMessage('move', (client, data: { x: number; y: number; direction: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = data.x;
      player.y = data.y;
      player.direction = data.direction;
    });
  }

  onJoin(client: Client) {
    const player = new Player();
    player.id = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}

