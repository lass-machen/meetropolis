import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastPresenceUpdate } from './auth.profile.js';

function room(tenant: string | undefined) {
  return {
    metadata: tenant ? { tenant } : {},
    broadcast: vi.fn(),
  };
}

describe('broadcastPresenceUpdate', () => {
  afterEach(() => {
    delete (global as { activeWorldRooms?: unknown }).activeWorldRooms;
  });

  it('reaches only the room of the own tenant', () => {
    const own = room('acme');
    const foreign = room('beta');
    const withoutTenant = room(undefined);
    (global as { activeWorldRooms?: unknown }).activeWorldRooms = new Set([own, foreign, withoutTenant]);

    broadcastPresenceUpdate('acme', 'user-1', { x: 1, y: 2, direction: 'down' });

    expect(own.broadcast).toHaveBeenCalledTimes(1);
    expect(own.broadcast).toHaveBeenCalledWith(
      'presence_update',
      expect.objectContaining({ userId: 'user-1', x: 1, y: 2, direction: 'down' }),
    );
    expect(foreign.broadcast).not.toHaveBeenCalled();
    expect(withoutTenant.broadcast).not.toHaveBeenCalled();
  });
});
