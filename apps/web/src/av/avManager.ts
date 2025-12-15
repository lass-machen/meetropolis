/**
 * AVManager - Main Facade for Audio/Video System
 *
 * This is the public API for the AV system. It delegates to specialized modules:
 * - AVStateMachine: Connection lifecycle
 * - SignalMonitor: WebSocket health
 * - TrackManager: Local tracks (mic, cam)
 * - SubscriptionManager: Remote subscriptions
 * - DoNotDisturb: DND feature
 * - Screenshare: Screen sharing
 */

import type { Room } from 'livekit-client';
import type {
  AVManagerConfig,
  AVConnectionState,
  Disposable,
  Unsubscribe,
} from './core/types';
import { AVStateMachine, type StateChangeHandler } from './core/AVStateMachine';
import { SignalMonitor, waitForRoomConnected } from './core/SignalMonitor';
import { TrackManager } from './core/TrackManager';
import { SubscriptionManager } from './core/SubscriptionManager';
import { DoNotDisturb } from './features/DoNotDisturb';
import { Screenshare } from './features/Screenshare';
import { AVLogger } from './AVLogger';
import { joinLivekitRoom } from '../lib/livekit';
import { useAvSettingsStore } from '../state/avSettings';
import { emitAudioTracksChanged } from '../lib/avEvents';

// Re-export for backwards compatibility
export type { AVDevices } from './core/types';

// Default configuration with env overrides
function buildConfig(opts: Partial<AVManagerConfig> & Pick<AVManagerConfig, 'baseUrl' | 'identity' | 'useVideo'>): Required<AVManagerConfig> {
  const env = (import.meta as any).env ?? {};

  return {
    baseUrl: opts.baseUrl,
    identity: opts.identity,
    displayName: opts.displayName ?? opts.identity,
    useVideo: opts.useVideo,
    connectionTimeoutMs: opts.connectionTimeoutMs ?? 10000,
    signalPingIntervalMs: opts.signalPingIntervalMs ?? 5000,
    signalPingTimeoutMs: opts.signalPingTimeoutMs ?? 3000,
    maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
    reconnectBaseDelayMs: opts.reconnectBaseDelayMs ?? 1000,
    reconnectMaxDelayMs: opts.reconnectMaxDelayMs ?? 30000,
    maxVideoSubscriptions: Math.max(0, Number(env.VITE_AV_MAX_VIDEO_SUBS ?? opts.maxVideoSubscriptions ?? 6)),
    bubbleAttenuationDb: Number(env.VITE_AV_BUBBLE_ATTENUATION_DB ?? opts.bubbleAttenuationDb ?? -12),
    videoRetentionMs: Math.max(0, Number(env.VITE_AV_VIDEO_RETENTION_MS ?? opts.videoRetentionMs ?? 8000)),
  };
}

export class AVManager implements Disposable {
  private readonly config: Required<AVManagerConfig>;

  // Core modules
  private readonly stateMachine: AVStateMachine;
  private readonly signalMonitor: SignalMonitor;
  private readonly trackManager: TrackManager;
  private readonly subscriptionManager: SubscriptionManager;
  private readonly dnd: DoNotDisturb;
  private readonly screenshare: Screenshare;

  // Connection state
  private _currentRoomName: string | null = null;
  private _connectSeq = 0;
  private _roomEventCleanup: (() => void) | null = null;

  // Disposed flag
  private _disposed = false;

  constructor(opts: { baseUrl: string; identity: string; displayName?: string; useVideo: boolean }) {
    this.config = buildConfig(opts);

    // Set logger context
    AVLogger.setContext({ identity: this.config.identity });

    AVLogger.info('manager.init', {
      identity: this.config.identity,
      useVideo: this.config.useVideo,
    });

    // Initialize state machine
    this.stateMachine = new AVStateMachine({
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      reconnectBaseDelayMs: this.config.reconnectBaseDelayMs,
      reconnectMaxDelayMs: this.config.reconnectMaxDelayMs,
      connectionTimeoutMs: this.config.connectionTimeoutMs,
    });

    // Initialize signal monitor
    this.signalMonitor = new SignalMonitor({
      pingIntervalMs: this.config.signalPingIntervalMs,
      pingTimeoutMs: this.config.signalPingTimeoutMs,
      maxMissedPings: 3,
    });

    // Initialize track manager
    this.trackManager = new TrackManager({
      getRoom: () => this.stateMachine.room,
      isSignalOpen: () => this.signalMonitor.isSignalOpen(),
      onTrackPublished: () => this.handleTrackPublished(),
      onAllTracksUnpublished: () => this.handleAllTracksUnpublished(),
      ensureConnected: () => this.ensureConnected(),
    });

    // Initialize subscription manager
    this.subscriptionManager = new SubscriptionManager(
      {
        maxVideoSubscriptions: this.config.maxVideoSubscriptions,
        bubbleAttenuationDb: this.config.bubbleAttenuationDb,
        videoRetentionMs: this.config.videoRetentionMs,
        fallbackIntervalMs: 4000,
        maxAudioSubscriptions: 6,
      },
      {
        getRoom: () => this.stateMachine.room,
        isSignalOpen: () => this.signalMonitor.isSignalOpen(),
        isDND: () => this.dnd.enabled,
      }
    );

    // Initialize DND
    this.dnd = new DoNotDisturb({
      setMicrophoneEnabled: (enabled) => this.trackManager.setMicrophoneEnabled(enabled),
      setCameraEnabled: (enabled) => this.trackManager.setCameraEnabled(enabled),
      stopScreenshare: () => this.screenshare.stop(),
      isMicrophoneEnabled: () => this.trackManager.isMicrophoneEnabled,
      isCameraEnabled: () => this.trackManager.isCameraEnabled,
      muteAllRemote: () => this.subscriptionManager.muteAllRemote(),
      restoreAllRemote: () => this.subscriptionManager.restoreAllRemote(),
    });

    // Initialize screenshare
    this.screenshare = new Screenshare({
      getRoom: () => this.stateMachine.room,
      isSignalOpen: () => this.signalMonitor.isSignalOpen(),
      ensureConnected: () => this.ensureConnected(),
      waitForConnected: (timeout) => this.waitForConnected(timeout),
    });

    // Wire up signal lost handling
    this.signalMonitor.onSignalLost(() => {
      if (!this.stateMachine.pageLeaving) {
        this.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
        this.scheduleReconnect();
      }
    });

    // Wire up state machine listeners
    this.stateMachine.subscribe((newState, prevState, event) => {
      this.handleStateChange(newState, prevState, event);
    });

    // Setup network listeners
    this.setupNetworkListeners();
  }

  // ============================================================================
  // Public API - Properties
  // ============================================================================

  get room(): Room | undefined {
    return this.stateMachine.room ?? undefined;
  }

  get activeRoom(): string | null {
    return this._currentRoomName;
  }

  get isConnected(): boolean {
    return this.stateMachine.isConnected;
  }

  get state(): AVConnectionState {
    return this.stateMachine.state;
  }

  // DND state (for backwards compatibility with direct access)
  get dndEnabled(): boolean {
    return this.dnd.enabled;
  }

  // ============================================================================
  // Public API - Connection
  // ============================================================================

  async switchTo(roomName: string): Promise<void> {
    if (this._disposed) return;

    const name = roomName || 'world';

    // Skip if already connected to same room
    if (this._currentRoomName === name && this.stateMachine.isConnected) {
      AVLogger.debug('manager.switchTo.skip', { roomName: name, reason: 'already_connected' });
      return;
    }

    const seq = ++this._connectSeq;

    AVLogger.info('manager.switchTo', { roomName: name });

    // Dispatch connecting event
    this.stateMachine.dispatch({ type: 'CONNECT', roomName: name });

    try {
      // Leave current room if any
      await this.leave();
      if (seq !== this._connectSeq) return;

      // Join new room
      const room = await joinLivekitRoom({
        baseUrl: this.config.baseUrl,
        tokenEndpoint: '/livekit/token',
        roomName: name,
        identity: this.config.identity,
        displayName: this.config.displayName,
        useVideo: this.config.useVideo,
      });

      if (seq !== this._connectSeq) {
        await room.disconnect();
        return;
      }

      // Apply audio settings
      try {
        const settings = useAvSettingsStore.getState().settings;
        (room as any).setTrackPublishDefaults?.({ dtx: !!settings.useDtx, red: !!settings.useFec });
      } catch {}

      // Update state
      this.stateMachine.setRoom(room, name);
      this._currentRoomName = name;

      // Setup room events
      this.wireRoomEvents(room);

      // Start signal monitor
      this.signalMonitor.setRoom(room);

      // Start subscription manager
      this.subscriptionManager.start();

      // Dispatch connected event
      this.stateMachine.dispatch({ type: 'CONNECTED', room });

      AVLogger.info('manager.connected', { roomName: name });

      // Wait for connection to stabilize
      await waitForRoomConnected(room, 5000);

      // Publish any pending tracks
      if (!this.dnd.enabled) {
        await this.trackManager.publishPendingTracks();
      }

      // Initial subscriptions
      this.subscriptionManager.ensureAudioSubscriptions(64);
      this.subscriptionManager.forceApply();

    } catch (error) {
      AVLogger.error('manager.switchTo.error', { error: String(error) });
      this.stateMachine.dispatch({ type: 'ERROR', error: error as Error });
      throw error;
    }
  }

  async leave(): Promise<void> {
    if (!this.stateMachine.room) return;

    const prevRoomName = this._currentRoomName;
    AVLogger.info('manager.leave', { roomName: prevRoomName });

    // Stop subscriptions
    this.subscriptionManager.stop();

    // Stop signal monitor
    this.signalMonitor.setRoom(null);

    // Stop all local tracks
    await this.trackManager.stopAllTracks();
    await this.screenshare.stop();

    // Cleanup room events
    this._roomEventCleanup?.();
    this._roomEventCleanup = null;

    // Disconnect room
    try {
      await this.stateMachine.room.disconnect();
    } catch {}

    // Update state
    this.stateMachine.setRoom(null, null);
    this._currentRoomName = null;
    this.stateMachine.dispatch({ type: 'DISCONNECT' });
  }

  // ============================================================================
  // Public API - Tracks
  // ============================================================================

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    if (this.dnd.enabled && enabled) {
      AVLogger.debug('manager.mic.blocked_by_dnd');
      return;
    }
    await this.trackManager.setMicrophoneEnabled(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    if (this.dnd.enabled && enabled) {
      AVLogger.debug('manager.cam.blocked_by_dnd');
      return;
    }
    await this.trackManager.setCameraEnabled(enabled);
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    await this.trackManager.useMicrophoneDevice(deviceId);
  }

  async useCameraDevice(deviceId: string): Promise<void> {
    await this.trackManager.useCameraDevice(deviceId);
  }

  // ============================================================================
  // Public API - Screenshare
  // ============================================================================

  async startScreenshare(): Promise<boolean> {
    if (this._disposed) return false;
    if (this.dnd.enabled) {
      AVLogger.debug('manager.screenshare.blocked_by_dnd');
      return false;
    }
    return this.screenshare.start();
  }

  async stopScreenshare(): Promise<void> {
    await this.screenshare.stop();
  }

  // ============================================================================
  // Public API - DND
  // ============================================================================

  async setDoNotDisturb(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    await this.dnd.setEnabled(enabled);
  }

  // ============================================================================
  // Public API - Participants
  // ============================================================================

  setParticipantVolume(identity: string, volume: number): void {
    this.subscriptionManager.setParticipantVolume(identity, volume);
  }

  // ============================================================================
  // Public API - Devices
  // ============================================================================

  async listDevices(): Promise<{ microphones: { deviceId: string; label: string }[]; cameras: { deviceId: string; label: string }[] }> {
    const safeEnumerate = async (): Promise<MediaDeviceInfo[]> => {
      try {
        return await navigator.mediaDevices.enumerateDevices();
      } catch {
        return [];
      }
    };

    let devices = await safeEnumerate();
    let microphones = devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    let cameras = devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));

    // Request permissions if no labels
    const missingDevices = microphones.length === 0 && cameras.length === 0;
    const missingLabels = devices.length > 0 && devices.every((d) => !d.label);

    if (missingDevices || missingLabels) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        for (const track of stream.getTracks()) {
          track.stop();
        }
      } catch {}

      devices = await safeEnumerate();
      microphones = devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
      cameras = devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    }

    // Deduplicate
    const uniqueById = <T extends { deviceId: string }>(arr: T[]): T[] => {
      const seen = new Set<string>();
      return arr.filter((item) => {
        if (seen.has(item.deviceId)) return false;
        seen.add(item.deviceId);
        return true;
      });
    };

    return {
      microphones: uniqueById(microphones).map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      })),
      cameras: uniqueById(cameras).map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      })),
    };
  }

  async ensurePermissions(audio: boolean, video: boolean): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Public API - State Subscription
  // ============================================================================

  onStateChange(handler: StateChangeHandler): Unsubscribe {
    return this.stateMachine.subscribe(handler);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    AVLogger.info('manager.dispose');

    this.leave().catch(() => {});

    this.stateMachine.dispose();
    this.signalMonitor.dispose();
    this.trackManager.dispose();
    this.subscriptionManager.dispose();
    this.dnd.dispose();
    this.screenshare.dispose();

    AVLogger.clearContext();
  }

  // ============================================================================
  // Private
  // ============================================================================

  private handleTrackPublished(): void {
    this.stateMachine.dispatch({ type: 'TRACK_PUBLISHED' });
  }

  private handleAllTracksUnpublished(): void {
    this.stateMachine.dispatch({ type: 'ALL_TRACKS_UNPUBLISHED' });
  }

  private handleStateChange(newState: AVConnectionState, prevState: AVConnectionState, _event: any): void {
    AVLogger.debug('manager.state', { from: prevState, to: newState });

    // Handle reconnecting state
    if (newState === 'reconnecting' && prevState !== 'reconnecting') {
      // Save track state for restoration
      const saved = this.trackManager.saveState();
      AVLogger.debug('manager.tracks.saved', saved);
    }

    // Handle connected after reconnect
    if (newState === 'connected' && prevState === 'connecting') {
      // Publish pending tracks
      if (!this.dnd.enabled) {
        this.trackManager.publishPendingTracks().catch(() => {});
      }
    }
  }

  private wireRoomEvents(room: Room): void {
    this._roomEventCleanup?.();

    const handlers: Array<[string, (...args: any[]) => void]> = [];

    const register = (event: string, handler: (...args: any[]) => void) => {
      (room as any).on?.(event, handler);
      handlers.push([event, handler]);
    };

    // Import RoomEvent dynamically
    (async () => {
      try {
        const { RoomEvent } = await import('livekit-client');

        register(RoomEvent.Reconnected as any, () => {
          AVLogger.info('room.reconnected');
          this.stateMachine.resetReconnect();
          this.subscriptionManager.forceApply();
          this.subscriptionManager.ensureAudioSubscriptions(64);
          if (!this.dnd.enabled) {
            this.trackManager.publishPendingTracks().catch(() => {});
          }
        });

        register(RoomEvent.Disconnected as any, () => {
          AVLogger.warn('room.disconnected');
          if (!this.stateMachine.pageLeaving) {
            this.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
            this.scheduleReconnect();
          }
        });

        register(RoomEvent.TrackPublished as any, (pub: any, participant: any) => {
          const kind = pub?.kind ?? pub?.track?.kind;
          const source = pub?.source ?? pub?.track?.source;

          AVLogger.debug('room.track_published', {
            kind,
            source,
            participant: participant?.identity,
          });

          if (!this.dnd.enabled) {
            this.subscriptionManager.ensureAudioSubscriptions(64);
          }

          // Important: apply subscriptions immediately so screenshares appear quickly.
          this.subscriptionManager.forceApply();

          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackSubscribed as any, (track: any, pub: any, participant: any) => {
          const kind = pub?.kind ?? track?.kind;

          AVLogger.debug('room.track_subscribed', {
            kind,
            participant: participant?.identity,
          });

          // Set initial volume to 0 for safety (bubble will adjust)
          if (kind === 'audio') {
            try {
              pub?.track?.setVolume?.(0);
            } catch {}
          }

          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnsubscribed as any, () => {
          this.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnpublished as any, () => {
          this.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.ParticipantConnected as any, (participant: any) => {
          AVLogger.debug('room.participant_connected', {
            identity: participant?.identity,
          });
          this.subscriptionManager.ensureAudioSubscriptions(64);
          this.subscriptionManager.forceApply();
        });

        register(RoomEvent.ParticipantDisconnected as any, (participant: any) => {
          AVLogger.debug('room.participant_disconnected', {
            identity: participant?.identity,
          });
          this.subscriptionManager.forceApply();
        });

        register(RoomEvent.ActiveSpeakersChanged as any, (speakers: any[]) => {
          this.subscriptionManager.setActiveSpeakers(speakers);
        });

        register(RoomEvent.ConnectionQualityChanged as any, (participant: any, quality: any) => {
          if (participant?.identity === this.config.identity) {
            AVLogger.debug('room.quality_changed', { quality });
          }
        });

      } catch {
        // Fallback to string events
        AVLogger.warn('room.events.fallback');
      }
    })();

    this._roomEventCleanup = () => {
      for (const [event, handler] of handlers) {
        try {
          (room as any).off?.(event, handler);
        } catch {}
      }
    };
  }

  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('offline', () => {
      AVLogger.warn('network.offline');
      if (this.stateMachine.isConnected) {
        this.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
      }
    });

    window.addEventListener('online', () => {
      AVLogger.info('network.online');
      if (this._currentRoomName && !this.stateMachine.isConnected) {
        this.switchTo(this._currentRoomName).catch(() => {});
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stateMachine.pageLeaving) return;
    if (!this._currentRoomName) return;

    this.stateMachine.scheduleReconnect(async () => {
      await this.switchTo(this._currentRoomName!);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.stateMachine.isConnected && this.signalMonitor.isSignalOpen()) return;

    if (this._currentRoomName) {
      await this.switchTo(this._currentRoomName);
    }
  }

  private async waitForConnected(timeoutMs: number = 10000): Promise<boolean> {
    const room = this.stateMachine.room;
    if (!room) return false;
    return waitForRoomConnected(room, timeoutMs);
  }
}
