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
  const refreshingDevicesRef = React.useRef(false);
  // Lokaler Debounce für ParticipantList-Builds (rAF + Delay)
  const blTimerRef = React.useRef<any>(null);
  const blRafRef = React.useRef<number | null>(null);
  const scheduleBuildParticipantList = React.useCallback((delay: number = 100) => {
    if (blTimerRef.current || blRafRef.current !== null) return;
    blTimerRef.current = setTimeout(() => {
      blTimerRef.current = null;
      blRafRef.current = requestAnimationFrame(() => {
        blRafRef.current = null;
        try { buildParticipantList(); } catch {}
      });
    }, Math.max(0, delay));
  }, [buildParticipantList]);
  React.useEffect(() => {
    return () => {
      try { if (blTimerRef.current) clearTimeout(blTimerRef.current); } catch {}
      try { if (blRafRef.current !== null) cancelAnimationFrame(blRafRef.current); } catch {}
    };
  }, []);

  const refreshDevices = React.useCallback(async () => {
    if (!avRef.current || refreshingDevicesRef.current) return;
    refreshingDevicesRef.current = true;
    try {
      const list = await avRef.current.listDevices();
      const micOptions = list.microphones.map(d => ({ id: d.deviceId, label: d.label }));
      const camOptions = list.cameras.map(d => ({ id: d.deviceId, label: d.label }));
      setDevices({ mics: micOptions, cams: camOptions });
      // Defaults nur setzen, wenn noch keine Auswahl existiert
      const defaultMic = micOptions.find(d => d.id === 'default')?.id || micOptions[0]?.id || '';
      const defaultCam = camOptions.find(d => d.id === 'default')?.id || camOptions[0]?.id || '';
      if (defaultMic) {
        setSelectedMicId(prev => prev || defaultMic);
      }
      if (defaultCam) {
        setSelectedCamId(prev => prev || defaultCam);
      }
    } catch {}
    finally {
      refreshingDevicesRef.current = false;
    }
  }, [avRef, setDevices, setSelectedMicId, setSelectedCamId]);

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
        await refreshDevices();

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
                room.on(RoomEvent.ParticipantConnected, () => scheduleBuildParticipantList(100));
                room.on(RoomEvent.ParticipantDisconnected, () => scheduleBuildParticipantList(100));
                room.on(RoomEvent.TrackPublished, (_publication: any, _participant: any) => {
                  try {
                    // Keine Subscription-/Quality-Änderungen hier; AV-Manager kümmert sich darum
                  } catch {}
                  scheduleBuildParticipantList(100);
                });
                room.on(RoomEvent.TrackUnpublished, () => scheduleBuildParticipantList(100));
                room.on(RoomEvent.TrackSubscribed, (track: any, _publication: any) => {
                  if (((_publication as any)?.source || (track as any)?.source) === 'screen_share') {
                    scheduleBuildParticipantList(200);
                  }
                });
                room.on(RoomEvent.ActiveSpeakersChanged, () => { scheduleBuildParticipantList(100); });
              }
            } catch {}
          })();
        }

        scheduleBuildParticipantList(50);
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
      // Versuche sofort Berechtigungen einzuholen, damit Gerätesystem Labels liefert
      try { avRef.current?.ensurePermissions(true, (import.meta as any).env?.VITE_FEATURE_VOICE_ONLY === 'true' ? false : true); } catch {}
      const pendingTracks = (window as any).pendingAudioTracks;
      if (pendingTracks && pendingTracks.length > 0) {
        pendingTracks.forEach(({ track, audio }: any) => {
          try { track.attach(audio); } catch {}
        });
        (window as any).pendingAudioTracks = [];
      }
      // Nach der ersten Interaktion Geräte neu einlesen (Permissions können jetzt erlaubt sein)
      setTimeout(() => { refreshDevices(); }, 100);
    };
    window.addEventListener('pointerdown', firstInteract, { once: true } as any);
    window.addEventListener('keydown', firstInteract, { once: true } as any);
    return () => {
      window.removeEventListener('pointerdown', firstInteract as any);
      window.removeEventListener('keydown', firstInteract as any);
    };
  }, [connectLivekitRef.current, refreshDevices]);

  // Geräte-Änderungen des Browsers beobachten (z. B. USB-Headset eingesteckt)
  React.useEffect(() => {
    const md = (navigator as any).mediaDevices;
    if (!md || typeof md.addEventListener !== 'function') return;
    const handler = () => { refreshDevices(); };
    md.addEventListener('devicechange', handler);
    return () => {
      try { md.removeEventListener('devicechange', handler); } catch {}
    };
  }, [refreshDevices]);
}


