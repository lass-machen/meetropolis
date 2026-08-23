import type { Room } from 'livekit-client';
import { getApiBaseFromWindow } from '../../../lib/runtimeConfig';
import { logger } from '../../../lib/logger';
import type { TrackLike } from '../../../types/livekit';
import type { AnyParticipant, UiParticipant } from './types';

export const getTrackId = (t: TrackLike | null | undefined): string | null =>
  t?.sid || t?.mediaStreamTrack?.id || (t as { id?: string } | null | undefined)?.id || null;

/**
 * Returns the label for a participant tile, appending a localised suffix when
 * the tile represents a screen-share. Camera and screen tiles of one publisher
 * share the same `displayName`; the `media` discriminator decides the suffix.
 */
export function displayParticipantName(part: UiParticipant, t: (k: string) => string): string {
  if (part.media === 'screen') {
    return `${part.displayName} (${t('participant.screenSuffix')})`;
  }
  return part.displayName;
}

/**
 * Snapshot of the room's remote participants.
 *
 * `Room.remoteParticipants` is a non-optional `Map` in livekit-client 2.x, but
 * this runs against room objects handed in by callers that may hold a room
 * mid-teardown, so the read stays defensive rather than assuming the map.
 */
function listRemoteParticipants(room: Room): AnyParticipant[] {
  const values = room.remoteParticipants?.values?.();
  if (!values) return [];
  try {
    return Array.from(values);
  } catch {
    return [];
  }
}

/**
 * Resolve a tile to the remote LiveKit participant that publishes its media.
 *
 * Stage 1 is the LiveKit identity: `Room.remoteParticipants` is keyed by
 * identity, and the identity is the only handle that is unique per participant
 * and stable across reconnects.
 *
 * Stage 2 is a SID scan, for the case where the tile was built before the
 * identity was known. It is a scan, not a `Map.get`, because the map is keyed
 * by identity — the SID lookup this code used to do (`remoteParticipants.get(sid)`)
 * could never hit, which is how an iOS publisher without a LiveKit `name` ended
 * up with an empty video tile.
 *
 * There is deliberately no display-name stage. `displayName` comes from the
 * `name || email || id` cascade and is not unique: matching on it hands the
 * first participant with that label to every tile that shares it, which puts
 * one participant's camera under another participant's name.
 */
function resolveRemoteParticipant(room: Room, part: UiParticipant, baseSid: string): AnyParticipant | null {
  if (part.livekitIdentity) {
    const byIdentity = room.remoteParticipants?.get?.(part.livekitIdentity);
    if (byIdentity) return byIdentity;
  }
  if (!baseSid) return null;
  return listRemoteParticipants(room).find((participant) => participant.sid === baseSid) ?? null;
}

/** Does this tile belong to the local participant? Identity first, SID as fallback. */
function isLocalTile(room: Room, part: UiParticipant, baseSid: string): boolean {
  const local = room.localParticipant;
  if (!local) return false;
  if (part.livekitIdentity) return local.identity === part.livekitIdentity;
  return !!baseSid && local.sid === baseSid;
}

/**
 * Resolve a tile to its LiveKit participant.
 *
 * The returned `baseSid` is the participant's *current* SID, not the one the
 * tile was built with: callers match room events against it, and a participant
 * that reconnected carries a new SID while its identity is unchanged.
 */
export function findParticipant(
  room: Room,
  baseSid: string,
  part: UiParticipant,
): { p: AnyParticipant | null; baseSid: string; isLocal: boolean } {
  if (isLocalTile(room, part, baseSid)) {
    const local = room.localParticipant;
    return { p: local, baseSid: local.sid, isLocal: true };
  }
  const p = resolveRemoteParticipant(room, part, baseSid);
  if (p) return { p, baseSid: p.sid, isLocal: false };
  return { p: null, baseSid, isLocal: false };
}

/**
 * Re-resolve a screen-share tile whose publisher was not in the room yet when
 * the tile was mounted. A screen tile carries the publisher's identity, exactly
 * like its camera tile; `media` plus the ':screen' SID suffix keep the two apart.
 */
export function findScreenParticipant(
  room: Room,
  part: UiParticipant,
  baseSid: string,
  currentP: AnyParticipant | null,
): AnyParticipant | null {
  return resolveRemoteParticipant(room, part, baseSid) ?? currentP;
}

/**
 * Force-mute the microphone of the participant behind this tile.
 *
 * The target is addressed by LiveKit identity. Deriving it from the label (as
 * this did before) picks the first participant whose name matches and mutes the
 * wrong person the moment two participants share a name. A tile without an
 * identity has no LiveKit participant behind it — a presence-only entry from the
 * Colyseus roster — so there is nothing to mute and the request is not sent.
 */
export async function performForceMute(part: UiParticipant): Promise<void> {
  const targetIdentity = part.livekitIdentity;
  if (!targetIdentity) {
    logger.warn('force-mute skipped: tile has no LiveKit identity', { sid: part.sid });
    return;
  }
  try {
    const base = getApiBaseFromWindow();
    const res = await fetch(`${base}/controls/for/${encodeURIComponent(targetIdentity)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mic: false }),
    });
    if (!res.ok) {
      logger.warn('force-mute rejected by server', { identity: targetIdentity, status: res.status });
    }
  } catch (err) {
    logger.warn('force-mute request failed', { identity: targetIdentity, err });
  }
}
