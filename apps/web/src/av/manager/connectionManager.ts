/**
 * ConnectionManager - Handles room connection lifecycle
 */

import type { Room } from 'livekit-client';
import type { AVManagerConfig, Disposable } from '../core/types';
import type {
  AVStateMachineInterface,
  TrackManagerInterface,
  SubscriptionManagerInterface,
  DoNotDisturbInterface,
  ScreenshareInterface,
} from './types';
import { AVLogger } from '../AVLogger';
import { joinLivekitRoom } from '../../lib/livekit';
import { waitForRoomConnected } from '../core/SignalMonitor';
import { useAvSettingsStore } from '../../state/avSettings';
import { emitAudioTracksChanged } from '../../lib/avEvents';

export interface ConnectionManagerDeps {
  stateMachine: AVStateMachineInterface;
  trackManager: TrackManagerInterface;
  subscriptionManager: SubscriptionManagerInterface;
  dnd: DoNotDisturbInterface;
  screenshare: ScreenshareInterface;
  signalMonitor: { setRoom(room: Room | null): void };
}

export class ConnectionManager implements Disposable {
  private _currentRoomName: string | null = null;
  private _connectSeq = 0;
  private _roomEventCleanup: (() => void) | null = null;
  private audioUnlockHandlersAttached = false;
  private audioUnlockCleanup: (() => void) | null = null;
  private _disposed = false;

  constructor(
    private readonly config: Required<AVManagerConfig>,
    private readonly deps: ConnectionManagerDeps
  ) {}

  get currentRoomName(): string | null {
    return this._currentRoomName;
  }

  set currentRoomName(name: string | null) {
    this._currentRoomName = name;
  }

  async switchTo(roomName: string): Promise<void> {
    if (this._disposed) return;

    const name = roomName || 'world';

    // Skip if already connected to same room
    if (this._currentRoomName === name && this.deps.stateMachine.isConnected) {
      AVLogger.debug('manager.switchTo.skip', { roomName: name, reason: 'already_connected' });
      return;
    }

    const seq = ++this._connectSeq;

    AVLogger.info('manager.switchTo', { roomName: name });

    // Dispatch connecting event
    this.deps.stateMachine.dispatch({ type: 'CONNECT', roomName: name });

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
      this.deps.stateMachine.setRoom(room, name);
      this._currentRoomName = name;

      // Setup room events
      this.wireRoomEvents(room);

      // Start signal monitor
      this.deps.signalMonitor.setRoom(room);

      // Start subscription manager
      this.deps.subscriptionManager.start();

      // Dispatch connected event
      this.deps.stateMachine.dispatch({ type: 'CONNECTED', room });

      AVLogger.info('manager.connected', { roomName: name });

      // Wait for connection to stabilize
      // Increase timeout for Docker Desktop which has slower ICE negotiation
      await waitForRoomConnected(room, 20000);

      // Publish any pending tracks
      if (!this.deps.dnd.enabled) {
        await this.deps.trackManager.publishPendingTracks();
      }

      // Initial subscriptions
      this.deps.subscriptionManager.ensureAudioSubscriptions(64);
      this.deps.subscriptionManager.forceApply();

    } catch (error) {
      AVLogger.error('manager.switchTo.error', { error: String(error) });
      this.deps.stateMachine.dispatch({ type: 'ERROR', error: error as Error });
      throw error;
    }
  }

  async leave(): Promise<void> {
    if (!this.deps.stateMachine.room) return;

    const prevRoomName = this._currentRoomName;
    AVLogger.info('manager.leave', { roomName: prevRoomName });

    // Stop subscriptions
    this.deps.subscriptionManager.stop();

    // Stop signal monitor
    this.deps.signalMonitor.setRoom(null);

    // Stop all local tracks
    await this.deps.trackManager.stopAllTracks();
    await this.deps.screenshare.stop();

    // Cleanup room events
    this._roomEventCleanup?.();
    this._roomEventCleanup = null;
    this.audioUnlockCleanup?.();
    this.audioUnlockCleanup = null;
    this.audioUnlockHandlersAttached = false;

    // Disconnect room
    try {
      await this.deps.stateMachine.room.disconnect();
    } catch {}

    // Update state
    this.deps.stateMachine.setRoom(null, null);
    this._currentRoomName = null;
    this.deps.stateMachine.dispatch({ type: 'DISCONNECT' });
  }

  attachAudioUnlockHandlers(): void {
    if (typeof window === 'undefined') return;
    if (this.audioUnlockHandlersAttached) return;

    const roomAny = this.deps.stateMachine.room as any;
    if (!roomAny || typeof roomAny.startAudio !== 'function') return;

    this.audioUnlockHandlersAttached = true;

    const tryUnlock = () => {
      const room = this.deps.stateMachine.room as any;
      if (!room || typeof room.startAudio !== 'function') return;
      if (room.canPlaybackAudio) return cleanup();

      try {
        const p = room.startAudio();
        if (room.canPlaybackAudio) return cleanup();
        if (p && typeof p.then === 'function') {
          p.then(() => { if (room.canPlaybackAudio) cleanup(); }).catch(() => {});
        }
      } catch {}
    };

    function onGesture() {
      tryUnlock();
    }

    const cleanup = () => {
      if (!this.audioUnlockHandlersAttached) return;
      this.audioUnlockHandlersAttached = false;
      try { window.removeEventListener('pointerdown', onGesture as any); } catch {}
      try { window.removeEventListener('click', onGesture as any); } catch {}
      this.audioUnlockCleanup = null;
    };

    try { window.addEventListener('pointerdown', onGesture as any); } catch {}
    try { window.addEventListener('click', onGesture as any); } catch {}

    this.audioUnlockCleanup = cleanup;
  }

  scheduleReconnect(): void {
    if (this.deps.stateMachine.pageLeaving) return;
    if (!this._currentRoomName) return;

    this.deps.stateMachine.scheduleReconnect(async () => {
      await this.switchTo(this._currentRoomName!);
    });
  }

  async ensureConnected(): Promise<void> {
    if (this.deps.stateMachine.isConnected && this.deps.signalMonitor.setRoom !== undefined) return;

    if (this._currentRoomName) {
      await this.switchTo(this._currentRoomName);
    }
  }

  private wireRoomEvents(room?: Room): void {
    const r = room ?? this.deps.stateMachine.room;
    if (!r) return;
    this._roomEventCleanup?.();

    const handlers: Array<[string, (...args: any[]) => void]> = [];
    const registered = new Set<string>();

    const register = (event: string, handler: (...args: any[]) => void) => {
      if (registered.has(event)) return;
      registered.add(event);
      (r as any).on?.(event, handler);
      handlers.push([event, handler]);
    };

    // Register string events synchronously (tests + fallback runtime).
    register('reconnected', () => {
      AVLogger.info('room.reconnected');
      this.deps.stateMachine.resetReconnect();
      this.deps.subscriptionManager.forceApply();
      this.deps.subscriptionManager.ensureAudioSubscriptions(64);
      if (!this.deps.dnd.enabled) {
        this.deps.trackManager.publishPendingTracks().catch(() => {});
      }
    });

    register('disconnected', () => {
      AVLogger.warn('room.disconnected');
      if (!this.deps.stateMachine.pageLeaving) {
        this.deps.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
        this.scheduleReconnect();
      }
    });

    register('trackPublished', (_pub: any, _participant: any) => {
      if (!this.deps.dnd.enabled) {
        this.deps.subscriptionManager.ensureAudioSubscriptions(64);
      }
      this.deps.subscriptionManager.forceApply();
      emitAudioTracksChanged();
    });

    register('trackSubscribed', (track: any, pub: any, participant: any) => {
      const kind = pub?.kind ?? track?.kind;
      AVLogger.debug('room.track_subscribed', { kind, participant: participant?.identity });
      if (kind === 'audio') {
        try {
          (pub?.track?.setVolume ?? track?.setVolume)?.(0);
        } catch {}
      }
      emitAudioTracksChanged();
    });

    register('trackUnsubscribed', () => {
      this.deps.subscriptionManager.forceApply();
      emitAudioTracksChanged();
    });

    register('trackUnpublished', () => {
      this.deps.subscriptionManager.forceApply();
      emitAudioTracksChanged();
    });

    register('participantConnected', () => {
      this.deps.subscriptionManager.ensureAudioSubscriptions(64);
      this.deps.subscriptionManager.forceApply();
    });

    register('participantDisconnected', () => {
      this.deps.subscriptionManager.forceApply();
    });

    register('activeSpeakersChanged', (speakers: any[]) => {
      this.deps.subscriptionManager.setActiveSpeakers(speakers);
    });

    // Import RoomEvent dynamically
    (async () => {
      try {
        const { RoomEvent } = await import('livekit-client');

        register(RoomEvent.Reconnected as any, () => {
          AVLogger.info('room.reconnected');
          this.deps.stateMachine.resetReconnect();
          this.deps.subscriptionManager.forceApply();
          this.deps.subscriptionManager.ensureAudioSubscriptions(64);
          if (!this.deps.dnd.enabled) {
            this.deps.trackManager.publishPendingTracks().catch(() => {});
          }
        });

        register(RoomEvent.Disconnected as any, () => {
          AVLogger.warn('room.disconnected');
          if (!this.deps.stateMachine.pageLeaving) {
            this.deps.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
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

          if (!this.deps.dnd.enabled) {
            this.deps.subscriptionManager.ensureAudioSubscriptions(64);
          }

          // Important: apply subscriptions immediately so screenshares appear quickly.
          this.deps.subscriptionManager.forceApply();

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
              (pub?.track?.setVolume ?? track?.setVolume)?.(0);
            } catch {}
          }

          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnsubscribed as any, () => {
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnpublished as any, () => {
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.ParticipantConnected as any, (participant: any) => {
          AVLogger.debug('room.participant_connected', {
            identity: participant?.identity,
          });
          this.deps.subscriptionManager.ensureAudioSubscriptions(64);
          this.deps.subscriptionManager.forceApply();
        });

        register(RoomEvent.ParticipantDisconnected as any, (participant: any) => {
          AVLogger.debug('room.participant_disconnected', {
            identity: participant?.identity,
          });
          this.deps.subscriptionManager.forceApply();
        });

        register(RoomEvent.ActiveSpeakersChanged as any, (speakers: any[]) => {
          this.deps.subscriptionManager.setActiveSpeakers(speakers);
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
          (r as any).off?.(event, handler);
        } catch {}
      }
    };
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._roomEventCleanup?.();
    this._roomEventCleanup = null;
    this.audioUnlockCleanup?.();
    this.audioUnlockCleanup = null;
  }
}
