import React from 'react';
import { logger } from '../../../lib/logger';
import type { AVManager } from '../../../av/avManager';
import type { Room } from 'livekit-client';

type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean; micPending?: boolean };

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
    let poll: ReturnType<typeof setInterval> | null = null;
    let watcher: ReturnType<typeof setInterval> | null = null;

    // Load the local-state readers once; the always-on poll below reuses this
    // instead of re-invoking the (cached but still churny) dynamic import per tick.
    type LocalStateMod = typeof import('../../../av/core/localState');
    let localStateMod: LocalStateMod | null = null;
    const getLocalState = async (): Promise<LocalStateMod> =>
      localStateMod ?? (localStateMod = await import('../../../av/core/localState'));

    const applyNow = async () => {
      try {
        const mod = await getLocalState();
        const av = avRef.current;
        const room = av?.room ?? null;
        if (!room) return;
        const actualMic = mod.isLocalMicOn(room);
        const actualCam = mod.isLocalCamOn(room);
        let share = false;
        try {
          share = mod.isLocalShareOn(room);
        } catch (e) {
          logger.debug('[WorldApp] Operation failed', e);
        }

        // Intent-vs-actual reconciliation. While a real (re)publish is in flight
        // — the getUserMedia + SDP window, most visibly the mic republish after
        // the hybrid mute released the capture — the actual publication reads
        // "off" even though the user is turning it on. Showing that plainly reads
        // as an unresponsive click (mic) or flickers the button off mid-publish
        // (camera). Hold the button at the intent during that precise window;
        // the manager clears the publishing flag on success, failure and timeout
        // alike, so nothing can wedge. The mic surfaces it as a "connecting" hint
        // (enable direction only) so the user knows they cannot speak yet.
        const mic = av?.isMicrophonePublishing ? (av?.isMicrophoneDesired ?? actualMic) : actualMic;
        const cam = av?.isCameraPublishing ? (av?.isCameraDesired ?? actualCam) : actualCam;
        const micPending = !!av?.isMicrophonePublishing && !!av?.isMicrophoneDesired;

        // Diff inside the functional update against the REAL current state (which
        // other writers also touch), returning the same reference when nothing
        // changed so React skips the re-render. This is what keeps the always-on
        // poll from rendering every tick.
        setAvState((s) => {
          if (s.mic === mic && s.cam === cam && s.share === share && !!s.micPending === micPending) return s;
          return { ...s, mic, cam, share, micPending };
        });
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

    // Install room event handlers exactly once, as soon as a room exists. Events
    // give instant reaction to publish/mute/unmute; the poll below is the
    // reliability net for states that emit no event (the republish pending gap).
    watcher = setInterval(() => {
      const room = avRef.current?.room;
      if (!room) return;
      if (watcher) clearInterval(watcher);
      watcher = null;
      void installHandlersForRoom(room);
    }, 500);

    // Always-on low-frequency reconcile. Cheap thanks to the diff guard (no
    // setState unless a value changed) and the module cache on the dynamic
    // import. This is what surfaces and clears the mic "pending" hold during a
    // republish, when LiveKit emits no interim RoomEvent to drive applyNow.
    poll = setInterval(() => {
      void applyNow();
    }, 400);

    void applyNow();
    return () => {
      try {
        removeHandlers?.();
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
      try {
        if (poll) clearInterval(poll);
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
