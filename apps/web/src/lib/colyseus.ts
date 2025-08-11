import { Client, Room } from 'colyseus.js';

export async function joinWorld(serverUrl: string) {
  const client = new Client(serverUrl.replace('http', 'ws'));
  const room = await client.joinOrCreate<any>('world');
  return room as Room<any>;
}

