import { useCallback } from 'react';
import { pointInPolygon } from '../../lib/geom';
import { Track } from 'livekit-client';
import type { Room, Participant, TrackPublication } from 'livekit-client';
import type { Zone, ZoneManager, GameBridge, VolumeManager, Position, RemotePlayer } from '../../types/game';
import type { AVManager } from '../../types/av';
import type { UiParticipant } from '../../types/participant';

export type { UiParticipant } from '../../types/participant';

type Mutable<T> = { current: T };

type ParticipantsDeps = {
  avRef: Mutable<AVManager | null>;
  zoneRef: Mutable<ZoneManager | null>;
  localPosRef: Mutable<{ id: string; x?: number; y?: number }>;
  remotesRef: Mutable<Record<string, RemotePlayer>>;
  colyseusToLivekitMap: Mutable<Record<string, string>>;
  identityToNameMap: Mutable<Record<string, string>>;
  volumeRef: Mutable<VolumeManager | null>;
  me: { id: string; email?: string; name?: string } | null;
  setUiParticipants: (list: UiParticipant[]) => void;
  disposedRef?: Mutable<boolean>;
  getDisplayName: (identity: string) => string;
  gameBridge?: GameBridge;
  dndRef?: Mutable<boolean>;
};

function isPosition(p: unknown): p is Position {
  return (
    p !== null &&
    typeof p === 'object' &&
    'x' in p &&
    'y' in p &&
    typeof (p as Position).x === 'number' &&
    typeof (p as Position).y === 'number'
  );
}

function getZonesNormalized(zoneRef: Mutable<ZoneManager | null>): Zone[] {
  return (zoneRef.current?.getZones?.() || []).map((z: Zone) => ({
    ...z,
    points: (Array.isArray(z.points) ? z.points : [])
      .map((p: unknown) => {
        if (Array.isArray(p)) {
          const tuple = p as [number, number];
          return { x: tuple[0], y: tuple[1] };
        }
        return p as Position;
      })
      .filter(isPosition),
  }));
}

function zonesDiffer(localZone: Zone | undefined, remoteZone: Zone | undefined): boolean {
  return !!(
    (localZone && !remoteZone) ||
    (!localZone && remoteZone) ||
    (localZone && remoteZone && localZone.name !== remoteZone.name)
  );
}

function buildFallbackList(deps: ParticipantsDeps): UiParticipant[] {
  const { localPosRef, remotesRef, colyseusToLivekitMap, identityToNameMap, getDisplayName, dndRef, me, zoneRef } =
    deps;
  const list: UiParticipant[] = [];
  try {
    const localDisplayName = me?.name || me?.email || me?.id || 'You';
    const localAvatarId = localStorage.getItem('avatarId') || '';
    list.push({
      sid: 'local',
      // No room means no LiveKit participant to bind this tile to; the empty
      // identity keeps the resolver from guessing one.
      livekitIdentity: '',
      displayName: localDisplayName,
      hasVideo: false,
      hasMic: false,
      isSpeaking: false,
      media: 'camera',
      volume: 1,
      dnd: !!dndRef?.current,
      ...(localAvatarId ? { avatarId: localAvatarId } : {}),
    });
    const zones = getZonesNormalized(zoneRef);
    const localPos: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
    const localZone = zones.find((z: Zone) => pointInPolygon(localPos, z.points));
    for (const [colyseusId, pos] of Object.entries(remotesRef.current || {})) {
      try {
        const remoteZone = zones.find((z: Zone) => pointInPolygon(pos, z.points));
        if (zonesDiffer(localZone, remoteZone)) continue;
      } catch {}
      // The Colyseus id is NOT a LiveKit identity. Writing it into
      // `livekitIdentity` would hand the resolver (and force-mute) a key that
      // `Room.remoteParticipants` can never hold, so the field stays empty
      // until the mapping actually knows one. The label still falls back to
      // the Colyseus id, which is only ever read by humans.
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || '';
      const nameKey = livekitIdentity || colyseusId;
      const name = identityToNameMap.current[nameKey] || getDisplayName(nameKey);
      const remAvId = remotesRef.current[colyseusId]?.avatarId;
      list.push({
        sid: `col:${colyseusId}`,
        livekitIdentity,
        displayName: name,
        hasVideo: false,
        hasMic: false,
        isSpeaking: false,
        media: 'camera',
        volume: 1,
        dnd: !!pos.dnd,
        ...(remAvId ? { avatarId: remAvId } : {}),
      });
    }
  } catch {}
  return list;
}

const isVideoPub = (pub: TrackPublication) => {
  const source = pub?.source ?? pub?.track?.source;
  return !!pub?.track && source === Track.Source.Camera;
};

const isMicPub = (pub: TrackPublication) => {
  const source = pub?.source ?? pub?.track?.source;
  const kind = pub?.kind ?? pub?.track?.kind;
  if (!(kind === Track.Kind.Audio || source === Track.Source.Microphone)) return false;
  const t = pub?.track;
  if (!t) return false;
  const tExtended = t as typeof t & {
    isEnabled?: boolean;
    enabled?: boolean;
    mediaStreamTrack?: MediaStreamTrack & { enabled?: boolean; readyState?: string };
  };
  const mst = tExtended.mediaStreamTrack || tExtended;
  const enabled: boolean | undefined = tExtended.isEnabled ?? tExtended.enabled ?? mst?.enabled;
  const ready: string | undefined = mst?.readyState;
  const pubExtended = pub as TrackPublication & { muted?: boolean; isMuted?: boolean };
  const pubMuted: boolean = pubExtended?.muted === true || pubExtended?.isMuted === true;
  return enabled !== false && !pubMuted && (ready === undefined || ready === 'live');
};

const isScreenPub = (pub: TrackPublication) => {
  const source = pub?.source ?? pub?.track?.source;
  return source === Track.Source.ScreenShare;
};

function resolveDisplayName(p: Participant, room: Room, deps: ParticipantsDeps): string {
  const { identityToNameMap, me } = deps;
  let displayName = identityToNameMap.current[p.identity] || p.name || p.identity || 'User';
  if (p && p.sid === room.localParticipant?.sid) {
    displayName = me?.name || me?.email || displayName;
  }
  if (!identityToNameMap.current[p.identity] && !p.name) {
    if (displayName.length > 20 && /^[a-zA-Z0-9]+$/.test(displayName)) {
      displayName = `User ${displayName.substring(0, 6)}`;
    }
  }
  return displayName;
}

function resolveParticipantPos(
  p: Participant,
  isLocal: boolean,
  deps: ParticipantsDeps,
  localPos: Position,
): { pos: Position | null; remoteDnd: boolean; remoteAvatarId: string | undefined } {
  if (isLocal) return { pos: localPos, remoteDnd: false, remoteAvatarId: undefined };
  const { colyseusToLivekitMap, remotesRef } = deps;
  const colyseusId = Object.keys(colyseusToLivekitMap.current).find(
    (key) => colyseusToLivekitMap.current[key] === p.identity,
  );
  if (colyseusId && remotesRef.current[colyseusId]) {
    const r = remotesRef.current[colyseusId];
    return { pos: r, remoteDnd: !!r.dnd, remoteAvatarId: r.avatarId };
  }
  return { pos: null, remoteDnd: false, remoteAvatarId: undefined };
}

function resolveVolumeForParticipant(p: Participant, isLocal: boolean, deps: ParticipantsDeps): number {
  const { volumeRef, colyseusToLivekitMap } = deps;
  let volume = 1;
  try {
    const last = volumeRef.current?.getLastVolumes?.() || {};
    if (!isLocal) {
      const colyseusIdForIdentity = Object.keys(colyseusToLivekitMap.current).find(
        (key) => colyseusToLivekitMap.current[key] === p.identity,
      );
      if (colyseusIdForIdentity && typeof last[colyseusIdForIdentity] === 'number') {
        volume = last[colyseusIdForIdentity];
      }
    }
  } catch {}
  return volume;
}

function pushParticipant(
  list: UiParticipant[],
  p: Participant,
  isLocal: boolean,
  ctx: {
    room: Room;
    zones: Zone[];
    localZone: Zone | undefined;
    localPos: Position;
    activeSet: Set<string>;
    deps: ParticipantsDeps;
  },
): void {
  if (!p) return;
  const { room, zones, localZone, localPos, activeSet, deps } = ctx;
  const { dndRef } = deps;
  const { pos: participantPos, remoteDnd, remoteAvatarId } = resolveParticipantPos(p, isLocal, deps, localPos);
  if (!isLocal) {
    if (!participantPos) return;
    const remoteZone = zones.find((z: Zone) => pointInPolygon(participantPos, z.points));
    if (zonesDiffer(localZone, remoteZone)) return;
  }
  try {
    const publications = Array.from(p.trackPublications?.values() || []);
    const hasV = publications.some(isVideoPub);
    const hasMic = publications.some(isMicPub);
    const hasScreen = publications.some(isScreenPub);
    const displayName = resolveDisplayName(p, room, deps);
    const volume = resolveVolumeForParticipant(p, isLocal, deps);
    const dnd = isLocal ? !!dndRef?.current : remoteDnd;
    const pAvatarId = isLocal ? localStorage.getItem('avatarId') || '' : remoteAvatarId || '';
    list.push({
      sid: p.sid,
      livekitIdentity: p.identity,
      displayName,
      hasVideo: !!hasV,
      hasMic: !!hasMic,
      // DND guard: the sender-side soft-mute propagates asynchronously, so a
      // DND-marked participant can still be reported as an active speaker.
      isSpeaking: !!hasMic && !dnd && activeSet.has(p.sid),
      media: 'camera',
      volume,
      dnd,
      ...(pAvatarId ? { avatarId: pAvatarId } : {}),
    });
    if (hasScreen) {
      // Screen-share entry: identity and label stay the same as the camera
      // entry because `media: 'screen'` plus the ':screen' sid suffix already
      // discriminate the two. The UI appends a localised suffix at render
      // time (see ParticipantCard / UserCard via t('participant.screenSuffix')).
      list.push({
        sid: p.sid + ':screen',
        livekitIdentity: p.identity,
        displayName,
        hasVideo: true,
        hasMic: false,
        isSpeaking: false,
        media: 'screen',
        volume,
        dnd,
      });
    }
  } catch {}
}

function appendOrphanColyseusRemotes(list: UiParticipant[], deps: ParticipantsDeps): void {
  const { remotesRef, colyseusToLivekitMap, identityToNameMap, getDisplayName, zoneRef, localPosRef } = deps;
  try {
    // Dedupe against two separate namespaces. An identity is a key, a display
    // name is a label; mixing them into one set lets a display name that
    // happens to equal somebody else's user id suppress a presence tile.
    // Identity is the reliable half — the name check only exists because a
    // Colyseus remote can predate its LiveKit mapping and then has no identity
    // to compare at all.
    //
    // Hence the asymmetry below: an entry that HAS an identity is deduped by
    // that identity alone and contributes nothing to the name set. Whoever
    // else happens to be called "Max" is a different person and keeps a tile
    // of their own — two guests sharing a display name is ordinary, and
    // hiding the second one is exactly the bug the identity keying was meant
    // to end. Only identity-less entries are matched by name, against each
    // other.
    const presentIdentities = new Set<string>();
    const presentDisplayNames = new Set<string>();
    for (const entry of list) {
      if (entry.livekitIdentity) presentIdentities.add(entry.livekitIdentity);
      else presentDisplayNames.add(entry.displayName);
    }
    for (const [colyseusId] of Object.entries(remotesRef.current || {})) {
      // Empty rather than the Colyseus id: see buildFallbackList.
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || '';
      const nameKey = livekitIdentity || colyseusId;
      const name = identityToNameMap.current[nameKey] || getDisplayName(nameKey);
      try {
        const zones2 = getZonesNormalized(zoneRef);
        const localPos2: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
        const localZone2 = zones2.find((z: Zone) => pointInPolygon(localPos2, z.points));
        const pos = remotesRef.current[colyseusId];
        const remoteZone2 = pos ? zones2.find((z: Zone) => pointInPolygon(pos, z.points)) : undefined;
        if (zonesDiffer(localZone2, remoteZone2)) continue;
      } catch {}
      const listedByIdentity = !!livekitIdentity && presentIdentities.has(livekitIdentity);
      const listedByName = !livekitIdentity && presentDisplayNames.has(name);
      if (!listedByIdentity && !listedByName) {
        const pos = remotesRef.current[colyseusId];
        const colAvId = remotesRef.current[colyseusId]?.avatarId;
        list.push({
          sid: `col:${colyseusId}`,
          livekitIdentity,
          displayName: name,
          hasVideo: false,
          hasMic: false,
          isSpeaking: false,
          media: 'camera',
          volume: 1,
          dnd: !!pos?.dnd,
          ...(colAvId ? { avatarId: colAvId } : {}),
        });
        if (livekitIdentity) presentIdentities.add(livekitIdentity);
        else presentDisplayNames.add(name);
      }
    }
  } catch {}
}

function notifyGameOfSpeakingStates(room: Room, deps: ParticipantsDeps): void {
  const { colyseusToLivekitMap, remotesRef, gameBridge, dndRef } = deps;
  const speakingIds = new Set<string>();
  const activeSpeakers = room.activeSpeakers || [];
  // DND guard: LiveKit keeps reporting a speaker briefly after DND entry
  // (the soft-mute propagates asynchronously) and indefinitely if the mute
  // fails, so DND-marked participants are filtered out here.
  activeSpeakers.forEach((speaker: Participant) => {
    if (speaker.sid === room.localParticipant?.sid) {
      if (!dndRef?.current) speakingIds.add('local');
    } else {
      const matchingColyseusIds = Object.entries(colyseusToLivekitMap.current)
        .filter(([_, livekitIdentity]) => livekitIdentity === speaker.identity)
        .map(([colyseusId]) => colyseusId);
      if (matchingColyseusIds.length > 0) {
        const activeColyseusId = matchingColyseusIds.find((id) => id in remotesRef.current);
        if (activeColyseusId && !remotesRef.current[activeColyseusId]?.dnd) speakingIds.add(activeColyseusId);
      }
    }
  });
  try {
    gameBridge?.updateSpeakingStates?.(speakingIds);
  } catch {}
}

function buildLivekitParticipantList(room: Room, deps: ParticipantsDeps): UiParticipant[] {
  const { zoneRef, localPosRef } = deps;
  const zones = getZonesNormalized(zoneRef);
  const localPos: Position = { x: localPosRef.current.x ?? 0, y: localPosRef.current.y ?? 0 };
  const localZone = zones.find((z: Zone) => pointInPolygon(localPos, z.points));
  const activeSet = new Set<string>((room.activeSpeakers || []).map((p: Participant) => p.sid));

  const list: UiParticipant[] = [];
  const ctx = { room, zones, localZone, localPos, activeSet, deps };
  pushParticipant(list, room.localParticipant, true, ctx);
  const remotes = Array.from(room.remoteParticipants?.values() || []);
  for (const rp of remotes) pushParticipant(list, rp, false, ctx);
  appendOrphanColyseusRemotes(list, deps);
  return list;
}

export function useParticipants(deps: ParticipantsDeps) {
  const {
    avRef,
    zoneRef,
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    volumeRef,
    me,
    setUiParticipants,
    disposedRef,
    getDisplayName,
    gameBridge,
  } = deps;

  const buildParticipantList = useCallback(() => {
    const room: Room | null | undefined = avRef.current?.room;
    if (!room || !room.localParticipant) {
      setUiParticipants(buildFallbackList(deps));
      return;
    }
    const list = buildLivekitParticipantList(room, deps);
    setUiParticipants(list);
    notifyGameOfSpeakingStates(room, deps);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: the destructured fields are the stable mutable refs and React-stable setters; the surrounding `deps` object is recreated each render but its slot identities are not, capturing it would churn the callback
  }, [
    avRef,
    zoneRef,
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    volumeRef,
    me,
    setUiParticipants,
    disposedRef,
    getDisplayName,
    gameBridge,
  ]);

  const applyVolumesToUi = useCallback(() => {
    // `update()` is called for its side effect: it recomputes the distance
    // volumes and applies them to the LiveKit audio elements. Its return value
    // is deliberately not turned into a map here — the tiles read their
    // `volume` from `resolveVolumeForParticipant`, which pulls
    // `VolumeManager.getLastVolumes()` (keyed by Colyseus id) during the
    // rebuild below. A second, display-name-keyed copy used to be built at
    // this point and thrown away unread; it is gone rather than resurrected,
    // because a display name is not a key (see appendOrphanColyseusRemotes).
    volumeRef.current?.update();
    try {
      buildParticipantList();
    } catch {}
  }, [volumeRef, buildParticipantList]);

  return { buildParticipantList, applyVolumesToUi };
}
