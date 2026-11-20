import type { Room } from 'livekit-client';
import { listPublications, readPubKind, readPubSource } from '../../types/livekit';

/** Whether the local participant currently has a live, unmuted microphone publication. */
export function queryLocalMicrophoneEnabled(room: Room): boolean {
  const pubs = listPublications(room.localParticipant);
  return pubs.some((pub) => {
    const src = readPubSource(pub);
    const kind = readPubKind(pub);
    const track = pub.track;
    if (!track) return false;
    if (kind !== 'audio' || src !== 'microphone') return false;
    const mst = track.mediaStreamTrack;
    const readyState = mst?.readyState;
    const isLive = readyState === undefined || readyState === 'live';
    if (!isLive) return false;
    // Soft-mute: publication stays, but pub.muted/track.enabled signals "off".
    const pubMuted = pub.muted === true || pub.isMuted === true;
    if (pubMuted) return false;
    const enabledFlag = track.isEnabled ?? track.enabled ?? mst?.enabled;
    if (enabledFlag === false) return false;
    return true;
  });
}

/** Whether the local participant currently has a live camera publication. */
export function queryLocalCameraEnabled(room: Room): boolean {
  const pubs = listPublications(room.localParticipant);
  return pubs.some((pub) => {
    const src = readPubSource(pub);
    const kind = readPubKind(pub);
    const track = pub.track;
    if (!track) return false;
    const mst = track.mediaStreamTrack;
    if (kind !== 'video') return false;
    if (src === 'screen_share') return false;
    const isCam = src === 'camera' || src == null;
    const readyState = mst?.readyState;
    const isLive = readyState === undefined || readyState === 'live';
    return isCam && isLive;
  });
}
