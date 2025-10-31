export type DesiredSubscription = { identity: string; audio?: boolean; video?: boolean };

export type ApplySubscriptionsContext = {
  room: any;
  isSignalOpen: () => boolean;
  dnd: boolean;
  desiredIds: string[];
  activeSpeakerIds: string[];
  maxVideoSubs: number;
  setDesired: (pub: any, identity: string, kind: 'audio' | 'video', should: boolean) => void;
  lastDesiredIdsKeyRef: { current: string | null };
};

export function applySubscriptions(ctx: ApplySubscriptionsContext): void {
  const { room, isSignalOpen, dnd, desiredIds, activeSpeakerIds, maxVideoSubs, setDesired, lastDesiredIdsKeyRef } = ctx;
  if (!room || dnd) return;
  const st = room.connectionState || room.state;
  if (!(st === 'connected' || st === 2) || !isSignalOpen()) return;
  const participants: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
  const participantCount = participants.length;
  const key = JSON.stringify(desiredIds) + '|' + JSON.stringify(activeSpeakerIds.slice(0, maxVideoSubs)) + '|' + participantCount;
  if (key === lastDesiredIdsKeyRef.current) return;
  lastDesiredIdsKeyRef.current = key;

  try {
    const desiredSet = new Set(desiredIds.map((id) => String(id)));
    const prioritizedVideoSet = new Set<string>(desiredIds.slice(0, maxVideoSubs).map((id) => String(id)));
    const activeVideoSet = new Set<string>(activeSpeakerIds.slice(0, maxVideoSubs).map((id) => String(id)));
    const few = participantCount <= maxVideoSubs || maxVideoSubs === 0;
    for (const p of participants) {
      const identity = String(p.identity || '');
      const shouldSub = desiredSet.has(identity);
      const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
      for (const pub of pubs) {
        const kind = (pub as any).kind ?? (pub.track as any)?.kind;
        const src = (pub as any).source ?? (pub.track as any)?.source;
        if (kind === 'audio') setDesired(pub, identity, 'audio', true);
        if (kind === 'video') {
          const near = src === 'screen_share' || few || prioritizedVideoSet.has(identity) || activeVideoSet.has(identity) || shouldSub;
          try { console.debug('[AV][debug] setDesired.video', { identity, src, near, few, active: Array.from(activeVideoSet), desired: Array.from(prioritizedVideoSet) }); } catch {}
          setDesired(pub, identity, 'video', !!near);
        }
      }
    }
    // Telemetrie-Hook (optional): Anzahl Teilnehmer und Keys zusammenfassen
    try { (window as any).__avLastApply = { n: participants.length, key }; } catch {}
  } catch {}
}

export function ensureSubscribeAllAudio(room: any, isSignalOpen: () => boolean, setDesired: (pub: any, identity: string, kind: 'audio' | 'video', should: boolean) => void, maxCount: number = 32): void {
  if (!room) return;
  const st = room.connectionState || room.state;
  if (!(st === 'connected' || st === 2) || !isSignalOpen()) return;
  try {
    const parts: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
    let count = 0;
    for (const p of parts) {
      const identity = String(p.identity || '');
      const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
      for (const pub of pubs) {
        const kind = (pub as any).kind ?? (pub as any)?.track?.kind;
        if (kind === 'audio') {
          if (count < maxCount) {
            setDesired(pub, identity, 'audio', true);
            count++;
          }
        }
      }
    }
  } catch {}
}


