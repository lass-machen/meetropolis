import { useCallback } from 'react';
import { pointInPolygon } from '../../lib/geom';
import type { Room, Participant, TrackPublication } from 'livekit-client';
import type { Zone, ZoneManager, GameBridge, VolumeManager, Position, RemotePlayer } from '../../types/game';
import type { AVManager } from '../../types/av';

export type UIParticipant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number; dnd?: boolean; avatarId?: string };

type Mutable<T> = { current: T };

export function useParticipants(deps: {
  avRef: Mutable<AVManager | null>;
  zoneRef: Mutable<ZoneManager | null>;
  localPosRef: Mutable<{ id: string; x?: number; y?: number }>;
  remotesRef: Mutable<Record<string, RemotePlayer>>;
  colyseusToLivekitMap: Mutable<Record<string, string>>;
  identityToNameMap: Mutable<Record<string, string>>;
  volumeRef: Mutable<VolumeManager | null>;
  me: { id: string; email?: string; name?: string } | null;
  setUiParticipants: (list: UIParticipant[]) => void;
  disposedRef?: Mutable<boolean>;
  getDisplayName: (identity: string) => string;
  gameBridge?: GameBridge;
  dndRef?: Mutable<boolean>;
}) {
  const { avRef, zoneRef, localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, volumeRef, me, setUiParticipants, disposedRef, getDisplayName, gameBridge, dndRef } = deps;

  const buildParticipantList = useCallback(() => {
    const room: Room | null | undefined = avRef.current?.room;
    // Fallback: Kein LiveKit-Raum – baue Karten aus Colyseus-Remotes + Local (mit Zonenfilter)
    if (!room || !room.localParticipant) {
      const list: UIParticipant[] = [];
      try {
        // Local
        const localIdentity = me?.name || me?.email || me?.id || 'You';
        const localAvatarId = localStorage.getItem('avatarId') || '';
        list.push({ sid: 'local', identity: localIdentity, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!dndRef?.current, ...(localAvatarId ? { avatarId: localAvatarId } : {}) });
        const zones = (zoneRef.current?.getZones?.() || []).map((z: Zone) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: unknown)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p as Position).filter((p: Position | unknown): p is Position => p !== null && typeof p === 'object' && 'x' in p && 'y' in p && typeof (p as Position).x === 'number' && typeof (p as Position).y === 'number') }));
        const localPos: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
        const localZone = zones.find((z: Zone) => pointInPolygon(localPos, z.points));
        // Remotes (aus Colyseus)
        for (const [colyseusId, pos] of Object.entries(remotesRef.current || {})) {
          try {
            const remoteZone = zones.find((z: Zone) => pointInPolygon(pos, z.points));
            if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
              continue;
            }
          } catch {}
          const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
          const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
          const remAvId = remotesRef.current[colyseusId]?.avatarId;
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!pos.dnd, ...(remAvId ? { avatarId: remAvId } : {}) });
        }
      } catch {}
      setUiParticipants(list);
      return;
    }

    // LiveKit Raum vorhanden
    const zones = (zoneRef.current?.getZones?.() || []).map((z: Zone) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: unknown)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p as Position).filter((p: Position | unknown): p is Position => p !== null && typeof p === 'object' && 'x' in p && 'y' in p && typeof (p as Position).x === 'number' && typeof (p as Position).y === 'number') }));
    const localPos: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
    const localZone = zones.find((z: Zone) => pointInPolygon(localPos, z.points));
    const activeSet = new Set<string>((room.activeSpeakers || []).map((p: Participant) => p.sid));

    const list: UIParticipant[] = [];
    const pushP = (p: Participant, isLocal: boolean = false) => {
      if (!p) return;
      let participantPos: Position | null = null;
      let remoteDnd = false;
      let remoteAvatarId: string | undefined;
      if (isLocal) {
        participantPos = localPos;
      } else {
        const colyseusId = Object.keys(colyseusToLivekitMap.current).find(
          key => colyseusToLivekitMap.current[key] === p.identity
        );
        if (colyseusId && remotesRef.current[colyseusId]) {
          participantPos = remotesRef.current[colyseusId];
          remoteDnd = !!remotesRef.current[colyseusId].dnd;
          remoteAvatarId = remotesRef.current[colyseusId].avatarId;
        }
      }
      if (!isLocal) {
        // If we have no position data for this participant, they're likely on another map
        if (!participantPos) {
          return; // Don't show participants without position (different map)
        }
        const remoteZone = zones.find((z: Zone) => pointInPolygon(participantPos!, z.points));
        if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
          return;
        }
      }
      try {
        const publications = Array.from(p.trackPublications?.values() || []);
        // Keine LiveKit-Subscription-Änderungen hier – AV-Manager steuert Subscriptions & Qualitäten zentral
        const isVideoPub = (pub: TrackPublication) => {
          const source = (pub?.source ?? pub?.track?.source);
          return (!!pub?.track && (source === 'camera' || source === 1));
        };
        const isMicPub = (pub: TrackPublication) => {
          const source = (pub?.source ?? pub?.track?.source);
          const kind = (pub?.kind ?? pub?.track?.kind);
          if (!(kind === 'audio' || source === 'microphone' || source === 0)) return false;
          const t = pub?.track;
          if (!t) return false;
          const tExtended = t as typeof t & {
            isEnabled?: boolean;
            enabled?: boolean;
            mediaStreamTrack?: MediaStreamTrack & {
              enabled?: boolean;
              readyState?: string;
            };
          };
          const mst = tExtended.mediaStreamTrack || tExtended;
          const enabled: boolean | undefined = (tExtended.isEnabled ?? tExtended.enabled ?? mst?.enabled);
          const ready: string | undefined = mst?.readyState;
          const pubExtended = pub as TrackPublication & { muted?: boolean; isMuted?: boolean };
          const pubMuted: boolean = (pubExtended?.muted === true || pubExtended?.isMuted === true);
          return enabled !== false && !pubMuted && (ready === undefined || ready === 'live');
        };
        const isScreenPub = (pub: TrackPublication) => {
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
          const last = volumeRef.current?.getLastVolumes?.() || {};
          if (!isLocal) {
            const colyseusIdForIdentity = Object.keys(colyseusToLivekitMap.current).find(
              key => colyseusToLivekitMap.current[key] === p.identity
            );
            if (colyseusIdForIdentity && typeof last[colyseusIdForIdentity] === 'number') {
              volume = last[colyseusIdForIdentity];
            }
          }
        } catch {}
        const dnd = isLocal ? !!dndRef?.current : remoteDnd;
        const pAvatarId = isLocal ? (localStorage.getItem('avatarId') || '') : (remoteAvatarId || '');
        list.push({ sid: p.sid, identity, hasVideo: !!hasV, hasMic: !!hasMic, isSpeaking: !!hasMic && activeSet.has(p.sid), media: 'camera', volume, dnd, ...(pAvatarId ? { avatarId: pAvatarId } : {}) });
        if (hasScreen) {
          list.push({ sid: p.sid + ':screen', identity: `${identity} – Bildschirm`, hasVideo: true, hasMic: false, isSpeaking: false, media: 'screen', volume, dnd });
        }
      } catch {}
    };
    pushP(room.localParticipant, true);
    const remotes = Array.from(room.remoteParticipants?.values() || room.participants?.values() || []);
    for (const rp of remotes) pushP(rp, false);
    try {
      const presentIdentities = new Set<string>(list.map(p => p.identity));
      for (const [colyseusId, _pos] of Object.entries(remotesRef.current || {})) {
        const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
        const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
        try {
          const zones2 = (zoneRef.current?.getZones?.() || []).map((z: Zone) => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p: unknown)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p as Position).filter((p: Position | unknown): p is Position => p !== null && typeof p === 'object' && 'x' in p && 'y' in p && typeof (p as Position).x === 'number' && typeof (p as Position).y === 'number') }));
          const localPos2: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
          const localZone2 = zones2.find((z: Zone) => pointInPolygon(localPos2, z.points));
          const pos = remotesRef.current[colyseusId];
          const remoteZone2 = pos ? zones2.find((z: Zone) => pointInPolygon(pos, z.points)) : null;
          if ((localZone2 && !remoteZone2) || (!localZone2 && remoteZone2) || (localZone2 && remoteZone2 && localZone2.name !== remoteZone2.name)) {
            continue;
          }
        } catch {}
        if (!presentIdentities.has(name) && !presentIdentities.has(livekitIdentity)) {
          const pos = remotesRef.current[colyseusId];
          const colAvId = remotesRef.current[colyseusId]?.avatarId;
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1, dnd: !!pos?.dnd, ...(colAvId ? { avatarId: colAvId } : {}) });
          presentIdentities.add(name);
        }
      }
    } catch {}
    setUiParticipants(list);
    const speakingIds = new Set<string>();
    const activeSpeakers = room.activeSpeakers || [];
    activeSpeakers.forEach((speaker: Participant) => {
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
    for (const [colyseusId, vol] of Object.entries(vols)) {
      if (typeof vol !== 'number') continue;
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
      if (livekitIdentity) {
        next[livekitIdentity] = vol;
        try {
          const display = getDisplayName(livekitIdentity);
          if (display) next[display] = vol;
          next[`${display} – Bildschirm`] = vol;
        } catch {}
      }
    }
    // Die UI-Volumes werden in App verwaltet – hier nur list rebuild anstoßen
    try { buildParticipantList(); } catch {}
  }, [volumeRef, colyseusToLivekitMap, getDisplayName, buildParticipantList]);

  return { buildParticipantList, applyVolumesToUi };
}


