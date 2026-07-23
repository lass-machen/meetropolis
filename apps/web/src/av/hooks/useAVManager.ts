/**
 * useAVManager Hook
 *
 * React hook for initializing and managing the AVManager.
 * Replaces the old useLivekit hook with a cleaner interface.
 */

import React from 'react';
import type { Room } from 'livekit-client';
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
  const useVideo = import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true';

  const manager = new AVManager({
    baseUrl: apiBase,
    identity,
    displayName,
    useVideo,
  });
  // Publish the instance before connecting so the unmount cleanup can still
  // dispose it when the user leaves mid-handshake — otherwise it would finish
  // joining unreachable and linger as a ghost participant with live timers.
  avRef.current = manager;

  // Connect to default room
  try {
    await manager.switchTo('world');
  } catch (error) {
    // Tear down the failed attempt and clear the ref, so a retry starts clean
    // instead of stacking live managers (window listeners, settings
    // subscription, state machine) with every further gesture during an outage.
    try {
      manager.dispose();
    } catch {}
    if (avRef.current === manager) avRef.current = null;
    throw error;
  }

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
        if (!editorActiveRef.current && !avRef.current?.room && !isConnectingRef.current) {
          void connect();
        }
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: me?.id is the correct sentinel for an auth-driven auto-connect; hasAutoConnectedRef and isConnectingRef are mutable refs that guard against double-connect at runtime, capturing them or the full me object would risk a LiveKit reconnect storm on auth refresh
  }, [me?.id, connect, editorActiveRef, avRef]);
}

function useConnectOnFirstInteraction(
  avRef: React.MutableRefObject<AVManager | null>,
  connect: () => Promise<void>,
  refreshDevices: () => Promise<void>,
): void {
  React.useEffect(() => {
    let disposed = false;
    let deviceRefreshScheduled = false;
    let deviceRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    function teardown(): void {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    }

    // The listeners are deliberately not registered with `{ once: true }`.
    // A gesture can arrive while `connect()` is a no-op (map editor active,
    // connect already in flight) or while it fails. A one-shot listener would
    // be consumed by such a gesture, and since `connect` is identity-stable the
    // effect never re-registers it — AV would stay disconnected until reload.
    // The listeners therefore remain armed until a room actually exists.
    function handleFirstInteraction(): void {
      if (avRef.current?.room) {
        teardown();
        return;
      }

      void (async () => {
        await connect();
        if (disposed) return;
        if (avRef.current?.room) teardown();
      })();

      // Refresh devices once after the first gesture (permissions may now be
      // granted). Kept one-shot so repeated gestures do not re-enumerate.
      if (deviceRefreshScheduled) return;
      deviceRefreshScheduled = true;
      deviceRefreshTimer = setTimeout(() => {
        deviceRefreshTimer = null;
        void refreshDevices();
      }, 100);
    }

    window.addEventListener('pointerdown', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);

    return () => {
      disposed = true;
      if (deviceRefreshTimer) clearTimeout(deviceRefreshTimer);
      teardown();
    };
  }, [connect, refreshDevices, avRef]);
}

function useDeviceChangeWatcher(
  refreshDevices: () => Promise<void>,
  avRef: React.MutableRefObject<AVManager | null>,
): void {
  React.useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md || typeof md.addEventListener !== 'function') return;

    const handler = () => {
      void refreshDevices();
      // A device change is a chance to recover a mic that the browser ended
      // (e.g. headset disconnected, then another device plugged in).
      try {
        avRef.current?.notifyDeviceChange();
      } catch {}
    };
    md.addEventListener('devicechange', handler);

    return () => {
      try {
        md.removeEventListener('devicechange', handler);
      } catch {}
    };
  }, [refreshDevices, avRef]);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: buildListTimerRef.current is read at unmount time; the cleanup-timing warning is benign because the ref slot is the timer handle we explicitly want to release
        clearTimeout(buildListTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: mount-only cleanup hook; buildListTimerRef identity never changes, depending on it would be a no-op
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
  useDeviceChangeWatcher(refreshDevices, avRef);
  useAVManagerCleanup(avRef);

  return { connect, refreshDevices };
}

// Helper to set up room event listeners
async function setupRoomEventListeners(room: Room, scheduleBuild: (delay?: number) => void): Promise<void> {
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
