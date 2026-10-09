import { logger } from '../../logger.js';
import { getTranscriptionModuleSync } from '../../transcriptionLoader.js';
import type { WorldRoom } from '../WorldRoom.js';
import { getRoomTenantSlug } from '../handlers/zoneLockHandler.js';

export const ISLAND_ATTRIBUTE = 'meetropolis.island';
export const ISLAND_SINCE_ATTRIBUTE = 'meetropolis.islandSince';
export const TRANSCRIBER_IDENTITY = 'svc-transcriber';

export function islandAttributesEnabled(): boolean {
  return getTranscriptionModuleSync()?.publishIslandAttributes ?? false;
}

export function publishIslandAttribute(room: WorldRoom, identity: string, islandKey: string, sinceMs: number): void {
  if (!islandAttributesEnabled()) return;

  const admin = room.audioZones.admin;
  if (!admin) return;

  const roomName = `${getRoomTenantSlug(room)}:world`;
  const attributes = {
    [ISLAND_ATTRIBUTE]: islandKey,
    [ISLAND_SINCE_ATTRIBUTE]: String(sinceMs),
  };
  void admin.updateParticipantAttributes(roomName, identity, attributes).catch((error: unknown) => {
    if (isParticipantNotFound(error)) {
      // Expected race: the Colyseus join (map load) can land before the
      // client's LiveKit connect. The reconciler publishes the attribute on
      // its next cycle once the participant exists.
      logger.info({
        event: 'audio_zones.island_attribute_participant_not_found',
        room: roomName,
        identity,
      });
      return;
    }
    logger.error('[AudioZones] Failed to publish island participant attributes', {
      room: roomName,
      identity,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

// livekit-server-sdk's ServerError carries the Twirp error code.
function isParticipantNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'not_found';
}
