// Live-Validation Bug B: 4 Colyseus-Clients gegen den Server, prueft full_state +
// player_joined-Broadcast und das mapName-Field auf jeden Player.
import { Client } from '/workspace/node_modules/colyseus.js/build/cjs/Client.js';
import { registerSerializer } from '/workspace/node_modules/colyseus.js/build/cjs/serializer/Serializer.js';
import { SchemaSerializer } from '/workspace/node_modules/colyseus.js/build/cjs/serializer/SchemaSerializer.js';
registerSerializer('schema', SchemaSerializer);

const SERVER = process.env.COLYSEUS_URL || 'ws://localhost:2567';
const TENANT = 'default';
// 4 Test-User-IDs, identisch mit DB-Seed.
const USERS = ['user-test-1', 'user-test-2', 'user-test-3', 'user-test-4'];

async function main() {
  const clients = [];
  for (const uid of USERS) {
    const client = new Client(SERVER);
    const room = await client.joinOrCreate('world', {
      tenant: TENANT,
      identity: uid,
      name: 'Tester ' + uid.slice(-1),
      mapName: 'office',
    });
    const seen = { fullState: null, joined: [] };
    room.onMessage('full_state', (data) => {
      seen.fullState = data.players?.map(p => ({ id: p.id, name: p.name, mapName: p.mapName })) || [];
    });
    room.onMessage('player_joined', (data) => {
      seen.joined.push({ id: data.id, name: data.name, mapName: data.mapName });
    });
    clients.push({ uid, room, seen });
  }
  // 2 Sek warten, damit alle full_state + Cross-Joined-Events einlaufen.
  await new Promise(r => setTimeout(r, 2000));

  console.log('=== Visibility Matrix ===');
  for (const { uid, room, seen } of clients) {
    const visibleViaFullState = seen.fullState ? seen.fullState.length : 0;
    const visibleViaJoined = seen.joined.length;
    console.log(`${uid} sid=${room.sessionId}: full_state=${visibleViaFullState} players, player_joined=${visibleViaJoined} events`);
    console.log(`  full_state ids: ${JSON.stringify(seen.fullState?.map(p => p.id) || [])}`);
    console.log(`  player_joined ids: ${JSON.stringify(seen.joined.map(p => p.id))}`);
    if (seen.fullState) {
      const emptyMapName = seen.fullState.filter(p => !p.mapName);
      if (emptyMapName.length > 0) {
        console.log(`  WARN: ${emptyMapName.length} players with empty mapName: ${JSON.stringify(emptyMapName.map(p => p.id))}`);
      } else {
        console.log(`  OK: all players have non-empty mapName`);
      }
    }
  }

  for (const c of clients) await c.room.leave();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
