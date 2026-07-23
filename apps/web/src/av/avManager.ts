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
 * - ConnectionManager: Room connection lifecycle
 * - DeviceManager: Device enumeration
 * - PublishingManager: Track publishing delegation
 * - VolumeController: Volume and DND coordination
 */

import type { Room } from 'livekit-client';
import type { AVManagerConfig, AVConnectionEvent, AVConnectionState, Disposable, Unsubscribe } from './core/types';
import { AVStateMachine, type StateChangeHandler } from './core/AVStateMachine';
import { SignalMonitor, waitForRoomConnected } from './core/SignalMonitor';
import { TrackManager } from './core/TrackManager';
import { SubscriptionManager } from './core/SubscriptionManager';
import { DoNotDisturb } from './features/DoNotDisturb';
import { Screenshare } from './features/Screenshare';
import { AVLogger } from './AVLogger';
import { setAudioDuckingDndActive } from './audio/audioSessionDucking';
import { ConnectionManager } from './manager/connectionManager';
import { DeviceManager } from './manager/deviceManager';
import { PublishingManager } from './manager/publishingManager';
import { VolumeController } from './manager/volumeController';
import { ZonePermissionsManager, type ZoneAllowListPayload } from './manager/zonePermissionsManager';
import { useAvSettingsStore, type AvSettings } from '../state/avSettings';
import { readTimeoutMs } from '../lib/runtimeConfig';

// Re-export for backwards compatibility
export type { AVDevices } from './core/types';

// Trailing debounce for republishing the mic after a live avSettings change.
// Coalesces rapid slider drags / checkbox toggles into a single republish.
const REPUBLISH_DEBOUNCE_MS = readTimeoutMs('VITE_AV_REPUBLISH_DEBOUNCE_MS', 600);

// Signature of the ONLY avSettings fields that actually affect the capture
// pipeline today (see buildAudioPipeline.ts / buildAudioConstraints()).
// highpassFilter, compressor, opusBitrateKbps, clientVoiceIsolation,
// serverVoiceIsolation and sampleRate are not wired into the publish path
// and are deliberately excluded here — a republish would have no audible
// effect. Extend this signature if/when those fields get wired up.
function buildAudioSig(settings: AvSettings): string {
  return `${settings.echoCancellation}|${settings.noiseSuppression}|${settings.autoGainControl}|${settings.channelCount}`;
}

// Default configuration with env overrides
function buildConfig(
  opts: Partial<AVManagerConfig> & Pick<AVManagerConfig, 'baseUrl' | 'identity' | 'useVideo'>,
): Required<AVManagerConfig> {
  const env = import.meta.env;

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

  // Manager modules
  private readonly connectionManager: ConnectionManager;
  private readonly deviceManager: DeviceManager;
  private readonly publishingManager: PublishingManager;
  private readonly volumeController: VolumeController;
  private readonly zonePermissions: ZonePermissionsManager;

  // Live avSettings subscription (debounced republish + stopMicOnMute mirroring)
  private _lastAudioSig: string = buildAudioSig(useAvSettingsStore.getState().settings);
  private _avSettingsUnsub: (() => void) | undefined;
  private _republishTimer: ReturnType<typeof setTimeout> | undefined;

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
      isSignalOpen: () => this.isSignalOpen(),
      onTrackPublished: () => this.handleTrackPublished(),
      onAllTracksUnpublished: () => this.handleAllTracksUnpublished(),
      ensureConnected: () => this.connectionManager.ensureConnected(),
    });

    // Initialize subscription manager
    this.subscriptionManager = new SubscriptionManager(
      {
        maxVideoSubscriptions: this.config.maxVideoSubscriptions,
        videoRetentionMs: this.config.videoRetentionMs,
        fallbackIntervalMs: 4000,
        maxAudioSubscriptions: 6,
      },
      {
        getRoom: () => this.stateMachine.room,
        isSignalOpen: () => this.isSignalOpen(),
        isDND: () => this.dnd.enabled,
      },
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
      forceResubscribe: () => {
        // After DND exit: force full re-evaluation of subscription state
        // and ensure audio for same-map participants is subscribed again.
        // The `_lastApplyKey` dedupe inside applySubscriptions() would
        // otherwise treat post-DND state as unchanged.
        try {
          this.subscriptionManager.forceApply();
        } catch (error) {
          AVLogger.warn('manager.dnd.force_resubscribe.error', { error: String(error) });
        }
        try {
          this.subscriptionManager.ensureAudioSubscriptions();
        } catch (error) {
          AVLogger.warn('manager.dnd.ensure_audio.error', { error: String(error) });
        }
      },
      refreshRemoteAudioElements: () => {
        // After DND exit: clear the `muted` flag on all remote
        // <audio data-av-remote> elements. useGlobalAudioTracks sets
        // muted=true while DND is active; without this step the flag would
        // persist until the next track re-subscribe. The volume property is
        // not touched here: it is owned by the volume authority
        // (VolumeManager), which recomputes zone/bubble-aware volumes.
        if (typeof document === 'undefined') return;
        try {
          const nodes = document.querySelectorAll<HTMLAudioElement>('audio[data-av-remote]');
          nodes.forEach((audio) => {
            try {
              audio.muted = false;
            } catch {
              /* noop */
            }
          });
        } catch (error) {
          AVLogger.warn('manager.dnd.refresh_audio_elements.error', { error: String(error) });
        }
      },
    });

    // DND suppresses incoming conversation audio, so there is nothing left
    // to duck for. The mic stays soft-muted (capture open), which would keep
    // the voice-processing session and thus system-wide ducking alive;
    // switching the audio session type releases an already-active duck on
    // DND entry and restores the user preference on DND exit.
    this.dnd.subscribe((enabled) => setAudioDuckingDndActive(enabled));

    // Initialize screenshare
    this.screenshare = new Screenshare({
      getRoom: () => this.stateMachine.room,
      isSignalOpen: () => this.isSignalOpen(),
      ensureConnected: () => this.connectionManager.ensureConnected(),
      waitForConnected: (timeout) => this.waitForConnected(timeout),
    });

    // Initialize manager modules
    this.zonePermissions = new ZonePermissionsManager({ getRoom: () => this.stateMachine.room });

    this.connectionManager = new ConnectionManager(this.config, {
      stateMachine: this.stateMachine,
      trackManager: this.trackManager,
      subscriptionManager: this.subscriptionManager,
      dnd: this.dnd,
      screenshare: this.screenshare,
      signalMonitor: this.signalMonitor,
      zonePermissions: this.zonePermissions,
    });

    this.deviceManager = new DeviceManager();

    this.publishingManager = new PublishingManager({
      trackManager: this.trackManager,
      dnd: this.dnd,
    });

    this.volumeController = new VolumeController({
      dnd: this.dnd,
      subscriptionManager: this.subscriptionManager,
    });

    // Live-apply avSettings changes (FIX 2a + republish-on-change)
    this.subscribeToAvSettings();

    // Wire up signal lost handling
    this.signalMonitor.onSignalLost(() => {
      if (!this.stateMachine.pageLeaving) {
        this.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
        this.connectionManager.scheduleReconnect();
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

  // Backwards compatibility aliases (used by older code & unit tests)
  get current(): Room | null {
    return this.stateMachine.room;
  }
  set current(room: Room | null) {
    this.stateMachine.setRoom(room, this.connectionManager.currentRoomName);
    this.signalMonitor.setRoom(room);
  }

  get activeRoom(): string | null {
    return this.connectionManager.currentRoomName;
  }

  get currentName(): string | null {
    return this.connectionManager.currentRoomName;
  }
  set currentName(name: string | null) {
    this.connectionManager.currentRoomName = name;
  }

  get isConnected(): boolean {
    return this.stateMachine.isConnected;
  }

  get state(): AVConnectionState {
    return this.stateMachine.state;
  }

  isSignalOpen(): boolean {
    return this.signalMonitor.isSignalOpen();
  }

  // DND state (for backwards compatibility with direct access)
  get dndEnabled(): boolean {
    return this.volumeController.dndEnabled;
  }

  // ============================================================================
  // Public API - Connection
  // ============================================================================

  async switchTo(roomName: string): Promise<void> {
    if (this._disposed) return;
    await this.connectionManager.switchTo(roomName);
  }

  async leave(): Promise<void> {
    await this.connectionManager.leave();
  }

  // ============================================================================
  // Public API - Tracks
  // ============================================================================

  attachAudioUnlockHandlers(): void {
    this.connectionManager.attachAudioUnlockHandlers();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.publishingManager.setMicrophoneEnabled(enabled);
  }

  // The user's mic/cam intent, set synchronously on toggle. Diverges from the
  // actual publication only while an enable is in flight (e.g. a republish after
  // the hybrid mute released the capture) — the UI uses that gap to hold the
  // button at the intent instead of flickering off.
  get isMicrophoneDesired(): boolean {
    return this.trackManager.state.microphone.desired;
  }

  get isCameraDesired(): boolean {
    return this.trackManager.state.camera.desired;
  }

  // True only while a real (re)publish is in flight (not an instant soft-unmute).
  get isMicrophonePublishing(): boolean {
    return this.trackManager.isMicrophonePublishing;
  }

  get isCameraPublishing(): boolean {
    return this.trackManager.isCameraPublishing;
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.publishingManager.setCameraEnabled(enabled);
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    await this.publishingManager.useMicrophoneDevice(deviceId);
  }

  async useCameraDevice(deviceId: string): Promise<void> {
    await this.publishingManager.useCameraDevice(deviceId);
  }

  /**
   * Tear down and rebuild the published mic track from the current
   * avSettings. Exposed publicly for completeness; the normal trigger is
   * the debounced avSettings subscriber set up in the constructor.
   */
  async republishMicrophone(): Promise<void> {
    await this.publishingManager.republishMicrophone();
  }

  /**
   * Notify the track layer that media input/output devices changed. Triggers a
   * rate-limited recovery nudge for a wanted-but-not-live microphone (e.g. after
   * a headset disconnect + a new device is plugged in). See TrackManager.
   */
  notifyDeviceChange(): void {
    this.trackManager.notifyDeviceChange();
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
    await this.volumeController.setDoNotDisturb(enabled);
  }

  // ============================================================================
  // Public API - Participants
  // ============================================================================

  setParticipantVolume(identity: string, volume: number): void {
    this.volumeController.setParticipantVolume(identity, volume);
  }

  // ============================================================================
  // Public API - H4 Audio-Zone Privacy
  // ============================================================================

  /**
   * Apply a server-pushed `av_zone_permissions` allow-list (see
   * apps/server/src/rooms/audioZones/permissionOrchestrator.ts) to the
   * local participant's own published tracks - the SFU-hard boundary.
   */
  applyZonePermissions(payload: ZoneAllowListPayload): void {
    this.zonePermissions.applyAllowList(payload);
  }

  // ============================================================================
  // Public API - Devices
  // ============================================================================

  async listDevices(): Promise<{
    microphones: { deviceId: string; label: string }[];
    cameras: { deviceId: string; label: string }[];
  }> {
    return this.deviceManager.listDevices();
  }

  async ensurePermissions(audio: boolean, video: boolean): Promise<boolean> {
    return this.deviceManager.ensurePermissions(audio, video);
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

    this._avSettingsUnsub?.();
    this._avSettingsUnsub = undefined;
    if (this._republishTimer) {
      clearTimeout(this._republishTimer);
      this._republishTimer = undefined;
    }

    this.connectionManager.leave().catch(() => {});

    // The DND listeners are cleared below without firing; release the
    // ducking suppression explicitly so the audio session does not stay
    // stuck in 'playback' after the manager is gone.
    setAudioDuckingDndActive(false);

    this.stateMachine.dispose();
    this.signalMonitor.dispose();
    this.trackManager.dispose();
    this.subscriptionManager.dispose();
    this.dnd.dispose();
    this.screenshare.dispose();
    this.connectionManager.dispose();
    this.deviceManager.dispose();
    this.publishingManager.dispose();
    this.volumeController.dispose();
    this.zonePermissions.dispose();

    AVLogger.clearContext();
  }

  // ============================================================================
  // Private
  // ============================================================================

  /**
   * Live-apply avSettings changes to the running mic track:
   * - stopMicOnMute: mirrored immediately (cheap, no renegotiation).
   * - Capture-affecting constraints (see buildAudioSig): debounced +
   *   deduped republish. Never writes back to the avSettings store, so
   *   this cannot feed back into itself.
   */
  private subscribeToAvSettings(): void {
    this._avSettingsUnsub = useAvSettingsStore.subscribe((state) => {
      const settings = state.settings;

      this.trackManager.applyStopMicOnMute(settings.stopMicOnMute);

      const nextSig = buildAudioSig(settings);
      if (nextSig === this._lastAudioSig) return;
      this._lastAudioSig = nextSig;

      if (this._republishTimer) clearTimeout(this._republishTimer);
      this._republishTimer = setTimeout(() => {
        this._republishTimer = undefined;
        this.publishingManager.republishMicrophone().catch((error) => {
          AVLogger.warn('manager.republish.error', { error: String(error) });
        });
      }, REPUBLISH_DEBOUNCE_MS);
    });
  }

  private handleTrackPublished(): void {
    this.stateMachine.dispatch({ type: 'TRACK_PUBLISHED' });
  }

  private handleAllTracksUnpublished(): void {
    this.stateMachine.dispatch({ type: 'ALL_TRACKS_UNPUBLISHED' });
  }

  private handleStateChange(
    newState: AVConnectionState,
    prevState: AVConnectionState,
    _event: AVConnectionEvent,
  ): void {
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
      if (this.connectionManager.currentRoomName && !this.stateMachine.isConnected) {
        this.connectionManager.switchTo(this.connectionManager.currentRoomName).catch(() => {});
      }
    });
  }

  private async waitForConnected(timeoutMs: number = 10000): Promise<boolean> {
    const room = this.stateMachine.room;
    if (!room) return false;
    return waitForRoomConnected(room, timeoutMs);
  }
}
