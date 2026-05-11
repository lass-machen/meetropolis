import React from 'react';
import type { Room, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { emitAudioTracksChanged, onAudioTracksChanged } from '../lib/avEvents';
import type { AVManager } from './avManager';
import { listPublications, readPubKind, readPubSource, type TrackLike } from '../types/livekit';

type AttachableTrack = TrackLike & {
  attach?: (element?: HTMLMediaElement) => HTMLMediaElement;
};

function buildAttachAudioTrack(
  audioElements: Map<string, HTMLAudioElement>,
  avRef: React.MutableRefObject<AVManager | null>,
) {
  return (track: AttachableTrack, participantId: string) => {
    try {
      // Prevent duplicate audio elements per participant across tests/renders.
      const existing: HTMLAudioElement | null =
        typeof document !== 'undefined' ? document.querySelector(`audio[data-av-remote="${participantId}"]`) : null;
      const audio = existing || document.createElement('audio');
      audio.autoplay = true;
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      // Honour DND at attach time to avoid brief audio leaks during transitions.
      const dnd = !!avRef.current?.dndEnabled;
      try {
        audio.muted = dnd;
      } catch {}
      audio.volume = dnd ? 0 : 1.0;
      audio.style.display = 'none';
      try {
        audio.dataset.avRemote = participantId;
      } catch {}
      if (!existing) document.body.appendChild(audio);
      try {
        track.attach?.(audio);
      } catch (_err) {
        // Autoplay block fallback
        window.pendingAudioTracks = window.pendingAudioTracks || [];
        window.pendingAudioTracks.push({ track, audio, participantId });
      }
      audioElements.set(participantId, audio);
    } catch {}
  };
}

function buildDetachAudioTrack(audioElements: Map<string, HTMLAudioElement>) {
  return (participantId: string) => {
    const audio = audioElements.get(participantId);
    if (audio) {
      try {
        audio.pause();
      } catch {}
      try {
        (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {}
      try {
        audio.parentNode?.removeChild(audio);
      } catch {}
      audioElements.delete(participantId);
    }
  };
}

function shouldDetachOnUnsubscribe(track: TrackLike, participant: RemoteParticipant | undefined): boolean {
  // Check whether the participant still has another microphone audio track
  // (for example, when only screen-share audio is unsubscribed while the mic
  // is still active).
  const otherAudioTracks = listPublications(participant).filter((pub) => {
    const pubTrack = pub.track;
    if (!pubTrack || pubTrack === track) return false;
    const kind = readPubKind(pub);
    const source = readPubSource(pub);
    // Count only microphone tracks, not screen_share_audio.
    return kind === 'audio' && source !== 'screen_share_audio';
  });
  return otherAudioTracks.length === 0;
}

interface RoomWithLegacyParticipants extends Room {
  participants?: Map<string, RemoteParticipant>;
}

function attachInitialAudioTracks(
  room: RoomWithLegacyParticipants,
  audioElements: Map<string, HTMLAudioElement>,
  attachAudioTrack: (track: AttachableTrack, participantId: string) => void,
): void {
  const participants: RemoteParticipant[] = Array.from(
    room.remoteParticipants?.values?.() || room.participants?.values?.() || [],
  );
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
      audioElements.set('__dummy__', dummy);
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
  const room = avRef.current?.room as RoomWithLegacyParticipants | undefined;
  if (!room) return undefined;

  const audioElements = new Map<string, HTMLAudioElement>();
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
    // a participant's microphone audio.
    if (String(track?.kind) !== 'audio') return;
    if (track && shouldDetachOnUnsubscribe(track, participant)) {
      if (participant?.sid) detachAudioTrack(participant.sid);
    }
    try {
      emitAudioTracksChanged();
    } catch {}
  };

  attachInitialAudioTracks(room, audioElements, attachAudioTrack);
  void registerLivekitListeners(room as unknown as RoomWithEvents, handleTrackSubscribed, handleTrackUnsubscribed);

  // Defensive: react to audio-topology change events (emitted e.g. by
  // SubscriptionManager.restoreAllRemote() after DND exit). When DND is
  // currently OFF, force all managed <audio> elements to muted=false and
  // volume=1, since the flag may have been muted while DND was on.
  const unsubscribeAudioChanged = onAudioTracksChanged(() => {
    try {
      const dndOn = !!avRef.current?.dndEnabled;
      if (dndOn) return;
      audioElements.forEach((audio) => {
        try {
          audio.muted = false;
        } catch {}
        try {
          audio.volume = 1;
        } catch {}
      });
    } catch {}
  });

  return () => {
    try {
      unsubscribeAudioChanged();
    } catch {}
    audioElements.forEach((audio) => {
      try {
        audio.pause();
      } catch {}
      try {
        (audio as HTMLAudioElement & { srcObject?: MediaStream | null }).srcObject = null;
      } catch {}
      try {
        audio.parentNode?.removeChild(audio);
      } catch {}
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
