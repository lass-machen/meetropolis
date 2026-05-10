/**
 * useAVManager Hook
 *
 * React hook for initializing and managing the AVManager.
 * Replaces the old useLivekit hook with a cleaner interface.
 */

import React from 'react';
import { AVManager } from '../avManager';
import { AVLogger } from '../AVLogger';

interface UseAVManagerArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  editorActiveRef: React.MutableRefObject<boolean>;
  avRef: React.MutableRefObject<AVManager | null>;
  setDevices: React.Dispatch<
    React.SetStateAction<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>
  >;
  setSelectedMicId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedCamId: React.Dispatch<React.SetStateAction<string>>;
  buildParticipantList: () => void;
  onConnected?: () => void;
}

async function performRefreshDevices(
  avRef: React.MutableRefObject<AVManager | null>,
  setDevices: UseAVManagerArgs['setDevices'],
  setSelectedMicId: UseAVManagerArgs['setSelectedMicId'],
  setSelectedCamId: UseAVManagerArgs['setSelectedCamId'],
): Promise<void> {
  const list = await avRef.current!.listDevices();
  const micOptions = list.microphones.map((d: { deviceId: string; label: string }) => ({
    id: d.deviceId,
    label: d.label,
  }));
  const camOptions = list.cameras.map((d: { deviceId: string; label: string }) => ({ id: d.deviceId, label: d.label }));

  setDevices({ mics: micOptions, cams: camOptions });

  // Set defaults if not already set
  const defaultMic = micOptions.find((d: { id: string }) => d.id === 'default')?.id || micOptions[0]?.id || '';
  const defaultCam = camOptions.find((d: { id: string }) => d.id === 'default')?.id || camOptions[0]?.id || '';

  setSelectedMicId((prev) => prev || defaultMic);
  setSelectedCamId((prev) => prev || defaultCam);
}

type ConnectArgs = {
  apiBase: string;
  me: { id: string; email: string; name?: string };
  avRef: React.MutableRefObject<AVManager | null>;
  refreshDevices: () => Promise<void>;
  scheduleBuildParticipantList: (delay?: number) => void;
  onConnected: (() => void) | undefined;
};

async function performConnect(args: ConnectArgs): Promise<void> {
  const { apiBase, me, avRef, refreshDevices, scheduleBuildParticipantList, onConnected } = args;
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
    void setupRoomEventListeners(room, scheduleBuildParticipantList);
  }

  // Initial participant list build
  scheduleBuildParticipantList(50);

  // Notify parent
  onConnected?.();
}

function useAutoConnectOnMount(
  me: UseAVManagerArgs['me'],
  editorActiveRef: React.MutableRefObject<boolean>,
  avRef: React.MutableRefObject<AVManager | null>,
  isConnectingRef: React.MutableRefObject<boolean>,
  hasAutoConnectedRef: React.MutableRefObject<boolean>,
  connect: () => Promise<void>,
): void {
  React.useEffect(() => {
    if (!me) return;
    if (!hasAutoConnectedRef.current) {
      hasAutoConnectedRef.current = true;
      setTimeout(() => {
        if (
          !editorActiveRef.current &&
          !avRef.current?.room &&
          !isConnectingRef.current &&
          !(typeof window !== 'undefined' && (window as any).__sessionConflictPending)
        ) {
          void connect();
        }
      }, 300);
    }
  }, [me?.id, connect, editorActiveRef, avRef]);
}

function useConnectOnFirstInteraction(
  avRef: React.MutableRefObject<AVManager | null>,
  connect: () => Promise<void>,
  refreshDevices: () => Promise<void>,
): void {
  React.useEffect(() => {
    const handleFirstInteraction = () => {
      if (!avRef.current?.room && !(typeof window !== 'undefined' && (window as any).__sessionConflictPending)) {
        void connect();
      }
      // Refresh devices after interaction (permissions may now be granted)
      setTimeout(() => {
        void refreshDevices();
      }, 100);
    };

    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [connect, refreshDevices, avRef]);
}

function useDeviceChangeWatcher(refreshDevices: () => Promise<void>): void {
  React.useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || typeof md.addEventListener !== 'function') return;

    const handler = () => {
      void refreshDevices();
    };
    md.addEventListener('devicechange', handler);

    return () => {
      try {
        md.removeEventListener('devicechange', handler);
      } catch {}
    };
  }, [refreshDevices]);
}

function useAVManagerCleanup(avRef: React.MutableRefObject<AVManager | null>): void {
  React.useEffect(() => {
    return () => {
      try {
        avRef.current?.dispose();
        avRef.current = null;
      } catch {}
    };
  }, [avRef]);
}

function useBuildListTimerCleanup(
  buildListTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
): void {
  React.useEffect(() => {
    return () => {
      if (buildListTimerRef.current) {
        clearTimeout(buildListTimerRef.current);
      }
    };
  }, []);
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

  const scheduleBuildParticipantList = React.useCallback(
    (delay: number = 100) => {
      if (buildListTimerRef.current) return;
      buildListTimerRef.current = setTimeout(() => {
        buildListTimerRef.current = null;
        try {
          buildParticipantList();
        } catch {}
      }, delay);
    },
    [buildParticipantList],
  );

  useBuildListTimerCleanup(buildListTimerRef);

  // Refresh available devices
  const refreshDevices = React.useCallback(async () => {
    if (!avRef.current || refreshingDevicesRef.current) return;
    refreshingDevicesRef.current = true;
    try {
      await performRefreshDevices(avRef, setDevices, setSelectedMicId, setSelectedCamId);
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
    if (typeof window !== 'undefined' && (window as any).__sessionConflictPending) return;

    isConnectingRef.current = true;

    try {
      await performConnect({ apiBase, me, avRef, refreshDevices, scheduleBuildParticipantList, onConnected });
    } catch (error) {
      AVLogger.error('connection.failed', { error: String(error) });
    } finally {
      isConnectingRef.current = false;
    }
  }, [apiBase, me, editorActiveRef, avRef, refreshDevices, scheduleBuildParticipantList, onConnected]);

  useAutoConnectOnMount(me, editorActiveRef, avRef, isConnectingRef, hasAutoConnectedRef, connect);
  useConnectOnFirstInteraction(avRef, connect, refreshDevices);
  useDeviceChangeWatcher(refreshDevices);
  useAVManagerCleanup(avRef);

  return { connect, refreshDevices };
}

// Helper to set up room event listeners
async function setupRoomEventListeners(room: any, scheduleBuild: (delay?: number) => void): Promise<void> {
  try {
    const { RoomEvent } = await import('livekit-client');

    room.on(RoomEvent.ParticipantConnected, () => scheduleBuild(100));
    room.on(RoomEvent.ParticipantDisconnected, () => scheduleBuild(100));
    room.on(RoomEvent.TrackPublished, () => scheduleBuild(100));
    room.on(RoomEvent.TrackUnpublished, () => scheduleBuild(100));
    room.on(RoomEvent.TrackSubscribed, () => scheduleBuild(200));
    room.on(RoomEvent.TrackMuted, () => scheduleBuild(100));
    room.on(RoomEvent.TrackUnmuted, () => scheduleBuild(100));
    room.on(RoomEvent.ActiveSpeakersChanged, () => scheduleBuild(100));
  } catch {
    // Fallback without specific events
  }
}
