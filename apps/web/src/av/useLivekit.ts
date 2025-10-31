import React from 'react';
import { AVManager } from './avManager';

type AnyRef<T> = React.MutableRefObject<T>;

interface UseLivekitArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  editorActiveRef: AnyRef<boolean>;
  avRef: AnyRef<AVManager | null>;
  bubbleRef: AnyRef<any>;
  zoneRef: AnyRef<any>;
  setDevices: React.Dispatch<React.SetStateAction<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>>;
  setSelectedMicId: React.Dispatch<React.SetStateAction<string | ''>>;
  setSelectedCamId: React.Dispatch<React.SetStateAction<string | ''>>;
  buildParticipantList: () => void;
  connectLivekitRef: AnyRef<null | (() => Promise<void>)>;
  livekitAutoConnectOnceRef: AnyRef<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
}

export function useLivekit({
  apiBase,
  me,
  editorActiveRef,
  avRef,
  bubbleRef,
  zoneRef,
  setDevices,
  setSelectedMicId,
  setSelectedCamId,
  buildParticipantList,
  connectLivekitRef,
  livekitAutoConnectOnceRef,
  setAvState,
}: UseLivekitArgs) {
  const isConnectingRef = React.useRef(false);

  React.useEffect(() => {
    if (!me) return;
    const identity = me.id;
    const displayName = me.name || me.email || me.id;

    const connectLivekit = async () => {
      if (editorActiveRef.current) return;
      if (isConnectingRef.current) return;
      if (avRef.current?.room) return;

      isConnectingRef.current = true;
      try {
        avRef.current = new AVManager({
          baseUrl: apiBase,
          identity,
          displayName,
          useVideo: (import.meta as any).env?.VITE_FEATURE_VOICE_ONLY !== 'true',
        });
        try { bubbleRef.current?.setAV(avRef.current); } catch {}
        try { zoneRef.current?.setAV(avRef.current); } catch {}

        await avRef.current.switchTo('world');
        const list = await avRef.current.listDevices();
        const micOptions = list.microphones.map(d => ({ id: d.deviceId, label: d.label }));
        const camOptions = list.cameras.map(d => ({ id: d.deviceId, label: d.label }));
        setDevices({ mics: micOptions, cams: camOptions });
        const defaultMic = micOptions.find(d => d.id === 'default')?.id || micOptions[0]?.id || '';
        const defaultCam = camOptions.find(d => d.id === 'default')?.id || camOptions[0]?.id || '';
        if (defaultMic) {
          setSelectedMicId(defaultMic);
          try { await avRef.current.useMicrophoneDevice(defaultMic); } catch {}
        }
        if (defaultCam) {
          setSelectedCamId(defaultCam);
          try { await avRef.current.useCameraDevice(defaultCam); } catch {}
        }

        const room: any = avRef.current.room as any;
        if (room) {
          await new Promise<void>((resolve) => {
            const check = () => {
              if (room.state === 'connected' || room.connectionState === 'connected') resolve();
              else setTimeout(check, 100);
            };
            check();
          });

          (async () => {
            try {
              const mod = await import('livekit-client');
              const RoomEvent = (mod as any).RoomEvent;
              if (RoomEvent) {
                room.on(RoomEvent.ParticipantConnected, () => setTimeout(buildParticipantList, 100));
                room.on(RoomEvent.ParticipantDisconnected, () => setTimeout(buildParticipantList, 100));
                room.on(RoomEvent.TrackPublished, (_publication: any, _participant: any) => {
                  try {
                    const source = (_publication?.source || _publication?.track?.source);
                    const isRemote = _participant?.sid !== room.localParticipant?.sid;
                    if (isRemote && (source === 'screen_share' || source === 'camera')) {
                      try { _publication?.setSubscribed?.(true); } catch {}
                      try {
                        const qHigh: any = 2; // VideoQuality.High fallback
                        if (typeof (_publication as any)?.setVideoQuality === 'function') {
                          (_publication as any).setVideoQuality(qHigh);
                        } else if (typeof (_publication as any)?.setPreferredVideoQuality === 'function') {
                          (_publication as any).setPreferredVideoQuality(qHigh);
                        }
                      } catch {}
                    }
                  } catch {}
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackUnpublished, () => setTimeout(buildParticipantList, 100));
                room.on(RoomEvent.TrackSubscribed, (track: any, _publication: any) => {
                  if (((_publication as any)?.source || (track as any)?.source) === 'screen_share') {
                    setTimeout(buildParticipantList, 200);
                  }
                });
                room.on(RoomEvent.ActiveSpeakersChanged, () => { buildParticipantList(); });
              }
            } catch {}
          })();
        }

        setTimeout(buildParticipantList, 50);
      } catch (e) {
        try { bubbleRef.current?.setAV(null as any); } catch {}
        try { zoneRef.current?.setAV(null as any); } catch {}
      } finally {
        isConnectingRef.current = false;
      }
    };

    connectLivekitRef.current = connectLivekit;

    if (!livekitAutoConnectOnceRef.current) {
      livekitAutoConnectOnceRef.current = true;
      setTimeout(() => {
        try {
          if (!editorActiveRef.current && connectLivekitRef.current && !avRef.current?.room && !isConnectingRef.current) {
            connectLivekitRef.current();
          }
        } catch {}
      }, 300);
    }

  }, [apiBase, me?.id]);

  React.useEffect(() => {
    if (!connectLivekitRef.current) return;
    // connect on first interaction + attach pending audio tracks
    const firstInteract = () => {
      if (!avRef.current?.room && connectLivekitRef.current) {
        try { connectLivekitRef.current?.(); } catch {}
      }
      const pendingTracks = (window as any).pendingAudioTracks;
      if (pendingTracks && pendingTracks.length > 0) {
        pendingTracks.forEach(({ track, audio }: any) => {
          try { track.attach(audio); } catch {}
        });
        (window as any).pendingAudioTracks = [];
      }
    };
    window.addEventListener('pointerdown', firstInteract, { once: true } as any);
    window.addEventListener('keydown', firstInteract, { once: true } as any);
    return () => {
      window.removeEventListener('pointerdown', firstInteract as any);
      window.removeEventListener('keydown', firstInteract as any);
    };
  }, [connectLivekitRef.current]);
}


