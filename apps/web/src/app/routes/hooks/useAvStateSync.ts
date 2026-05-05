import React from 'react';
import { logger } from '../../../lib/logger';

type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean };

/**
 * Mirrors the LiveKit room's local mic/cam/share state into React state.
 * Listens for RoomEvent changes and polls until a room becomes available.
 */
export function useAvStateSync(avRef: React.RefObject<any>, setAvState: React.Dispatch<React.SetStateAction<AvState>>) {
  React.useEffect(() => {
    let removeHandlers: (() => void) | null = null;
    let pollTimer: any = null;
    let watcher: any = null;

    const applyNow = async () => {
      try {
        const mod: any = await import('../../../av/core/localState');
        const roomAny: any = avRef.current?.room as any;
        if (!roomAny) return;
        const mic = mod.isLocalMicOn(roomAny);
        const cam = mod.isLocalCamOn(roomAny);
        let share = false;
        try { share = mod.isLocalShareOn(roomAny); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
        setAvState(s => ({ ...s, mic, cam, ...(typeof share === 'boolean' ? { share } : {}) }));
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    };

    const installHandlersForRoom = async (room: any) => {
      try {
        const lk: any = await import('livekit-client');
        const RoomEvent = (lk as any).RoomEvent;
        const onAny = () => { void applyNow(); };
        if (RoomEvent) {
          room.on?.(RoomEvent.LocalTrackPublished, onAny);
          room.on?.(RoomEvent.LocalTrackUnpublished, onAny);
          room.on?.(RoomEvent.TrackMuted, onAny);
          room.on?.(RoomEvent.TrackUnmuted, onAny);
          room.on?.(RoomEvent.ConnectionStateChanged, onAny);
          removeHandlers = () => {
            try {
              room.off?.(RoomEvent.LocalTrackPublished, onAny);
              room.off?.(RoomEvent.LocalTrackUnpublished, onAny);
              room.off?.(RoomEvent.TrackMuted, onAny);
              room.off?.(RoomEvent.TrackUnmuted, onAny);
              room.off?.(RoomEvent.ConnectionStateChanged, onAny);
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          };
        } else {
          room.on?.('localTrackPublished', onAny);
          room.on?.('localTrackUnpublished', onAny);
          room.on?.('trackMuted', onAny);
          room.on?.('trackUnmuted', onAny);
          room.on?.('connectionStateChanged', onAny);
          removeHandlers = () => {
            try {
              room.off?.('localTrackPublished', onAny);
              room.off?.('localTrackUnpublished', onAny);
              room.off?.('trackMuted', onAny);
              room.off?.('trackUnmuted', onAny);
              room.off?.('connectionStateChanged', onAny);
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          };
        }
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      void applyNow();
    };

    watcher = setInterval(() => {
      const room: any = avRef.current?.room as any;
      if (!room) {
        if (!pollTimer) pollTimer = setInterval(applyNow, 750);
        return;
      }
      try { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      clearInterval(watcher);
      watcher = null;
      void installHandlersForRoom(room);
    }, 500);

    void applyNow();
    return () => {
      try { removeHandlers?.(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { clearInterval(pollTimer); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      try { if (watcher) clearInterval(watcher); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    };
  }, [avRef, setAvState]);
}
