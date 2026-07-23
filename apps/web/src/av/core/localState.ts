import type { Room, LocalParticipant, Track, TrackPublication } from 'livekit-client';

interface TrackInfo {
  source?: string | number;
  kind?: string;
  track?: Track & {
    source?: string | number;
    kind?: string;
    isEnabled?: boolean;
    enabled?: boolean;
    mediaStreamTrack?: MediaStreamTrack & {
      enabled?: boolean;
      readyState?: string;
    };
  };
  isEnabled?: boolean;
  enabled?: boolean;
  muted?: boolean;
  isMuted?: boolean;
}

export function isLocalMicOn(room: Room | null | undefined): boolean {
  try {
    const lp: LocalParticipant | undefined = room?.localParticipant;
    if (!lp) return false;
    const pubs: TrackPublication[] = Array.from(lp.trackPublications?.values() || []);
    return pubs.some((pub: TrackPublication) => {
      const pubInfo = pub as unknown as TrackInfo;
      const src = pubInfo.source ?? pubInfo.track?.source;
      const kind = pubInfo.kind ?? pubInfo.track?.kind;
      const t = pubInfo.track;
      if (!t) return false;
      const mst = t.mediaStreamTrack || t;
      const enabled: boolean | undefined = t.isEnabled ?? t.enabled ?? mst?.enabled;
      const ready: string | undefined = mst?.readyState;
      const muted = pubInfo.muted === true || pubInfo.isMuted === true;
      const isMic = kind === 'audio' || src === 'microphone' || src === 0;
      return isMic && !muted && enabled !== false && (ready === undefined || ready === 'live');
    });
  } catch {
    return false;
  }
}

export function isLocalCamOn(room: Room | null | undefined): boolean {
  try {
    const lp: LocalParticipant | undefined = room?.localParticipant;
    if (!lp) return false;
    const pubs: TrackPublication[] = Array.from(lp.trackPublications?.values() || []);
    return pubs.some((pub: TrackPublication) => {
      const pubInfo = pub as unknown as TrackInfo;
      const src = pubInfo.source ?? pubInfo.track?.source;
      const kind = pubInfo.kind ?? pubInfo.track?.kind;
      const t = pubInfo.track;
      if (!t) return false;
      const mst = t.mediaStreamTrack || t;
      const enabled: boolean | undefined = t.isEnabled ?? t.enabled ?? mst?.enabled;
      const ready: string | undefined = mst?.readyState;
      const muted = pubInfo.muted === true || pubInfo.isMuted === true;
      const isCam = src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
      return isCam && !muted && enabled !== false && (ready === undefined || ready === 'live');
    });
  } catch {
    return false;
  }
}

export function isLocalShareOn(room: Room | null | undefined): boolean {
  try {
    const lp: LocalParticipant | undefined = room?.localParticipant;
    if (!lp) return false;
    // `isScreenShareEnabled` is declared on Participant (which LocalParticipant
    // extends), so we can read it directly without an any-cast.
    if (typeof lp.isScreenShareEnabled === 'boolean') return lp.isScreenShareEnabled;
    const pubs: TrackPublication[] = Array.from(lp.trackPublications?.values() || []);
    return pubs.some((pub: TrackPublication) => {
      const pubInfo = pub as unknown as TrackInfo;
      const src = pubInfo.source ?? pubInfo.track?.source;
      return src === 'screen_share' || src === 2 || src === 'screen_share_audio';
    });
  } catch {
    return false;
  }
}
