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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        const next = !dndRef.current;
        try { gameBridge.setDoNotDisturb(next); } catch {}
        try { gameBridge.setMovementLocked(next); } catch {}
        if (next) {
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


