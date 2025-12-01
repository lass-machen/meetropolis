import * as React from 'react';

type GameBridgeApi = {
  setDoNotDisturb: (next: boolean) => void;
  setMovementLocked: (next: boolean) => void;
};

type Params = {
  enabled: boolean;
  dndRef: React.MutableRefObject<boolean>;
  avRef: React.MutableRefObject<any>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  colyseusRef: React.MutableRefObject<any>;
  volumeRef: React.MutableRefObject<any>;
  gameBridge: GameBridgeApi;
};

export function useDndShortcut({ enabled, dndRef, avRef, setAvState, colyseusRef, volumeRef, gameBridge }: Params) {
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        // Lese echten DND-Status aus AVManager
        const realDnd = !!(avRef.current as any)?.dnd;
        const next = !realDnd;
        console.debug('[DND Shortcut] Toggle:', { realDnd, next, refDnd: dndRef.current });
        try { await avRef.current?.setDoNotDisturb(next); } catch {}
        try { gameBridge.setDoNotDisturb(next); } catch {}
        try { gameBridge.setMovementLocked(next); } catch {}
        if (next) {
          // DND aktivieren
          try { avRef.current?.setMicrophoneEnabled(false); } catch {}
          try { avRef.current?.setCameraEnabled(false); } catch {}
          try { avRef.current?.stopScreenshare(); } catch {}
          try {
            const room: any = avRef.current?.room as any;
            if (room?.remoteParticipants) {
              const participants: any[] = Array.from((room.remoteParticipants as any).values());
              for (const p of participants) {
                const sid = (p as any)?.sid;
                if (sid) {
                  try { avRef.current?.setParticipantVolume(sid, 0); } catch {}
                }
              }
            }
          } catch {}
        } else {
          // DND deaktivieren: Remote-Lautstärken wiederherstellen
          try {
            const room: any = avRef.current?.room as any;
            if (room?.remoteParticipants) {
              const participants: any[] = Array.from((room.remoteParticipants as any).values());
              for (const p of participants) {
                const sid = (p as any)?.sid;
                if (sid) {
                  try { avRef.current?.setParticipantVolume(sid, 1); } catch {}
                }
              }
            }
          } catch {}
          try { volumeRef.current?.update(); } catch {}
        }
        dndRef.current = next;
        setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
        try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
        try { volumeRef.current?.update(); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [enabled]);
}


