import { describe, it, expect, vi } from 'vitest';
import { ZonePermissionsManager } from './zonePermissionsManager';

function makeFakeRoom() {
  return {
    localParticipant: {
      setTrackSubscriptionPermissions: vi.fn(),
    },
  };
}

describe('ZonePermissionsManager', () => {
  it('applyDenyAll calls setTrackSubscriptionPermissions(false, []) on the current room', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.applyDenyAll();

    expect(room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, []);
  });

  it('applyAllowList narrows permissions to the pushed identities', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.applyAllowList({ islandId: 'map-1:zone:kitchen', allow: ['bob', 'carol'] });

    expect(room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, [
      { participantIdentity: 'bob', allowAll: true },
      { participantIdentity: 'carol', allowAll: true },
    ]);
  });

  it('is a no-op when there is no current room', () => {
    const mgr = new ZonePermissionsManager({ getRoom: () => null });
    expect(() => mgr.applyDenyAll()).not.toThrow();
    expect(() => mgr.applyAllowList({ islandId: 'x', allow: [] })).not.toThrow();
  });

  it('swallows an error thrown by the LiveKit SDK call instead of propagating it', () => {
    const room = {
      localParticipant: {
        setTrackSubscriptionPermissions: vi.fn(() => {
          throw new Error('sdk exploded');
        }),
      },
    };
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    expect(() => mgr.applyDenyAll()).not.toThrow();
  });

  it('does nothing after dispose()', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.dispose();
    mgr.applyDenyAll();

    expect(room.localParticipant.setTrackSubscriptionPermissions).not.toHaveBeenCalled();
  });
});
