import React from 'react';
import { logger } from '../../../lib/logger';
import type { AVManager } from '../../../av/avManager';
import type { Room } from 'livekit-client';

type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean };

// livekit-client is dynamically imported; we only need the RoomEvent enum
// for typed access. RoomEvent is a string-valued enum at runtime.
type LiveKitModule = { RoomEvent?: Record<string, string> };

/**
 * Mirrors the LiveKit room's local mic/cam/share state into React state.
 * Listens for RoomEvent changes and polls until a room becomes available.
 */
export function useAvStateSync(
  avRef: React.RefObject<AVManager | null>,
  setAvState: React.Dispatch<React.SetStateAction<AvState>>,
) {
  React.useEffect(() => {
    let removeHandlers: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watcher: ReturnType<typeof setInterval> | null = null;

    const applyNow = async () => {
      try {
        const mod = await import('../../../av/core/localState');
        const room = avRef.current?.room ?? null;
        if (!room) return;
        const mic = mod.isLocalMicOn(room);
        const cam = mod.isLocalCamOn(room);
        let share = false;
        try {
          share = mod.isLocalShareOn(room);
        } catch (e) {
          logger.debug('[WorldApp] Operation failed', e);
        }
        setAvState((s) => ({ ...s, mic, cam, ...(typeof share === 'boolean' ? { share } : {}) }));
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    };

    const installHandlersForRoom = async (room: Room) => {
      // LiveKit's Room.on / off are strongly typed against `keyof RoomEventCallbacks`,
      // but we resolve event names dynamically from the runtime RoomEvent enum.
      // A loosened local view avoids fighting the generated overloads.
      type EventBus = {
        on?: (event: string, listener: () => void) => unknown;
        off?: (event: string, listener: () => void) => unknown;
      };
      const bus = room as unknown as EventBus;
      try {
        const lk = (await import('livekit-client')) as unknown as LiveKitModule;
        const RoomEvent = lk.RoomEvent;
        const onAny = () => {
          void applyNow();
        };
        if (RoomEvent) {
          bus.on?.(RoomEvent.LocalTrackPublished, onAny);
          bus.on?.(RoomEvent.LocalTrackUnpublished, onAny);
          bus.on?.(RoomEvent.TrackMuted, onAny);
          bus.on?.(RoomEvent.TrackUnmuted, onAny);
          bus.on?.(RoomEvent.ConnectionStateChanged, onAny);
          removeHandlers = () => {
            try {
              bus.off?.(RoomEvent.LocalTrackPublished, onAny);
              bus.off?.(RoomEvent.LocalTrackUnpublished, onAny);
              bus.off?.(RoomEvent.TrackMuted, onAny);
              bus.off?.(RoomEvent.TrackUnmuted, onAny);
              bus.off?.(RoomEvent.ConnectionStateChanged, onAny);
            } catch (e) {
              logger.debug('[WorldApp] Operation failed', e);
            }
          };
        } else {
          bus.on?.('localTrackPublished', onAny);
          bus.on?.('localTrackUnpublished', onAny);
          bus.on?.('trackMuted', onAny);
          bus.on?.('trackUnmuted', onAny);
          bus.on?.('connectionStateChanged', onAny);
          removeHandlers = () => {
            try {
              bus.off?.('localTrackPublished', onAny);
              bus.off?.('localTrackUnpublished', onAny);
              bus.off?.('trackMuted', onAny);
              bus.off?.('trackUnmuted', onAny);
              bus.off?.('connectionStateChanged', onAny);
            } catch (e) {
              logger.debug('[WorldApp] Operation failed', e);
            }
          };
        }
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      void applyNow();
    };

    watcher = setInterval(() => {
      const room = avRef.current?.room;
      if (!room) {
        if (!pollTimer)
          pollTimer = setInterval(() => {
            void applyNow();
          }, 750);
        return;
      }
      try {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      if (watcher) clearInterval(watcher);
      watcher = null;
      void installHandlersForRoom(room);
    }, 500);

    void applyNow();
    return () => {
      try {
        removeHandlers?.();
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      try {
        if (pollTimer) clearInterval(pollTimer);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      try {
        if (watcher) clearInterval(watcher);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    };
  }, [avRef, setAvState]);
}
