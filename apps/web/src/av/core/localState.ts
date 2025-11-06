export function isLocalMicOn(room: any): boolean {
  try {
    const lp: any = room?.localParticipant;
    if (!lp) return false;
    const pubs: any[] = Array.from((lp.trackPublications?.values?.() || []) as any);
    return pubs.some((pub: any) => {
      const src = (pub?.source ?? pub?.track?.source);
      const kind = (pub?.kind ?? pub?.track?.kind);
      const t: any = pub?.track;
      if (!t) return false;
      const mst: any = t.mediaStreamTrack || t;
      const enabled: boolean | undefined = (t.isEnabled ?? t.enabled ?? mst?.enabled);
      const ready: string | undefined = mst?.readyState;
      const isMic = kind === 'audio' || src === 'microphone' || src === 0;
      return isMic && enabled !== false && (ready === undefined || ready === 'live');
    });
  } catch {
    return false;
  }
}

export function isLocalCamOn(room: any): boolean {
  try {
    const lp: any = room?.localParticipant;
    if (!lp) return false;
    const pubs: any[] = Array.from((lp.trackPublications?.values?.() || []) as any);
    return pubs.some((pub: any) => {
      const src = (pub?.source ?? pub?.track?.source);
      const kind = (pub?.kind ?? pub?.track?.kind);
      const t: any = pub?.track;
      if (!t) return false;
      const mst: any = t.mediaStreamTrack || t;
      const enabled: boolean | undefined = (t.isEnabled ?? t.enabled ?? mst?.enabled);
      const ready: string | undefined = mst?.readyState;
      const isCam = src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
      return isCam && enabled !== false && (ready === undefined || ready === 'live');
    });
  } catch {
    return false;
  }
}

export function isLocalShareOn(room: any): boolean {
  try {
    const lp: any = room?.localParticipant;
    if (!lp) return false;
    if (typeof lp.isScreenShareEnabled === 'function') return !!lp.isScreenShareEnabled();
    const pubs: any[] = Array.from((lp.trackPublications?.values?.() || []) as any);
    return pubs.some((pub: any) => {
      const src = (pub?.source ?? pub?.track?.source);
      return src === 'screen_share' || src === 2 || src === 'screen_share_audio';
    });
  } catch {
    return false;
  }
}


