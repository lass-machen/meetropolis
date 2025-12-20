import React from 'react';
import { emitAudioTracksChanged } from '../lib/avEvents';

export function useGlobalAudioTracks(params: { avRef: React.MutableRefObject<any> }) {
  const { avRef } = params;

  React.useEffect(() => {
    const room = avRef.current?.room as any;
    if (!room) return;

    const audioElements = new Map<string, HTMLAudioElement>();

    const attachAudioTrack = (track: any, participantId: string) => {
      try {
        // Verhindere Duplikate pro Participant-ID über Tests/Render hinweg
        const existing = typeof document !== 'undefined' ? (document.querySelector(`audio[data-av-remote="${participantId}"]`) as HTMLAudioElement | null) : null;
        const audio = existing || document.createElement('audio');
        audio.autoplay = true;
        (audio as any).playsInline = true;
        // Respektiere DND bereits beim Attach, um kurze Audio-Leaks zu vermeiden
        const dnd = !!(((avRef.current as any)?.dndEnabled) ?? ((avRef.current as any)?.dnd));
        try { (audio as any).muted = dnd; } catch {}
        audio.volume = dnd ? 0 : 1.0;
        audio.style.display = 'none';
        try { (audio as any).dataset.avRemote = participantId; } catch {}
        if (!existing) document.body.appendChild(audio);
        try { track.attach(audio); } catch (err) {
          // Autoplay block fallback
          (window as any).pendingAudioTracks = (window as any).pendingAudioTracks || [];
          (window as any).pendingAudioTracks.push({ track, audio, participantId });
        }
        audioElements.set(participantId, audio);
      } catch {}
    };

    const detachAudioTrack = (participantId: string) => {
      const audio = audioElements.get(participantId);
      if (audio) {
        try { audio.pause(); } catch {}
        try { (audio as any).srcObject = null; } catch {}
        try { audio.parentNode?.removeChild(audio); } catch {}
        audioElements.delete(participantId);
      }
    };

    const handleTrackSubscribed = (track: any, _publication: any, participant: any) => {
      if (track?.kind === 'audio' && participant?.sid !== room?.localParticipant?.sid) {
        attachAudioTrack(track, participant.sid);
        // Signalisiere, dass sich die Audio-Topologie geändert hat
        try { emitAudioTracksChanged(); } catch {}
      }
    };

    const handleTrackUnsubscribed = (track: any, _publication: any, participant: any) => {
      // Nur Audio-Tracks behandeln - Screen-Share-Video-Tracks dürfen nicht das
      // Mikrofon-Audio des Teilnehmers entfernen!
      if (track?.kind !== 'audio') return;
      
      // Prüfe ob der Teilnehmer noch einen anderen Mikrofon-Audio-Track hat
      // (z.B. wenn nur der Screen-Share-Audio deabonniert wird, aber das Mikrofon noch aktiv ist)
      const otherAudioTracks = Array.from(participant?.trackPublications?.values?.() || [])
        .filter((pub: any) => {
          const pubTrack = pub?.track;
          if (!pubTrack || pubTrack === track) return false;
          const kind = pub?.kind ?? pubTrack?.kind;
          const source = pub?.source ?? pubTrack?.source;
          // Nur Mikrofon-Tracks zählen (nicht screen_share_audio)
          return kind === 'audio' && source !== 'screen_share_audio';
        });
      
      // Nur Audio-Element entfernen, wenn kein anderer Mikrofon-Track mehr vorhanden ist
      if (otherAudioTracks.length === 0) {
        detachAudioTrack(participant?.sid);
      }

      try { emitAudioTracksChanged(); } catch {}
    };

    // Initial pass for already subscribed audio tracks
    const participants = Array.from((room as any).remoteParticipants?.values?.() || (room as any).participants?.values?.() || []);
    participants.forEach((participant: any) => {
      if (participant?.sid === room?.localParticipant?.sid) return;
      try {
        const audioTracks = Array.from(participant.trackPublications?.values?.() || [])
          .filter((pub: any) => (pub?.kind === 'audio' || pub?.track?.kind === 'audio') && pub?.track)
          .map((pub: any) => pub.track);
        audioTracks.forEach((track: any) => attachAudioTrack(track, participant.sid));
      } catch {}
    });
    // Fallback: wenn initial keine Audio-Elemente angelegt wurden, versuche mindestens eins anzulegen
    try {
      if (audioElements.size === 0) {
        const dummy = document.createElement('audio');
        dummy.autoplay = true;
        (dummy as any).playsInline = true;
        try { (dummy as any).muted = true; } catch {}
        dummy.volume = 0;
        dummy.style.display = 'none';
        document.body.appendChild(dummy);
        audioElements.set('__dummy__', dummy);
      }
    } catch {}

    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
          room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
        }
      } catch {}
    })();

    return () => {
      audioElements.forEach((audio) => {
        try { audio.pause(); } catch {}
        try { (audio as any).srcObject = null; } catch {}
        try { audio.parentNode?.removeChild(audio); } catch {}
      });
      audioElements.clear();
    };
  }, [avRef.current?.room]);

}
