import type { Room, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import { listPublications, readPubKind, readPubSource } from '../../types/livekit';

export type DesiredSubscription = { identity: string; audio?: boolean; video?: boolean };

export type ApplySubscriptionsContext = {
  room: Room | null;
  isSignalOpen: () => boolean;
  dnd: boolean;
  desiredIds: string[];
  activeSpeakerIds: string[];
  maxVideoSubs: number;
  setDesired: (pub: RemoteTrackPublication, identity: string, kind: 'audio' | 'video', should: boolean) => void;
  lastDesiredIdsKeyRef: { current: string | null };
};

interface RoomConnectionStateView {
  connectionState?: string;
  state?: string;
}

export function applySubscriptions(ctx: ApplySubscriptionsContext): void {
  const { room, isSignalOpen, dnd, desiredIds, activeSpeakerIds, maxVideoSubs, setDesired, lastDesiredIdsKeyRef } = ctx;
  if (!room || dnd) return;
  const r = room as Room & RoomConnectionStateView;
  const st = r.connectionState ?? r.state;
  if (st !== 'connected' || !isSignalOpen()) return;
  const participants: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
  const participantCount = participants.length;
  let videoPublicationCount = 0;
  for (const p of participants) {
    const pubs = listPublications(p);
    for (const pub of pubs) {
      const kind = readPubKind(pub);
      if (kind === 'video') videoPublicationCount++;
    }
  }
  const key =
    JSON.stringify(desiredIds) +
    '|' +
    JSON.stringify(activeSpeakerIds.slice(0, maxVideoSubs)) +
    '|' +
    participantCount +
    '|' +
    videoPublicationCount;
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
      const pubs = listPublications(p) as unknown as RemoteTrackPublication[];
      for (const pub of pubs) {
        const kind = readPubKind(pub);
        const src = readPubSource(pub);
        if (kind === 'audio') setDesired(pub, identity, 'audio', true);
        if (kind === 'video') {
          const near =
            src === 'screen_share' ||
            few ||
            prioritizedVideoSet.has(identity) ||
            activeVideoSet.has(identity) ||
            shouldSub;
          AVLogger.debug('subscriptions.set_desired.video', {
            identity,
            src: src ? String(src) : undefined,
            near,
            few,
            activeCount: activeVideoSet.size,
            desiredCount: prioritizedVideoSet.size,
          });
          setDesired(pub, identity, 'video', !!near);
        }
      }
    }
    // Telemetrie-Hook (optional): Anzahl Teilnehmer und Keys zusammenfassen
    try {
      const env = (import.meta as unknown as { env?: { VITE_AV_DEBUG?: string } }).env;
      const debugOn = env?.VITE_AV_DEBUG === 'true' || window.__avDebugOn;
      if (debugOn) window.__avLastApply = { n: participants.length, key };
    } catch {}
  } catch {}
}

export function ensureSubscribeAllAudio(
  room: Room | null,
  isSignalOpen: () => boolean,
  setDesired: (pub: RemoteTrackPublication, identity: string, kind: 'audio' | 'video', should: boolean) => void,
  maxCount: number = 32,
): void {
  if (!room) return;
  const r = room as Room & RoomConnectionStateView;
  const st = r.connectionState ?? r.state;
  if (st !== 'connected' || !isSignalOpen()) return;
  try {
    const parts: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
    let count = 0;
    for (const p of parts) {
      const identity = String(p.identity || '');
      const pubs = listPublications(p) as unknown as RemoteTrackPublication[];
      for (const pub of pubs) {
        const kind = readPubKind(pub);
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
