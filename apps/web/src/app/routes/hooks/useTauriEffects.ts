import { useEffect } from 'react';
import { logger } from '../../../lib/logger';
import { gameBridge } from '../../../game/bridge';

interface UseTauriEffectsParams {
  isTauri: boolean;
  isMiniMode: boolean;
  toggleMiniMode: () => void;
  syncAvStatus: (status: any) => void;
  onMiniAvAction: (handler: (action: string) => Promise<void>) => () => void;
  avState: { mic: boolean; cam: boolean; dnd: boolean; share: boolean };
  uiParticipants: any[];
  getDisplayName: (identity: string) => string;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  avRef: React.RefObject<any>;
  onOpenPreferences: () => void;
}

export function useTauriEffects(params: UseTauriEffectsParams) {
  const {
    isTauri, isMiniMode, toggleMiniMode, syncAvStatus, onMiniAvAction,
    avState, uiParticipants, getDisplayName, setAvState, avRef,
    onOpenPreferences,
  } = params;

  useEffect(() => {
    if (!isTauri) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMiniMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isTauri, toggleMiniMode]);

  useEffect(() => {
    if (!isTauri || !isMiniMode) return;
    const syncStatus = () => {
      const speakingNames = uiParticipants
        .filter(p => p.isSpeaking)
        .map(p => getDisplayName(p.identity).split(' ')[0])
        .slice(0, 3);
      syncAvStatus({
        mic: avState.mic, cam: avState.cam, dnd: avState.dnd, share: avState.share,
        online_count: uiParticipants.filter(p => p.hasMic || p.hasVideo).length,
        speaking_names: speakingNames,
      });
    };
    syncStatus();
    const interval = setInterval(syncStatus, 500);
    return () => clearInterval(interval);
  }, [isTauri, isMiniMode, avState, uiParticipants, syncAvStatus, getDisplayName]);

  useEffect(() => {
    if (!isTauri) return;
    const unsubscribe = onMiniAvAction(async (action: string) => {
      try {
        switch (action) {
          case 'toggle_mic':
            await avRef.current?.setMicrophoneEnabled(!avState.mic);
            setAvState(s => ({ ...s, mic: !s.mic }));
            break;
          case 'toggle_cam':
            await avRef.current?.setCameraEnabled(!avState.cam);
            setAvState(s => ({ ...s, cam: !s.cam }));
            break;
          case 'toggle_dnd':
            const nextDnd = !avState.dnd;
            await avRef.current?.setDoNotDisturb(nextDnd);
            setAvState(s => ({ ...s, dnd: nextDnd, mic: nextDnd ? false : s.mic, cam: nextDnd ? false : s.cam }));
            (gameBridge as any).setDoNotDisturb?.(nextDnd);
            (gameBridge as any).setMovementLocked?.(nextDnd);
            break;
        }
      } catch (e) { logger.error('[Tauri] AV action failed:', e); }
    });
    return unsubscribe;
  }, [isTauri, avState, onMiniAvAction]);

  // Listen for native menu "open-preferences" event
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('open-preferences', () => {
          onOpenPreferences();
        });
      } catch (e) {
        logger.warn('[Tauri] Failed to setup open-preferences listener:', e);
      }
    };
    setup();
    return () => { unlisten?.(); };
  }, [isTauri, onOpenPreferences]);
}
