import { avLog } from '../../lib/avLog';

export async function republishCameraProfileImpl(manager: any, profile: 'low' | 'med' | 'high'): Promise<void> {
  const room = manager.current;
  if (!room) return;
  try {
    const pubs: any[] = Array.from(room.localParticipant.trackPublications.values());
    const camPubs: any[] = pubs.filter((pub: any) => {
      const src = pub.source ?? pub.track?.source;
      const kind = pub.kind ?? pub.track?.kind;
      return src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
    });
    if (!camPubs.some((p: any) => !!p.track)) {
      manager.camQuality = profile;
      return;
    }
    for (const pub of camPubs) {
      try {
        await room.localParticipant.unpublishTrack(pub.track);
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
    const videoConstraints: any = {
      facingMode: 'user',
      width: { ideal: c.width },
      height: { ideal: c.height },
      frameRate: { ideal: c.frameRate },
    };
    if (manager.preferredCam) videoConstraints.deviceId = manager.preferredCam;
    const tracks = await createLocalTracks({ video: videoConstraints });
    for (const t of tracks) {
      const tAny = t as any;
      if (tAny.kind === 'video') {
        try {
          try {
            const mst = tAny.mediaStreamTrack;
            if (mst && 'contentHint' in mst) {
              try {
                mst.contentHint = 'motion';
              } catch {}
            }
          } catch {}
          await room.localParticipant.publishTrack(tAny, {
            videoEncoding: { maxBitrate: c.bitrate, maxFramerate: c.frameRate },
            simulcast: true,
          });
        } catch {}
      }
    }
    manager.camQuality = profile;
  } catch {}
}

export function onConnectionQualityChangedImpl(manager: any, participant: any, quality: any): void {
  const room = manager.current;
  if (!room) return;
  const isLocal = !!participant?.isLocal || participant?.sid === room?.localParticipant?.sid;
  if (!isLocal) return;
  const now = Date.now();
  if (now < manager.qualityCooldownUntil) return;
  const q = typeof quality === 'string' ? quality : quality?.toString?.().toLowerCase?.() || String(quality);
  let desired: 'low' | 'med' | 'high' = manager.camQuality;
  if (q.includes('poor') || q.includes('lost') || q.includes('bad') || q.includes('0')) desired = 'low';
  else if (q.includes('good') || q.includes('2')) desired = 'med';
  else if (q.includes('excellent') || q.includes('3')) desired = 'high';
  else desired = 'med';
  if (desired === manager.camQuality) return;
  manager.qualityCooldownUntil = now + 8000;
  void republishCameraProfileImpl(manager, desired).catch(() => {});
}

export async function applyDefaultRemoteQualityImpl(manager: any): Promise<void> {
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
    const VideoQualityEnum = (mod as any).VideoQuality;
    const Q_MED = (VideoQualityEnum && (VideoQualityEnum.Medium ?? VideoQualityEnum.MEDIUM)) ?? 1;
    const participants: any[] = Array.from(room.remoteParticipants?.values?.() || []);
    for (const p of participants) {
      const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
      for (const pub of pubs) {
        const kind = pub.kind ?? pub.track?.kind;
        const src = pub.source ?? pub.track?.source;
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
      avLog(
        'warn',
        'av.remote_quality.disabled',
        { reason: (e as Error)?.message || String(e) },
        { identity: manager.identity, roomName: manager.currentName || undefined },
      );
    } catch {}
  }
}
