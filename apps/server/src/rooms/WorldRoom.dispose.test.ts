/**
 * What a WorldRoom acquires when it is built must be released when it is
 * disposed. Runs against a real Colyseus server with the real WorldRoom (see
 * testUtils/matchmakeHarness.ts); only the database is replaced.
 *
 * The presence topic matters most: `map_update:<tenant>` is subscribed through
 * `room.presence` (rooms/handlers/editorHandler.ts) and the code never
 * unsubscribes it by hand. Colyseus hands every room a scoped presence that
 * drops its subscriptions when the room is disposed; this pins that, so an
 * upgrade that changes it shows up here instead of as a slow leak.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  startMatchmakeServer,
  stopMatchmakeServer,
  worldRooms,
  type MatchmakeTestServer,
} from '../testUtils/matchmakeHarness.js';

describe('WorldRoom disposal', () => {
  let server: MatchmakeTestServer;
  const disconnect = vi.fn(() => Promise.resolve());

  beforeAll(async () => {
    createPrismaClientMock.mockImplementation(() => ({ ...makeFakePrisma(), $disconnect: disconnect }));
    server = await startMatchmakeServer();
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
  });

  beforeEach(async () => {
    await disposeAllRooms();
    disconnect.mockClear();
  });

  it('releases the map_update presence subscription of its tenant', async () => {
    await matchmake(server, JSON.stringify({ tenant: 'presence-probe' }));
    const topic = 'map_update:presence-probe';
    expect(await matchMaker.presence.channels('map_update:*')).toContain(topic);

    const [listing] = await worldRooms();
    await matchMaker.remoteRoomCall(listing?.roomId ?? '', 'disconnect');

    expect(await matchMaker.presence.channels('map_update:*')).not.toContain(topic);
  });

  it('keeps the subscription of a tenant while another room of that tenant is alive', async () => {
    // Two rooms of one tenant exist when the first one is full or locked; the
    // topic is shared, so disposing one room must not silence the other.
    await matchmake(server, JSON.stringify({ tenant: 'shared' }));
    const [first] = await worldRooms();
    await matchMaker.remoteRoomCall(first?.roomId ?? '', 'lock');
    await matchmake(server, JSON.stringify({ tenant: 'shared' }));
    expect(await worldRooms()).toHaveLength(2);

    await matchMaker.remoteRoomCall(first?.roomId ?? '', 'disconnect');

    expect(await matchMaker.presence.channels('map_update:*')).toContain('map_update:shared');
  });

  it('disconnects the PrismaClient the room built', async () => {
    await matchmake(server, JSON.stringify({ tenant: 'db-probe' }));
    expect(createPrismaClientMock).toHaveBeenCalledTimes(1);

    const [listing] = await worldRooms();
    await matchMaker.remoteRoomCall(listing?.roomId ?? '', 'disconnect');

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
