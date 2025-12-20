import { useCallback } from 'react';
import { pointInPolygon } from '../../lib/geom';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number; dnd?: boolean };

type Mutable<T> = { current: T };

export function useParticipants(deps: {
  avRef: Mutable<any>;
  zoneRef: Mutable<any>;
  localPosRef: Mutable<{ id: string; x?: number; y?: number }>;
  remotesRef: Mutable<Record<string, { x: number; y: number; dnd?: boolean }>>;
  colyseusToLivekitMap: Mutable<Record<string, string>>;
  identityToNameMap: Mutable<Record<string, string>>;
  volumeRef: Mutable<any>;
  me: { id: string; email?: string; name?: string } | null;
  setUiParticipants: (list: UIParticipant[]) => void;
  disposedRef?: Mutable<boolean>;
  getDisplayName: (identity: string) => string;
  gameBridge?: any;
  dndRef?: Mutable<boolean>;
}) {
  const { avRef, zoneRef, localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, volumeRef, me, setUiParticipants, disposedRef, getDisplayName, gameBridge, dndRef } = deps;

  const buildParticipantList = useCallback(() => {
    const room: any = avRef.current?.room as any;
    // Fallback: Kein LiveKit-Raum – baue Karten aus Colyseus-Remotes + Local (mit Zonenfilter)
    if (!room || !room.localParticipant) {
      const list: UIParticipant[] = [];
      try {
        // Local
        const localIdentity = me?.name || me?.email || me?.id || 'You';
        list.push({ sid: 'local', identity: localIdentity, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!dndRef?.current });
        const zones = (zoneRef.current?.getZones?.() || []).map((z: any) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p: any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
        const localPos = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
        const localZone = zones.find((z: any) => pointInPolygon(localPos, z.points));
        // Remotes (aus Colyseus)
        for (const [colyseusId, pos] of Object.entries(remotesRef.current || {})) {
          try {
            const remoteZone = zones.find((z: any) => pointInPolygon(pos as any, z.points));
            if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
              continue;
            }
          } catch {}
          const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
          const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!pos.dnd });
        }
      } catch {}
      setUiParticipants(list);
      return;
    }

    // LiveKit Raum vorhanden
    const zones = (zoneRef.current?.getZones?.() || []).map((z: any) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p: any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
    const localPos = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
    const localZone = zones.find((z: any) => pointInPolygon(localPos, z.points));
    const activeSet = new Set<string>((room.activeSpeakers || []).map((p: any) => p.sid));

    const list: UIParticipant[] = [];
    const pushP = (p: any, isLocal: boolean = false) => {
      if (!p) return;
      let participantPos: { x: number; y: number } | null = null;
      let remoteDnd = false;
      if (isLocal) {
        participantPos = localPos;
      } else {
        const colyseusId = Object.keys(colyseusToLivekitMap.current).find(
          key => colyseusToLivekitMap.current[key] === p.identity
        );
        if (colyseusId && remotesRef.current[colyseusId]) {
          participantPos = remotesRef.current[colyseusId];
          remoteDnd = !!remotesRef.current[colyseusId].dnd;
        }
      }
      if (!isLocal) {
        // Wenn keine Position bekannt ist, Teilnehmer dennoch aufnehmen (tolerant gegenüber Race-Conditions);
        // Zonenfilter nur anwenden, wenn wir eine Position haben.
        if (participantPos) {
          const remoteZone = zones.find((z: any) => pointInPolygon(participantPos!, z.points));
          if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
            return;
          }
        }
      }
      try {
        const publications = Array.from((p.trackPublications?.values?.() || []) as any);
        // Keine LiveKit-Subscription-Änderungen hier – AV-Manager steuert Subscriptions & Qualitäten zentral
        const isVideoPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          return (!!pub?.track && (source === 'camera' || source === 1));
        };
        const isMicPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          const kind = (pub?.kind ?? pub?.track?.kind);
          if (!(kind === 'audio' || source === 'microphone' || source === 0)) return false;
          const t: any = pub?.track;
          if (!t) return false;
          const mst: any = t.mediaStreamTrack || t;
          const enabled: boolean | undefined = (t.isEnabled ?? t.enabled ?? mst?.enabled);
          const ready: string | undefined = mst?.readyState;
          const pubMuted: boolean = (pub?.muted === true || (pub as any)?.isMuted === true);
          return enabled !== false && !pubMuted && (ready === undefined || ready === 'live');
        };
        const isScreenPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          return (source === 'screen_share' || source === 2);
        };
        const hasV = publications.some(isVideoPub);
        const hasMic = publications.some(isMicPub);
        const hasScreen = publications.some(isScreenPub);
        let displayName = identityToNameMap.current[p.identity] || p.name || p.identity || 'User';
        if (p && p.sid === room.localParticipant?.sid) {
          displayName = me?.name || me?.email || displayName;
        }
        if (!identityToNameMap.current[p.identity] && !p.name) {
          if (displayName.length > 20 && /^[a-zA-Z0-9]+$/.test(displayName)) {
            displayName = `User ${displayName.substring(0, 6)}`;
          }
        }
        const identity = displayName;
        let volume = 1;
        try {
          const last = volumeRef.current?.getLastVolumes?.() || {} as Record<string, number>;
          if (!isLocal) {
            const colyseusIdForIdentity = Object.keys(colyseusToLivekitMap.current).find(
              key => colyseusToLivekitMap.current[key] === p.identity
            );
            if (colyseusIdForIdentity && typeof (last as any)[colyseusIdForIdentity] === 'number') {
              volume = (last as any)[colyseusIdForIdentity];
            }
          }
        } catch {}
        const dnd = isLocal ? !!dndRef?.current : remoteDnd;
        list.push({ sid: p.sid, identity, hasVideo: !!hasV, hasMic: !!hasMic, isSpeaking: activeSet.has(p.sid), media: 'camera', volume, dnd });
        if (hasScreen) {
          list.push({ sid: p.sid + ':screen', identity: `${identity} – Bildschirm`, hasVideo: true, hasMic: false, isSpeaking: false, media: 'screen', volume, dnd });
        }
      } catch {}
    };
    pushP(room.localParticipant, true);
    const remotes = Array.from((room.remoteParticipants?.values?.() || room.participants?.values?.() || []) as any);
    for (const rp of remotes) pushP(rp, false);
    try {
      const presentIdentities = new Set<string>(list.map(p => p.identity));
      for (const [colyseusId, _pos] of Object.entries(remotesRef.current || {})) {
        const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
        const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
        try {
          const zones2 = (zoneRef.current?.getZones?.() || []).map((z: any) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p: any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
          const localPos2 = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
          const localZone2 = zones2.find((z: any) => pointInPolygon(localPos2, z.points));
          const pos = remotesRef.current[colyseusId];
          const remoteZone2 = pos ? zones2.find((z: any) => pointInPolygon(pos, z.points)) : null;
          if ((localZone2 && !remoteZone2) || (!localZone2 && remoteZone2) || (localZone2 && remoteZone2 && localZone2.name !== remoteZone2.name)) {
            continue;
          }
        } catch {}
        if (!presentIdentities.has(name) && !presentIdentities.has(livekitIdentity)) {
          const pos = remotesRef.current[colyseusId];
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!pos?.dnd });
          presentIdentities.add(name);
        }
      }
    } catch {}
    setUiParticipants(list);
    const speakingIds = new Set<string>();
    const activeSpeakers = room.activeSpeakers || [];
    activeSpeakers.forEach((speaker: any) => {
      if (speaker.sid === room.localParticipant?.sid) {
        speakingIds.add('local');
      } else {
        const matchingColyseusIds = Object.entries(colyseusToLivekitMap.current)
          .filter(([_, livekitIdentity]) => livekitIdentity === speaker.identity)
          .map(([colyseusId]) => colyseusId);
        if (matchingColyseusIds.length > 0) {
          const activeColyseusId = matchingColyseusIds.find(id => id in remotesRef.current);
          if (activeColyseusId) speakingIds.add(activeColyseusId);
        }
      }
    });
    try { gameBridge?.updateSpeakingStates?.(speakingIds); } catch {}
  }, [avRef, zoneRef, localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, volumeRef, me, setUiParticipants, disposedRef, getDisplayName, gameBridge]);

  const applyVolumesToUi = useCallback(() => {
    const vols = volumeRef.current?.update() || {};
    const next: Record<string, number> = {};
    for (const [colyseusId, vol] of Object.entries(vols as any)) {
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
      if (livekitIdentity) {
        next[livekitIdentity] = vol as number;
        try {
          const display = getDisplayName(livekitIdentity);
          if (display) next[display] = vol as number;
          next[`${display} – Bildschirm`] = vol as number;
        } catch {}
      }
    }
    // Die UI-Volumes werden in App verwaltet – hier nur list rebuild anstoßen
    try { buildParticipantList(); } catch {}
  }, [volumeRef, colyseusToLivekitMap, getDisplayName, buildParticipantList]);

  return { buildParticipantList, applyVolumesToUi };
}


