/**
 * The server refuses a world join without the Colyseus wire protocol version
 * (apps/server/src/rooms/lifecycle/onAuth.ts, 4426 client_too_old). The browser
 * and desktop bundle must therefore send it with every join, next to the
 * zone-privacy version that the same bundle reports for the LiveKit gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { WORLD_WIRE_PROTOCOL_VERSION, ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';

const joinOrCreate = vi.hoisted(() => vi.fn());

vi.mock('@colyseus/sdk', () => ({
  Client: class {
    auth: { token?: string } = {};
    joinOrCreate = joinOrCreate;
  },
  Room: class {},
}));
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { joinWorld } from './colyseus';

describe('joinWorld', () => {
  it('sends the wire protocol and the zone-privacy version with the join', async () => {
    joinOrCreate.mockResolvedValue({ state: { players: {} } });

    await joinWorld('http://localhost:2567', 'user-1', 'User One');

    expect(joinOrCreate).toHaveBeenCalledTimes(1);
    expect(joinOrCreate).toHaveBeenCalledWith(
      'world',
      expect.objectContaining({
        wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION,
        zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
      }),
    );
  });
});
