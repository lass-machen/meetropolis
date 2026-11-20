import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastMapUpdate } from './broadcast.js';

function room(tenant: string | undefined) {
  return {
    metadata: tenant ? { tenant } : {},
    broadcast: vi.fn(),
  };
}

describe('broadcastMapUpdate without presence', () => {
  afterEach(() => {
    delete (global as { gameServer?: unknown }).gameServer;
    delete (global as { activeWorldRooms?: unknown }).activeWorldRooms;
  });

  it('reaches only rooms of the tenant', () => {
    const own = room('acme');
    const foreign = room('beta');
    const withoutTenant = room(undefined);
    (global as { gameServer?: unknown }).gameServer = {};
    (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([own, foreign, withoutTenant]);

    broadcastMapUpdate('acme', 'map_update', { mapId: 'office' });

    expect(own.broadcast).toHaveBeenCalledTimes(1);
    expect(own.broadcast).toHaveBeenCalledWith('map_update', { mapId: 'office' });
    expect(foreign.broadcast).not.toHaveBeenCalled();
    expect(withoutTenant.broadcast).not.toHaveBeenCalled();
  });
});
