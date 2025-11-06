import React from 'react';

export function useGlobalAudioTracks(params: { avRef: React.MutableRefObject<any> }) {
  const { avRef } = params;

  React.useEffect(() => {
    const room = avRef.current?.room as any;
    if (!room) return;

    const audioElements = new Map<string, HTMLAudioElement>();

    const attachAudioTrack = (track: any, participantId: string) => {
      try {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        (audio as any).playsInline = true;
        // Respektiere DND bereits beim Attach, um kurze Audio-Leaks zu vermeiden
        const dnd = !!((avRef.current as any)?.dnd);
        try { (audio as any).muted = dnd; } catch {}
        audio.volume = dnd ? 0 : 1.0;
        audio.style.display = 'none';
        document.body.appendChild(audio);
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
      }
    };

    const handleTrackUnsubscribed = (_track: any, _publication: any, participant: any) => {
      detachAudioTrack(participant?.sid);
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


