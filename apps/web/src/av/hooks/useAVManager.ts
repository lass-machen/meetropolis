/**
 * useAVManager Hook
 *
 * React hook for initializing and managing the AVManager.
 * Replaces the old useLivekit hook with a cleaner interface.
 */

import React from 'react';
import { AVManager } from '../avManager';

interface UseAVManagerArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  editorActiveRef: React.MutableRefObject<boolean>;
  avRef: React.MutableRefObject<AVManager | null>;
  setDevices: React.Dispatch<React.SetStateAction<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>>;
  setSelectedMicId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedCamId: React.Dispatch<React.SetStateAction<string>>;
  buildParticipantList: () => void;
  onConnected?: () => void;
}

export function useAVManager({
  apiBase,
  me,
  editorActiveRef,
  avRef,
  setDevices,
  setSelectedMicId,
  setSelectedCamId,
  buildParticipantList,
  onConnected,
}: UseAVManagerArgs) {
  const isConnectingRef = React.useRef(false);
  const hasAutoConnectedRef = React.useRef(false);
  const refreshingDevicesRef = React.useRef(false);

  // Debounce for participant list rebuilds
  const buildListTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleBuildParticipantList = React.useCallback((delay: number = 100) => {
    if (buildListTimerRef.current) return;
    buildListTimerRef.current = setTimeout(() => {
      buildListTimerRef.current = null;
      try {
        buildParticipantList();
      } catch {}
    }, delay);
  }, [buildParticipantList]);

  // Cleanup build timer on unmount
  React.useEffect(() => {
    return () => {
      if (buildListTimerRef.current) {
        clearTimeout(buildListTimerRef.current);
      }
    };
  }, []);

  // Refresh available devices
  const refreshDevices = React.useCallback(async () => {
    if (!avRef.current || refreshingDevicesRef.current) return;

    refreshingDevicesRef.current = true;
    try {
      const list = await avRef.current.listDevices();
      const micOptions = list.microphones.map((d: { deviceId: string; label: string }) => ({ id: d.deviceId, label: d.label }));
      const camOptions = list.cameras.map((d: { deviceId: string; label: string }) => ({ id: d.deviceId, label: d.label }));

      setDevices({ mics: micOptions, cams: camOptions });

      // Set defaults if not already set
      const defaultMic = micOptions.find((d: { id: string }) => d.id === 'default')?.id || micOptions[0]?.id || '';
      const defaultCam = camOptions.find((d: { id: string }) => d.id === 'default')?.id || camOptions[0]?.id || '';

      setSelectedMicId((prev) => prev || defaultMic);
      setSelectedCamId((prev) => prev || defaultCam);
    } finally {
      refreshingDevicesRef.current = false;
    }
  }, [avRef, setDevices, setSelectedMicId, setSelectedCamId]);

  // Connect to LiveKit
  const connect = React.useCallback(async () => {
    if (!me) return;
    if (editorActiveRef.current) return;
    if (isConnectingRef.current) return;
    if (avRef.current?.room) return;

    isConnectingRef.current = true;

    try {
      const identity = me.id;
      const displayName = me.name || me.email || me.id;
      const useVideo = (import.meta as any).env?.VITE_FEATURE_VOICE_ONLY !== 'true';

      // Create AVManager
      avRef.current = new AVManager({
        baseUrl: apiBase,
        identity,
        displayName,
        useVideo,
      });

      // Connect to default room
      await avRef.current.switchTo('world');

      // Refresh devices after connection
      await refreshDevices();

      // Subscribe to room events for participant list updates
      const room = avRef.current.room;
      if (room) {
        setupRoomEventListeners(room, scheduleBuildParticipantList);
      }

      // Initial participant list build
      scheduleBuildParticipantList(50);

      // Notify parent
      onConnected?.();

    } catch (error) {
      console.error('[AV] Connection failed:', error);
    } finally {
      isConnectingRef.current = false;
    }
  }, [apiBase, me, editorActiveRef, avRef, refreshDevices, scheduleBuildParticipantList, onConnected]);

  // Initialize on mount / user change
  React.useEffect(() => {
    if (!me) return;

    // Auto-connect after short delay
    if (!hasAutoConnectedRef.current) {
      hasAutoConnectedRef.current = true;
      setTimeout(() => {
        if (!editorActiveRef.current && !avRef.current?.room && !isConnectingRef.current) {
          connect();
        }
      }, 300);
    }
  }, [me?.id, connect, editorActiveRef, avRef]);

  // Connect on first user interaction
  React.useEffect(() => {
    const handleFirstInteraction = () => {
      if (!avRef.current?.room) {
        connect();
      }
      // Refresh devices after interaction (permissions may now be granted)
      setTimeout(() => refreshDevices(), 100);
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [connect, refreshDevices, avRef]);

  // Watch for device changes
  React.useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || typeof md.addEventListener !== 'function') return;

    const handler = () => refreshDevices();
    md.addEventListener('devicechange', handler);

    return () => {
      try {
        md.removeEventListener('devicechange', handler);
      } catch {}
    };
  }, [refreshDevices]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      try {
        avRef.current?.dispose();
        avRef.current = null;
      } catch {}
    };
  }, [avRef]);

  return { connect, refreshDevices };
}

// Helper to set up room event listeners
async function setupRoomEventListeners(
  room: any,
  scheduleBuild: (delay?: number) => void
): Promise<void> {
  try {
    const { RoomEvent } = await import('livekit-client');

    room.on(RoomEvent.ParticipantConnected, () => scheduleBuild(100));
    room.on(RoomEvent.ParticipantDisconnected, () => scheduleBuild(100));
    room.on(RoomEvent.TrackPublished, () => scheduleBuild(100));
    room.on(RoomEvent.TrackUnpublished, () => scheduleBuild(100));
    room.on(RoomEvent.TrackSubscribed, () => scheduleBuild(200));
    room.on(RoomEvent.ActiveSpeakersChanged, () => scheduleBuild(100));
  } catch {
    // Fallback without specific events
  }
}
