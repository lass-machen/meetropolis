import { describe, it, expect, vi } from 'vitest';
import { setupAudioZonePermissionsHandler } from './audioZonePermissionsHandler';
import type { UseWorldRoomArgs } from '../types';

interface MockMessageHandlers {
  [event: string]: (data: unknown) => void;
}

function makeMockRoom() {
  const handlers: MockMessageHandlers = {};
  return {
    onMessage: (event: string, cb: (data: unknown) => void) => {
      handlers[event] = cb;
    },
    trigger: (event: string, data?: unknown) => {
      handlers[event]?.(data);
    },
  };
}

function makeArgs(applyZonePermissions: ReturnType<typeof vi.fn>): UseWorldRoomArgs {
  return {
    avRef: { current: { applyZonePermissions } },
  } as unknown as UseWorldRoomArgs;
}

describe('setupAudioZonePermissionsHandler', () => {
  it('forwards a well-formed push to AVManager.applyZonePermissions', () => {
    const room = makeMockRoom();
    const applyZonePermissions = vi.fn();
    const args = makeArgs(applyZonePermissions);
    setupAudioZonePermissionsHandler(room as unknown as Parameters<typeof setupAudioZonePermissionsHandler>[0], args);

    room.trigger('av_zone_permissions', { islandId: 'map-1:zone:kitchen', allow: ['bob', 'carol'] });

    expect(applyZonePermissions).toHaveBeenCalledWith({ islandId: 'map-1:zone:kitchen', allow: ['bob', 'carol'] });
  });

  it('treats a missing allow list as deny-all rather than dropping the push', () => {
    const room = makeMockRoom();
    const applyZonePermissions = vi.fn();
    const args = makeArgs(applyZonePermissions);
    setupAudioZonePermissionsHandler(room as unknown as Parameters<typeof setupAudioZonePermissionsHandler>[0], args);

    room.trigger('av_zone_permissions', { islandId: 'map-1:open' });

    expect(applyZonePermissions).toHaveBeenCalledWith({ islandId: 'map-1:open', allow: [] });
  });

  it('ignores a malformed push with no islandId', () => {
    const room = makeMockRoom();
    const applyZonePermissions = vi.fn();
    const args = makeArgs(applyZonePermissions);
    setupAudioZonePermissionsHandler(room as unknown as Parameters<typeof setupAudioZonePermissionsHandler>[0], args);

    room.trigger('av_zone_permissions', { allow: ['bob'] });
    room.trigger('av_zone_permissions', {});

    expect(applyZonePermissions).not.toHaveBeenCalled();
  });

  it('is a no-op when the AV manager is not yet connected', () => {
    const room = makeMockRoom();
    const args = { avRef: { current: null } } as unknown as UseWorldRoomArgs;
    setupAudioZonePermissionsHandler(room as unknown as Parameters<typeof setupAudioZonePermissionsHandler>[0], args);

    expect(() => room.trigger('av_zone_permissions', { islandId: 'map-1:open', allow: [] })).not.toThrow();
  });
});
