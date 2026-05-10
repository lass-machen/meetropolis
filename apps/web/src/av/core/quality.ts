import type { LocalTrack, Room, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { avLog } from '../../lib/avLog';
import {
  listPublications,
  readPubKind,
  readPubSource,
  type TrackPublicationLike,
  type TrackLike,
} from '../../types/livekit';

interface QualityManagerView {
  current: Room | null;
  camQuality: 'low' | 'med' | 'high';
  qualityCooldownUntil: number;
  preferredCam?: string;
  identity?: string;
  currentName?: string | null;
  remoteQualityTuningDisabled?: boolean;
  lastApplyDefaultRemoteQualityAt?: number;
  isSignalOpen?: () => boolean;
}

interface VideoConstraintsLike {
  facingMode?: string;
  width?: { ideal: number };
  height?: { ideal: number };
  frameRate?: { ideal: number };
  deviceId?: string;
}

export async function republishCameraProfileImpl(
  manager: QualityManagerView,
  profile: 'low' | 'med' | 'high',
): Promise<void> {
  const room = manager.current;
  if (!room) return;
  try {
    const pubs = listPublications(room.localParticipant);
    const camPubs = pubs.filter((pub) => {
      const src = readPubSource(pub);
      const kind = readPubKind(pub);
      return src === 'camera' || (kind === 'video' && src !== 'screen_share');
    });
    if (!camPubs.some((p) => !!p.track)) {
      manager.camQuality = profile;
      return;
    }
    for (const pub of camPubs) {
      try {
        if (pub.track) await room.localParticipant.unpublishTrack(pub.track as LocalTrack);
      } catch {}
    }
    const presets: Record<
      'low' | 'med' | 'high',
      { width: number; height: number; frameRate: number; bitrate: number }
    > = {
      low: { width: 320, height: 180, frameRate: 15, bitrate: 220_000 },
      med: { width: 640, height: 360, frameRate: 24, bitrate: 550_000 },
      high: { width: 960, height: 540, frameRate: 30, bitrate: 1_200_000 },
    };
    const c = presets[profile];
    const { createLocalTracks } = await import('livekit-client');
    const videoConstraints: VideoConstraintsLike = {
      facingMode: 'user',
      width: { ideal: c.width },
      height: { ideal: c.height },
      frameRate: { ideal: c.frameRate },
    };
    if (manager.preferredCam) videoConstraints.deviceId = manager.preferredCam;
    const tracks = await createLocalTracks({ video: videoConstraints } as unknown as Parameters<
      typeof createLocalTracks
    >[0]);
    for (const t of tracks) {
      const trackLike = t as TrackLike;
      if (String(trackLike.kind) === 'video') {
        try {
          try {
            const mst = trackLike.mediaStreamTrack;
            if (mst && 'contentHint' in mst) {
              try {
                mst.contentHint = 'motion';
              } catch {}
            }
          } catch {}
          await room.localParticipant.publishTrack(t, {
            videoEncoding: { maxBitrate: c.bitrate, maxFramerate: c.frameRate },
            simulcast: true,
          });
        } catch {}
      }
    }
    manager.camQuality = profile;
  } catch {}
}

export function onConnectionQualityChangedImpl(
  manager: QualityManagerView,
  participant: { isLocal?: boolean; sid?: string } | null | undefined,
  quality: unknown,
): void {
  const room = manager.current;
  if (!room) return;
  const isLocal = !!participant?.isLocal || participant?.sid === room?.localParticipant?.sid;
  if (!isLocal) return;
  const now = Date.now();
  if (now < manager.qualityCooldownUntil) return;
  const q =
    typeof quality === 'string'
      ? quality
      : (quality as { toString?: () => string })?.toString?.().toLowerCase?.() || String(quality);
  let desired: 'low' | 'med' | 'high' = manager.camQuality;
  if (q.includes('poor') || q.includes('lost') || q.includes('bad') || q.includes('0')) desired = 'low';
  else if (q.includes('good') || q.includes('2')) desired = 'med';
  else if (q.includes('excellent') || q.includes('3')) desired = 'high';
  else desired = 'med';
  if (desired === manager.camQuality) return;
  manager.qualityCooldownUntil = now + 8000;
  void republishCameraProfileImpl(manager, desired).catch(() => {});
}

export async function applyDefaultRemoteQualityImpl(manager: QualityManagerView): Promise<void> {
  const room = manager.current;
  if (!room) return;
  if (manager.remoteQualityTuningDisabled) return;
  // Wenn verfügbar: nur arbeiten, wenn Signalkanals offen ist
  if (typeof manager.isSignalOpen === 'function' && !manager.isSignalOpen()) return;
  try {
    const now = Date.now();
    if (now - (manager.lastApplyDefaultRemoteQualityAt || 0) < 5000) return;
    manager.lastApplyDefaultRemoteQualityAt = now;
    const mod = await import('livekit-client');
    const VideoQualityEnum = (mod as unknown as { VideoQuality?: Record<string, unknown> }).VideoQuality;
    const Q_MED = (VideoQualityEnum && (VideoQualityEnum.Medium ?? VideoQualityEnum.MEDIUM)) ?? 1;
    const participants: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
    for (const p of participants) {
      const pubs = listPublications(p) as Array<TrackPublicationLike & RemoteTrackPublication>;
      for (const pub of pubs) {
        const kind = readPubKind(pub);
        const src = readPubSource(pub);
        // Nur Qualität setzen, wenn wir tatsächlich subscribed sind
        const isSubscribed = (() => {
          try {
            if (typeof pub.isSubscribed === 'boolean') return pub.isSubscribed;
            if (typeof pub.subscribed === 'boolean') return pub.subscribed;
            return !!pub.track;
          } catch {
            return false;
          }
        })();
        if (kind === 'video' && src !== 'screen_share' && isSubscribed) {
          try {
            if (typeof pub.setVideoQuality === 'function') {
              pub.setVideoQuality(Q_MED);
            } else if (typeof pub.setPreferredVideoQuality === 'function') {
              pub.setPreferredVideoQuality(Q_MED);
            }
          } catch {}
        }
      }
    }
  } catch (e: unknown) {
    manager.remoteQualityTuningDisabled = true;
    try {
      const extra: { identity?: string; roomName?: string } = {};
      if (manager.identity) extra.identity = manager.identity;
      if (manager.currentName) extra.roomName = manager.currentName;
      avLog('warn', 'av.remote_quality.disabled', { reason: (e as Error)?.message || String(e) }, extra);
    } catch {}
  }
}
