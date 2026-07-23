import type { LocalTrack, LocalVideoTrack, Room } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import { readTimeoutMs } from '../../lib/runtimeConfig';
import { withPublishTimeout } from './publishTimeout';
import type { LocalTrackState } from './types';
import {
  listPublications,
  readPubKind,
  readPubSource,
  type TrackLike,
  type TrackPublicationLike,
} from '../../types/livekit';

function getLocalTrackPublications(room: Room): TrackPublicationLike[] {
  try {
    return listPublications(room.localParticipant);
  } catch {
    return [];
  }
}

async function unpublishNonLiveCameraTracks(room: Room): Promise<void> {
  try {
    const pubs = getLocalTrackPublications(room);
    for (const pub of pubs) {
      const src = readPubSource(pub);
      const kind = readPubKind(pub);
      const t = pub.track;
      if (!t) continue;
      if (kind !== 'video') continue;
      if (src === 'screen_share') continue;
      if (!(src === 'camera' || src == null)) continue;

      const mst = t.mediaStreamTrack;
      if (mst?.readyState === 'live') continue;

      try {
        if (typeof t.setEnabled === 'function') {
          t.setEnabled(false);
        } else if (mst) {
          mst.enabled = false;
        }
      } catch {}

      try {
        await room.localParticipant.unpublishTrack(t as unknown as LocalTrack);
      } catch {}
      try {
        t.stop?.();
      } catch {}
    }
  } catch {}
}

type PublishCameraParams = {
  room: Room;
  state: LocalTrackState;
  watchTrackEnded: (track: LocalVideoTrack, onEnded: () => void) => void;
  onTrackPublished: () => void;
  onTrackEndedByBrowser: () => void;
};

/**
 * Reuse an existing, live camera publication to avoid publishing a duplicate
 * after a reconnect/desync. Returns the live camera track, or null when none
 * qualifies (also on any lookup error — the caller then publishes fresh).
 */
function findLiveCameraPublication(room: Room): LocalVideoTrack | null {
  try {
    const pubs = getLocalTrackPublications(room);
    const livePub = pubs.find((pub) => {
      const src = readPubSource(pub);
      const kind = readPubKind(pub);
      const mst = pub.track?.mediaStreamTrack;
      if (kind !== 'video') return false;
      if (src === 'screen_share') return false;
      const readyState = mst?.readyState;
      const isLive = readyState === undefined || readyState === 'live';
      return (src === 'camera' || src == null) && isLive;
    });
    return livePub?.track ? (livePub.track as unknown as LocalVideoTrack) : null;
  } catch {
    return null;
  }
}

export async function publishCamera({
  room,
  state,
  watchTrackEnded,
  onTrackPublished,
  onTrackEndedByBrowser,
}: PublishCameraParams): Promise<void> {
  // Prefer an existing, live camera publication to avoid duplicates after reconnect/desync
  const livePublication = findLiveCameraPublication(room);
  if (livePublication) {
    state.track = livePublication;
    state.published = true;
    AVLogger.debug('track.cam.already_published');
    return;
  }

  // Check if already published with a live track
  if (state.published && state.track) {
    const mst = (state.track as unknown as TrackLike).mediaStreamTrack;
    if (mst?.readyState === 'live') {
      AVLogger.debug('track.cam.already_published');
      return;
    }
    await unpublishCamera({ room, state, checkAllTracksUnpublished: () => {} });
  }

  // Bound getUserMedia + publish so an unanswered camera-permission prompt or a
  // stuck signal cannot leave the publish (and the UI's in-flight camera flag)
  // pending forever. Mirrors the microphone path.
  const publishTimeoutMs = readTimeoutMs('VITE_CAM_PUBLISH_TIMEOUT_MS', 10_000);

  const createAndPublish = async (): Promise<LocalVideoTrack> => {
    await unpublishNonLiveCameraTracks(room);
    const { createLocalTracks } = await import('livekit-client');

    const videoConstraints: { deviceId?: string; facingMode: string } = state.preferredDeviceId
      ? { deviceId: state.preferredDeviceId, facingMode: 'user' }
      : { facingMode: 'user' };

    const tracks = await createLocalTracks({ video: videoConstraints } as unknown as Parameters<
      typeof createLocalTracks
    >[0]);
    const videoTrack = tracks.find((t) => String((t as TrackLike).kind) === 'video') as LocalVideoTrack | undefined;

    if (!videoTrack) {
      throw new Error('No video track created');
    }

    await room.localParticipant.publishTrack(videoTrack);
    return videoTrack;
  };

  try {
    const videoTrack = await withPublishTimeout(createAndPublish(), publishTimeoutMs);

    state.track = videoTrack;
    state.published = true;

    watchTrackEnded(videoTrack, onTrackEndedByBrowser);

    AVLogger.info('track.cam.published', {
      deviceId: state.preferredDeviceId,
    });

    onTrackPublished();
  } catch (error) {
    AVLogger.error('track.cam.publish_failed', { error: String(error) });
    throw error;
  }
}

type UnpublishCameraParams = {
  room: Room;
  state: LocalTrackState;
  checkAllTracksUnpublished: () => void;
};

export async function unpublishCamera({
  room,
  state,
  checkAllTracksUnpublished,
}: UnpublishCameraParams): Promise<void> {
  if (!state.track) {
    // Best-effort: also unpublish any lingering cam publications (state can desync on reconnect)
    try {
      const pubs = getLocalTrackPublications(room);
      for (const pub of pubs) {
        const src = readPubSource(pub);
        const kind = readPubKind(pub);
        const t = pub.track;
        if (!t) continue;
        if (kind === 'video' && (src === 'camera' || src == null)) {
          try {
            const mst = t.mediaStreamTrack;
            if (typeof t.setEnabled === 'function') {
              t.setEnabled(false);
            } else if (mst) {
              mst.enabled = false;
            }
          } catch {}
          await room.localParticipant.unpublishTrack(t as unknown as LocalTrack);
          try {
            t.stop?.();
          } catch {}
        }
      }
    } catch {}
    state.published = false;
    checkAllTracksUnpublished();
    return;
  }

  try {
    // Disable track immediately for snappy UI
    try {
      const t = state.track as unknown as TrackLike;
      if (typeof t.setEnabled === 'function') {
        t.setEnabled(false);
      } else if (t.mediaStreamTrack) {
        t.mediaStreamTrack.enabled = false;
      }
    } catch {}

    await room.localParticipant.unpublishTrack(state.track as unknown as LocalTrack);
    (state.track as unknown as TrackLike).stop?.();
  } catch (error) {
    AVLogger.warn('track.cam.unpublish_error', { error: String(error) });
  }

  state.track = null;
  state.published = false;

  AVLogger.info('track.cam.unpublished');

  checkAllTracksUnpublished();
}

export async function ensureVideoPermissions(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch {
    return false;
  }
}
