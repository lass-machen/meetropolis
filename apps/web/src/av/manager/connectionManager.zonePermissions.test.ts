import { describe, it, expect, vi } from 'vitest';
import { ConnectionManager, type ConnectionManagerDeps } from './connectionManager';
import { joinLivekitRoom } from '../../lib/livekit';

vi.mock('../../lib/livekit', () => {
  return {
    joinLivekitRoom: vi.fn(),
  };
});

function makeFakeRoom() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    localParticipant: {
      setTrackSubscriptionPermissions: vi.fn(),
    },
  };
}

describe('ConnectionManager zone permissions baseline', () => {
  it('switchTo applies the baseline before publishing pending tracks', async () => {
    const room = makeFakeRoom();
    vi.mocked(joinLivekitRoom).mockResolvedValue(room as never);

    const applyBaseline = vi.fn();
    const publishPendingTracks = vi.fn().mockResolvedValue(undefined);

    const deps: ConnectionManagerDeps = {
      stateMachine: {
        room: null,
        state: 'idle',
        isConnected: false,
        pageLeaving: false,
        setRoom: vi.fn(),
        dispatch: vi.fn(),
        resetReconnect: vi.fn(),
        scheduleReconnect: vi.fn(),
        cancelReconnect: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
      },
      trackManager: {
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
        setCameraEnabled: vi.fn().mockResolvedValue(undefined),
        useMicrophoneDevice: vi.fn().mockResolvedValue(undefined),
        useCameraDevice: vi.fn().mockResolvedValue(undefined),
        republishMicrophone: vi.fn().mockResolvedValue(undefined),
        applyStopMicOnMute: vi.fn(),
        saveState: vi.fn(() => ({ mic: false, cam: false })),
        publishPendingTracks,
        stopAllTracks: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
      subscriptionManager: {
        start: vi.fn(),
        stop: vi.fn(),
        forceApply: vi.fn(),
        ensureAudioSubscriptions: vi.fn(),
        setActiveSpeakers: vi.fn(),
        setParticipantVolume: vi.fn(),
        muteAllRemote: vi.fn(),
        restoreAllRemote: vi.fn(),
        dispose: vi.fn(),
      },
      dnd: {
        enabled: false,
        setEnabled: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
      screenshare: {
        isSharing: false,
        desiredSharing: false,
        start: vi.fn().mockResolvedValue(true),
        stop: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
      signalMonitor: { setRoom: vi.fn() },
      zonePermissions: { applyBaseline },
    };

    const manager = new ConnectionManager(
      {
        baseUrl: 'http://localhost:2568',
        identity: 'me',
        displayName: 'Me',
        useVideo: true,
        connectionTimeoutMs: 25000,
        signalPingIntervalMs: 5000,
        signalPingTimeoutMs: 3000,
        maxReconnectAttempts: 10,
        reconnectBaseDelayMs: 1000,
        reconnectMaxDelayMs: 30000,
        maxVideoSubscriptions: 6,
        videoRetentionMs: 8000,
      },
      deps,
    );

    await manager.switchTo('world');

    expect(applyBaseline).toHaveBeenCalledTimes(1);
    expect(publishPendingTracks).toHaveBeenCalledTimes(1);
    expect(applyBaseline.mock.invocationCallOrder[0]).toBeLessThan(publishPendingTracks.mock.invocationCallOrder[0]);
  });
});
