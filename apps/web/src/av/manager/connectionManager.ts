/**
 * ConnectionManager - Handles room connection lifecycle
 */

import type { Room, RemoteParticipant, RemoteTrack } from 'livekit-client';
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
import { readPubKind, readPubSource, type TrackLike, type TrackPublicationLike } from '../../types/livekit';

export interface ConnectionManagerDeps {
  stateMachine: AVStateMachineInterface;
  trackManager: TrackManagerInterface;
  subscriptionManager: SubscriptionManagerInterface;
  dnd: DoNotDisturbInterface;
  screenshare: ScreenshareInterface;
  signalMonitor: { setRoom(room: Room | null): void };
  // H4 audio-zone privacy: deny-all baseline, applied immediately on
  // connect. See zonePermissionsManager.ts's module doc.
  zonePermissions: { applyDenyAll(): void };
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
    private readonly deps: ConnectionManagerDeps,
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

      // Apply audio settings.
      // NOTE: `Room.setTrackPublishDefaults` does not exist in
      // livekit-client 2.18.9 (verified: absent from both the bundled ESM
      // and the .d.ts). The optional-chaining call below is therefore a
      // silent no-op on this SDK version; useDtx/useFec are not applied at
      // runtime through this path. Kept only so this call activates
      // automatically if a future SDK version adds the method. dtx/red are
      // NOT part of the mic republish signature (see avManager.ts) for the
      // same reason. Do not extend this call with stopMicTrackOnMute: that
      // is wired through the per-publish option in microphonePublishing.ts
      // instead, which does exist on this SDK version.
      try {
        const settings = useAvSettingsStore.getState().settings;
        (
          room as Room & { setTrackPublishDefaults?: (opts: { dtx: boolean; red: boolean }) => void }
        ).setTrackPublishDefaults?.({ dtx: !!settings.useDtx, red: !!settings.useFec });
      } catch {}

      // Update state
      this.deps.stateMachine.setRoom(room, name);
      this._currentRoomName = name;

      // H4 audio-zone privacy: deny-all baseline BEFORE any track is
      // published. Without this, a freshly published track would be
      // subscribable by any client (LiveKit's default
      // `allParticipantsAllowed: true`) until the first real
      // `av_zone_permissions` push arrives - see zonePermissionsManager.ts.
      this.deps.zonePermissions.applyDenyAll();

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
    await this.deps.screenshare.stop({ preserveDesired: true });

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

    interface AudioUnlockRoom {
      startAudio?: () => Promise<void>;
      canPlaybackAudio?: boolean;
    }
    const roomCheck: AudioUnlockRoom | null = this.deps.stateMachine.room;
    if (!roomCheck || typeof roomCheck.startAudio !== 'function') return;

    this.audioUnlockHandlersAttached = true;

    const tryUnlock = () => {
      const room: AudioUnlockRoom | null = this.deps.stateMachine.room;
      if (!room || typeof room.startAudio !== 'function') return;
      if (room.canPlaybackAudio) {
        cleanup();
        return;
      }

      try {
        const p: Promise<void> | undefined = room.startAudio();
        if (room.canPlaybackAudio) {
          cleanup();
          return;
        }
        if (p !== undefined && typeof (p as { then?: unknown }).then === 'function') {
          p.then(() => {
            if (room.canPlaybackAudio) cleanup();
          }).catch(() => {});
        }
      } catch {}
    };

    function onGesture() {
      tryUnlock();
    }

    const cleanup = () => {
      if (!this.audioUnlockHandlersAttached) return;
      this.audioUnlockHandlersAttached = false;
      try {
        window.removeEventListener('pointerdown', onGesture);
      } catch {}
      try {
        window.removeEventListener('click', onGesture);
      } catch {}
      this.audioUnlockCleanup = null;
    };

    try {
      window.addEventListener('pointerdown', onGesture);
    } catch {}
    try {
      window.addEventListener('click', onGesture);
    } catch {}

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

    type RoomEventHandler = (...args: unknown[]) => void;
    const handlers: Array<[string, RoomEventHandler]> = [];
    const registered = new Set<string>();
    const roomLike = r as Room & {
      on?: (event: string, handler: RoomEventHandler) => void;
      off?: (event: string, handler: RoomEventHandler) => void;
    };

    const register = (event: string, handler: RoomEventHandler) => {
      if (registered.has(event)) return;
      registered.add(event);
      roomLike.on?.(event, handler);
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
      // Restore screenshare if it was active before disconnect
      if (this.deps.screenshare.desiredSharing && !this.deps.screenshare.isSharing) {
        AVLogger.info('screenshare.restore_after_reconnect');
        this.deps.screenshare.start().catch((err) => {
          AVLogger.warn('screenshare.restore_failed', { error: String(err) });
        });
      }
    });

    register('disconnected', () => {
      AVLogger.warn('room.disconnected');
      if (!this.deps.stateMachine.pageLeaving) {
        this.deps.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
        this.scheduleReconnect();
      }
    });

    register('trackPublished', () => {
      if (!this.deps.dnd.enabled) {
        this.deps.subscriptionManager.ensureAudioSubscriptions(64);
      }
      this.deps.subscriptionManager.forceApply();
      emitAudioTracksChanged();
    });

    register('trackSubscribed', (...args) => {
      const track = args[0] as TrackLike | undefined;
      const pub = args[1] as TrackPublicationLike | undefined;
      const participant = args[2] as RemoteParticipant | undefined;
      const kind = readPubKind(pub) ?? track?.kind;
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

    register('activeSpeakersChanged', (...args) => {
      const speakers = (args[0] as RemoteParticipant[]) ?? [];
      this.deps.subscriptionManager.setActiveSpeakers(speakers);
    });

    // Import RoomEvent dynamically
    void (async () => {
      try {
        const { RoomEvent } = await import('livekit-client');

        register(RoomEvent.Reconnected, () => {
          AVLogger.info('room.reconnected');
          this.deps.stateMachine.resetReconnect();
          this.deps.subscriptionManager.forceApply();
          this.deps.subscriptionManager.ensureAudioSubscriptions(64);
          if (!this.deps.dnd.enabled) {
            this.deps.trackManager.publishPendingTracks().catch(() => {});
          }
          // Restore screenshare if it was active before disconnect
          if (this.deps.screenshare.desiredSharing && !this.deps.screenshare.isSharing) {
            AVLogger.info('screenshare.restore_after_reconnect');
            this.deps.screenshare.start().catch((err) => {
              AVLogger.warn('screenshare.restore_failed', { error: String(err) });
            });
          }
        });

        register(RoomEvent.Disconnected, () => {
          AVLogger.warn('room.disconnected');
          if (!this.deps.stateMachine.pageLeaving) {
            this.deps.stateMachine.dispatch({ type: 'SIGNAL_LOST' });
            this.scheduleReconnect();
          }
        });

        register(RoomEvent.TrackPublished, (...args) => {
          const pub = args[0] as TrackPublicationLike | undefined;
          const participant = args[1] as RemoteParticipant | undefined;
          const kind = readPubKind(pub);
          const source = readPubSource(pub);

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

        register(RoomEvent.TrackSubscribed, (...args) => {
          const track = args[0] as (RemoteTrack & TrackLike) | undefined;
          const pub = args[1] as TrackPublicationLike | undefined;
          const participant = args[2] as RemoteParticipant | undefined;
          const kind = readPubKind(pub) ?? track?.kind;

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

        register(RoomEvent.TrackUnsubscribed, () => {
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnpublished, () => {
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackMuted, (...args) => {
          const participant = args[1] as RemoteParticipant | undefined;
          AVLogger.debug('room.track_muted', { participant: participant?.identity });
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.TrackUnmuted, (...args) => {
          const participant = args[1] as RemoteParticipant | undefined;
          AVLogger.debug('room.track_unmuted', { participant: participant?.identity });
          this.deps.subscriptionManager.forceApply();
          emitAudioTracksChanged();
        });

        register(RoomEvent.ParticipantConnected, (...args) => {
          const participant = args[0] as RemoteParticipant | undefined;
          AVLogger.debug('room.participant_connected', {
            identity: participant?.identity,
          });
          this.deps.subscriptionManager.ensureAudioSubscriptions(64);
          this.deps.subscriptionManager.forceApply();
        });

        register(RoomEvent.ParticipantDisconnected, (...args) => {
          const participant = args[0] as RemoteParticipant | undefined;
          AVLogger.debug('room.participant_disconnected', {
            identity: participant?.identity,
          });
          this.deps.subscriptionManager.forceApply();
        });

        register(RoomEvent.ActiveSpeakersChanged, (...args) => {
          const speakers = (args[0] as RemoteParticipant[]) ?? [];
          this.deps.subscriptionManager.setActiveSpeakers(speakers);
        });

        register(RoomEvent.ConnectionQualityChanged, (...args) => {
          const participant = args[0] as { identity?: string } | undefined;
          const quality = args[1];
          if (participant?.identity === this.config.identity) {
            AVLogger.debug('room.quality_changed', { quality: String(quality) });
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
          roomLike.off?.(event, handler);
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
