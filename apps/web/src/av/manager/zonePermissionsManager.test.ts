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

  it('SDK error disconnects the room and does not throw', () => {
    const room = {
      localParticipant: {
        setTrackSubscriptionPermissions: vi.fn(() => {
          throw new Error('sdk exploded');
        }),
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    expect(() => mgr.applyDenyAll()).not.toThrow();
    expect(room.disconnect).toHaveBeenCalledTimes(1);
  });

  it('SDK error with a failing disconnect still does not throw', () => {
    const room = {
      localParticipant: {
        setTrackSubscriptionPermissions: vi.fn(() => {
          throw new Error('sdk exploded');
        }),
      },
      disconnect: vi.fn().mockRejectedValue(new Error('disconnect exploded')),
    };
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    expect(() => mgr.applyDenyAll()).not.toThrow();
    expect(room.disconnect).toHaveBeenCalledTimes(1);

    const syncRoom = {
      localParticipant: {
        setTrackSubscriptionPermissions: vi.fn(() => {
          throw new Error('sdk exploded');
        }),
      },
      disconnect: vi.fn(() => {
        throw new Error('disconnect exploded');
      }),
    };
    const syncMgr = new ZonePermissionsManager({ getRoom: () => syncRoom as never });

    expect(() => syncMgr.applyDenyAll()).not.toThrow();
    expect(syncRoom.disconnect).toHaveBeenCalledTimes(1);
  });

  it('applyBaseline without a server list applies deny-all', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.applyBaseline();

    expect(room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, []);
  });

  it('allow list received without a room is applied by the next baseline', () => {
    const room = makeFakeRoom();
    let current: unknown = null;
    const mgr = new ZonePermissionsManager({ getRoom: () => current as never });

    mgr.applyAllowList({ islandId: 'map-1:zone:kitchen', allow: ['bob'] });
    expect(room.localParticipant.setTrackSubscriptionPermissions).not.toHaveBeenCalled();

    current = room;
    mgr.applyBaseline();

    expect(room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, [
      { participantIdentity: 'bob', allowAll: true },
    ]);
  });

  it('baseline after reconnect restores the last server list', () => {
    const firstRoom = makeFakeRoom();
    const secondRoom = makeFakeRoom();
    let current: unknown = firstRoom;
    const mgr = new ZonePermissionsManager({ getRoom: () => current as never });

    mgr.applyAllowList({ islandId: 'map-1:zone:kitchen', allow: ['bob', 'carol'] });
    current = secondRoom;
    mgr.applyBaseline();

    expect(secondRoom.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, [
      { participantIdentity: 'bob', allowAll: true },
      { participantIdentity: 'carol', allowAll: true },
    ]);
  });

  it('dispose clears the stored list', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.applyAllowList({ islandId: 'map-1:zone:kitchen', allow: ['bob'] });
    mgr.dispose();
    mgr.applyBaseline();

    expect(room.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledTimes(1);
  });

  it('does nothing after dispose()', () => {
    const room = makeFakeRoom();
    const mgr = new ZonePermissionsManager({ getRoom: () => room as never });

    mgr.dispose();
    mgr.applyDenyAll();

    expect(room.localParticipant.setTrackSubscriptionPermissions).not.toHaveBeenCalled();
  });
});
