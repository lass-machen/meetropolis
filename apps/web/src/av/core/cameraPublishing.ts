import type { LocalVideoTrack, Room } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import type { LocalTrackState } from './types';

function getLocalTrackPublications(room: Room): any[] {
  try {
    const iter = (room as any)?.localParticipant?.trackPublications?.values?.();
    if (!iter) return [];
    return Array.from(iter);
  } catch {
    return [];
  }
}

async function unpublishNonLiveCameraTracks(room: Room): Promise<void> {
  try {
    const pubs = getLocalTrackPublications(room);
    for (const pub of pubs) {
      const src = pub?.source ?? pub?.track?.source;
      const kind = pub?.kind ?? pub?.track?.kind;
      const t = pub?.track;
      if (!t) continue;
      if (kind !== 'video') continue;
      if (src === 'screen_share') continue;
      if (!(src === 'camera' || src === 1 || src == null)) continue;

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
        await room.localParticipant.unpublishTrack(t);
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

export async function publishCamera({
  room,
  state,
  watchTrackEnded,
  onTrackPublished,
  onTrackEndedByBrowser,
}: PublishCameraParams): Promise<void> {
  // Prefer an existing, live camera publication to avoid duplicates after reconnect/desync
  try {
    const pubs = getLocalTrackPublications(room);
    const livePub = pubs.find((pub: any) => {
      const src = pub?.source ?? pub?.track?.source;
      const kind = pub?.kind ?? pub?.track?.kind;
      const t = pub?.track;
      const mst = t?.mediaStreamTrack;
      if (kind !== 'video') return false;
      if (src === 'screen_share') return false;
      const readyState = mst?.readyState;
      const isLive = readyState === undefined || readyState === 'live';
      return (src === 'camera' || src === 1 || src == null) && isLive;
    });
    if (livePub?.track) {
      state.track = livePub.track as LocalVideoTrack;
      state.published = true;
      AVLogger.debug('track.cam.already_published');
      return;
    }
  } catch {}

  // Check if already published with a live track
  if (state.published && state.track) {
    const mst = (state.track as any).mediaStreamTrack;
    if (mst?.readyState === 'live') {
      AVLogger.debug('track.cam.already_published');
      return;
    }
    await unpublishCamera({ room, state, checkAllTracksUnpublished: () => {} });
  }

  try {
    await unpublishNonLiveCameraTracks(room);
    const { createLocalTracks } = await import('livekit-client');

    const constraints: any = {
      video: state.preferredDeviceId
        ? { deviceId: state.preferredDeviceId, facingMode: 'user' }
        : { facingMode: 'user' },
    };

    const tracks = await createLocalTracks(constraints);
    const videoTrack = tracks.find((t: any) => t.kind === 'video') as LocalVideoTrack | undefined;

    if (!videoTrack) {
      throw new Error('No video track created');
    }

    await room.localParticipant.publishTrack(videoTrack);

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
        const src = pub?.source ?? pub?.track?.source;
        const kind = pub?.kind ?? pub?.track?.kind;
        const t = pub?.track;
        if (!t) continue;
        if (kind === 'video' && (src === 'camera' || src === 1 || src == null)) {
          if (src === 'screen_share') continue;
          try {
            const mst = t.mediaStreamTrack;
            if (typeof t.setEnabled === 'function') {
              t.setEnabled(false);
            } else if (mst) {
              mst.enabled = false;
            }
          } catch {}
          await room.localParticipant.unpublishTrack(t);
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
      const t = state.track as any;
      if (typeof t.setEnabled === 'function') {
        t.setEnabled(false);
      } else if (t.mediaStreamTrack) {
        t.mediaStreamTrack.enabled = false;
      }
    } catch {}

    await room.localParticipant.unpublishTrack(state.track as any);
    (state.track as any).stop?.();
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
