import * as React from 'react';
import { gameBridge } from '../../game/bridge';
import type { AVManager } from '../avManager';

export function useDoNotDisturbBridge(avRef: React.MutableRefObject<AVManager | null>) {
  const dndRef = React.useRef<boolean>(false);
  const prevAvBeforeDndRef = React.useRef<{ mic: boolean; cam: boolean } | null>(null);

  React.useEffect(() => {
    const gb: any = gameBridge as any;
    const originalSetDnd = gb.setDoNotDisturb;
    if (typeof originalSetDnd !== 'function') return;
    gb.setDoNotDisturb = (enabled: boolean) => {
      try { originalSetDnd?.(!!enabled); } catch {}
      dndRef.current = !!enabled;
      if (enabled) {
        try {
          const room: any = avRef.current?.room as any;
          let hasMic = false, hasCam = false;
          const pubs = Array.from(room?.localParticipant?.trackPublications?.values?.() || []);
          for (const pub of pubs) {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            if ((kind === 'audio' || src === 'microphone' || src === 0) && (pub as any)?.track) hasMic = true;
            if (((kind === 'video' && src !== 'screen_share') || src === 'camera' || src === 1) && (pub as any)?.track) hasCam = true;
          }
          prevAvBeforeDndRef.current = { mic: hasMic, cam: hasCam };
        } catch {
          prevAvBeforeDndRef.current = prevAvBeforeDndRef.current || { mic: false, cam: false };
        }
      } else {
        try { (avRef.current?.room as any)?.startAudio?.(); } catch {}
        const prev = prevAvBeforeDndRef.current;
        prevAvBeforeDndRef.current = null;
        if (prev) {
          try { if (prev.mic) void avRef.current?.setMicrophoneEnabled(true); } catch {}
          try { if (prev.cam) void avRef.current?.setCameraEnabled(true); } catch {}
        }
      }
    };
    return () => { try { gb.setDoNotDisturb = originalSetDnd; } catch {} };
  }, []);
}


