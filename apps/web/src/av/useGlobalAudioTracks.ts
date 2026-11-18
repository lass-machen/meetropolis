import React from 'react';
import type { Room, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { emitAudioTracksChanged, onAudioTracksChanged } from '../lib/avEvents';
import type { AVManager } from './avManager';
import { listPublications, readPubKind, type TrackLike } from '../types/livekit';

type AttachableTrack = TrackLike & {
  attach?: (element?: HTMLMediaElement) => HTMLMediaElement;
  detach?: (element?: HTMLMediaElement) => HTMLMediaElement | HTMLMediaElement[];
};

interface AudioEntry {
  audio: HTMLAudioElement;
  track?: AttachableTrack;
}

// Autoplay-block fallback entries that point at a removed element must not
// linger: the element they would late-attach to no longer exists.
function dropPendingAudio(audio: HTMLAudioElement): void {
  try {
    const pending = window.pendingAudioTracks;
    if (Array.isArray(pending)) {
      window.pendingAudioTracks = pending.filter((entry) => entry?.audio !== audio);
    }
  } catch {}
}

// One audio element per remote audio track: the SDK evicts same-kind tracks
// already attached to a shared element, so mic and screen-share audio of one
// participant must never share a node. The key keeps the participant id (and
// the data-av-remote attribute below) for existing consumers.
function trackAudioKey(participantId: string, track: AttachableTrack): string {
  const trackId =
    (typeof track?.sid === 'string' && track.sid) ||
    (typeof track?.mediaStreamTrack?.id === 'string' && track.mediaStreamTrack.id) ||
    'default';
  return `${participantId}::${trackId}`;
}

function buildAttachAudioTrack(
  audioElements: Map<string, AudioEntry>,
  avRef: React.MutableRefObject<AVManager | null>,
) {
  return (track: AttachableTrack, participantId: string) => {
    try {
      // Reuse this track's own element when it already exists: re-subscribing
      // the same track must not create a duplicate element.
      const key = trackAudioKey(participantId, track);
      const existing = audioElements.get(key);
      if (existing) {
        try {
          track.attach?.(existing.audio);
        } catch {}
        return;
      }
      const audio = document.createElement('audio');
      audio.autoplay = true;
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      // Honour DND at attach time to avoid brief audio leaks during transitions.
      const dnd = !!avRef.current?.dndEnabled;
      try {
        audio.muted = dnd;
      } catch {}
      // Playback volume is owned exclusively by the volume authority
      // (VolumeManager -> RemoteAudioTrack.setVolume). Elements start silent
      // so a freshly attached track cannot leak across zone boundaries before
      // the first authoritative volume pass raises it.
      audio.volume = 0;
      audio.style.display = 'none';
      try {
        audio.dataset.avRemote = participantId;
        // Publishing participant's sid for tooling that maps a rendered track
        // back to its sender; no visible effect.
        audio.dataset.participantSid = participantId;
      } catch {}
      document.body.appendChild(audio);
      try {
        track.attach?.(audio);
      } catch (_err) {
        // Autoplay block fallback
        window.pendingAudioTracks = window.pendingAudioTracks || [];
        window.pendingAudioTracks.push({ track, audio, participantId });
      }
      audioElements.set(key, { audio, track });
    } catch {}
  };
}

function buildDetachAudioTrack(audioElements: Map<string, AudioEntry>) {
  return (track: AttachableTrack, participantId: string) => {
    const key = trackAudioKey(participantId, track);
    const entry = audioElements.get(key);
    if (entry) {
      try {
        entry.track?.detach?.(entry.audio);
      } catch {}
      try {
        entry.audio.pause();
      } catch {}
      try {
        (entry.audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {}
      try {
        entry.audio.parentNode?.removeChild(entry.audio);
      } catch {}
      dropPendingAudio(entry.audio);
      audioElements.delete(key);
    }
  };
}

function attachInitialAudioTracks(
  room: Room,
  audioElements: Map<string, AudioEntry>,
  attachAudioTrack: (track: AttachableTrack, participantId: string) => void,
): void {
  // `remoteParticipants` is the only participant map livekit-client 2.x has;
  // the 1.x `room.participants` fallback that used to sit here was dead code
  // (an empty map still yields a truthy iterator) and kept an API alive that
  // does not exist any more.
  const participants: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
  participants.forEach((participant) => {
    if (participant?.sid === room?.localParticipant?.sid) return;
    try {
      const pubs = listPublications(participant);
      const audioTracks = pubs
        .filter((pub) => readPubKind(pub) === 'audio' && !!pub.track)
        .map((pub) => pub.track as AttachableTrack);
      audioTracks.forEach((track) => attachAudioTrack(track, participant.sid));
    } catch {}
  });
  // Fallback: if no audio elements were created initially, create at least one stub.
  try {
    if (audioElements.size === 0) {
      const dummy = document.createElement('audio');
      dummy.autoplay = true;
      (dummy as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      try {
        dummy.muted = true;
      } catch {}
      dummy.volume = 0;
      dummy.style.display = 'none';
      document.body.appendChild(dummy);
      audioElements.set('__dummy__', { audio: dummy });
    }
  } catch {}
}

interface RoomWithEvents {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

async function registerLivekitListeners(
  room: RoomWithEvents,
  handleTrackSubscribed: (...args: unknown[]) => void,
  handleTrackUnsubscribed: (...args: unknown[]) => void,
): Promise<void> {
  try {
    const mod = await import('livekit-client');
    const RoomEvent = mod.RoomEvent;
    if (RoomEvent) {
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    }
  } catch {}
}

function setupGlobalAudioTracksEffect(avRef: React.MutableRefObject<AVManager | null>): (() => void) | undefined {
  const room = avRef.current?.room;
  if (!room) return undefined;

  const audioElements = new Map<string, AudioEntry>();
  const attachAudioTrack = buildAttachAudioTrack(audioElements, avRef);
  const detachAudioTrack = buildDetachAudioTrack(audioElements);

  const handleTrackSubscribed = (...args: unknown[]) => {
    const track = args[0] as (RemoteTrack & TrackLike) | undefined;
    const participant = args[2] as RemoteParticipant | undefined;
    if (String(track?.kind) === 'audio' && participant && participant.sid !== room?.localParticipant?.sid) {
      if (track) attachAudioTrack(track, participant.sid);
      // Signal that the audio topology has changed.
      try {
        emitAudioTracksChanged();
      } catch {}
    }
  };

  const handleTrackUnsubscribed = (...args: unknown[]) => {
    const track = args[0] as (RemoteTrack & TrackLike) | undefined;
    const participant = args[2] as RemoteParticipant | undefined;
    // Only handle audio tracks: screen-share video tracks must not remove
    // a participant's microphone audio. Detaching is per track, so removing
    // one track never affects the participant's other audio tracks.
    if (String(track?.kind) !== 'audio') return;
    if (track && participant?.sid) detachAudioTrack(track, participant.sid);
    try {
      emitAudioTracksChanged();
    } catch {}
  };

  attachInitialAudioTracks(room, audioElements, attachAudioTrack);
  void registerLivekitListeners(room as unknown as RoomWithEvents, handleTrackSubscribed, handleTrackUnsubscribed);

  // Defensive: react to audio-topology change events (emitted e.g. by
  // SubscriptionManager.restoreAllRemote() after DND exit). When DND is
  // currently OFF, clear the muted flag that may still be set from attach
  // time under DND. The volume property must never be written here: it is
  // owned exclusively by the volume authority (VolumeManager) and a blanket
  // reset would break zone/bubble isolation.
  const unsubscribeAudioChanged = onAudioTracksChanged(() => {
    try {
      const dndOn = !!avRef.current?.dndEnabled;
      if (dndOn) return;
      audioElements.forEach((entry) => {
        try {
          entry.audio.muted = false;
        } catch {}
      });
    } catch {}
  });

  return () => {
    try {
      unsubscribeAudioChanged();
    } catch {}
    audioElements.forEach((entry) => {
      try {
        entry.track?.detach?.(entry.audio);
      } catch {}
      try {
        entry.audio.pause();
      } catch {}
      try {
        (entry.audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {}
      try {
        entry.audio.parentNode?.removeChild(entry.audio);
      } catch {}
      dropPendingAudio(entry.audio);
    });
    audioElements.clear();
  };
}

// Re-exported for parameter shape, even though it is used internally.
export type { RemoteTrackPublication };

export function useGlobalAudioTracks(params: { avRef: React.MutableRefObject<AVManager | null> }) {
  const { avRef } = params;

  React.useEffect(() => {
    return setupGlobalAudioTracksEffect(avRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avRef is a mutable ref (identity stable); the effect re-runs when the room handle inside the ref changes, which is the correct lifecycle trigger
  }, [avRef.current?.room]);
}
