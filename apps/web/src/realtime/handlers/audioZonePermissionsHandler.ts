/**
 * H4 audio-zone privacy: applies the server's `av_zone_permissions` push
 * to the local LiveKit participant's own subscription permissions - the
 * SFU-hard boundary. See apps/server/src/rooms/audioZones/permissionOrchestrator.ts
 * for the server side and apps/web/src/av/manager/zonePermissionsManager.ts
 * for the LiveKit call this delegates to.
 */

import type { UseWorldRoomArgs } from '../types';
import type { WorldRoom, ZonePermissionsMessage } from '../../types/colyseus';

export function setupAudioZonePermissionsHandler(room: WorldRoom, args: UseWorldRoomArgs) {
  room.onMessage('av_zone_permissions', (payload: ZonePermissionsMessage) => {
    const islandId = typeof payload?.islandId === 'string' ? payload.islandId : '';
    const allow = Array.isArray(payload?.allow)
      ? payload.allow.filter((id): id is string => typeof id === 'string')
      : [];
    if (!islandId) return;
    args.avRef.current?.applyZonePermissions({ islandId, allow });
  });
}
