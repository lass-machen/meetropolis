/**
 * Remote Subscription Manager
 *
 * Manages subscriptions to remote participants' audio/video tracks.
 * Handles:
 * - Proximity-based subscription (bubble members)
 * - Active speaker prioritization
 * - Video subscription limits
 * - Bubble attenuation (volume reduction for non-bubble members)
 * - Fallback subscriptions when no proximity data
 */

import type { Room, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import type { Disposable, Unsubscribe } from './types';
import { AVLogger } from '../AVLogger';
import { onBubbleMembersUpdate, emitAudioTracksChanged } from '../../lib/avEvents';

export interface SubscriptionManagerConfig {
  maxVideoSubscriptions: number;
  bubbleAttenuationDb: number;
  videoRetentionMs: number;
  fallbackIntervalMs: number;
  maxAudioSubscriptions: number;
}

export interface SubscriptionManagerDeps {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  isDND: () => boolean;
}

export class SubscriptionManager implements Disposable {
  private _desiredParticipants: string[] = [];
  private _activeSpeakers: string[] = [];
  private _subscriptionStates: Map<string, { audio: boolean; video: boolean }> = new Map();
  private _lastVideoOnAt: Map<string, number> = new Map();
  private _lastApplyKey: string | null = null;
  private _lastProximityAt = 0;

  // Timers
  private _fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Cleanup
  private _unsubscribeBubble: Unsubscribe | null = null;
  private _disposed = false;

  // Computed config
  private readonly _bubbleAttenuation: number;

  constructor(
    private readonly config: SubscriptionManagerConfig,
    private readonly deps: SubscriptionManagerDeps
  ) {
    // Convert dB to linear gain
    this._bubbleAttenuation = Math.max(
      0,
      Math.min(1, Math.pow(10, config.bubbleAttenuationDb / 20))
    );
  }

  // ============================================================================
  // Public API
  // ============================================================================

  get desiredParticipants(): readonly string[] {
    return this._desiredParticipants;
  }

  get activeSpeakers(): readonly string[] {
    return this._activeSpeakers;
  }

  /**
   * Start listening for bubble updates and managing subscriptions
   */
  start(): void {
    if (this._disposed) return;

    // Listen for proximity-based bubble updates
    this._unsubscribeBubble = onBubbleMembersUpdate((ids: string[]) => {
      this._lastProximityAt = Date.now();
      this.handleDesiredIdsUpdate(ids);
      this.applyBubbleAttenuation(ids);
    });

    // Fallback: Subscribe to some audio if no proximity data
    this.startFallbackTimer();

    AVLogger.debug('subscriptions.started');
  }

  /**
   * Stop managing subscriptions
   */
  stop(): void {
    this._unsubscribeBubble?.();
    this._unsubscribeBubble = null;

    this.stopFallbackTimer();
    this.clearDebounceTimer();

    this._desiredParticipants = [];
    this._activeSpeakers = [];
    this._subscriptionStates.clear();
    this._lastVideoOnAt.clear();
    this._lastApplyKey = null;

    AVLogger.debug('subscriptions.stopped');
  }

  /**
   * Update active speakers list (called from room event)
   */
  setActiveSpeakers(speakers: RemoteParticipant[]): void {
    this._activeSpeakers = speakers.map((p) => String(p.identity || '')).filter(Boolean);
    this.applySubscriptions();
  }

  /**
   * Force re-apply subscriptions (e.g., after reconnect)
   */
  forceApply(): void {
    this._lastApplyKey = null;
    // Clear per-track dedup state so re-published tracks get subscribed.
    // setSubscribed() has its own isCurrentlySubscribed check to avoid thrashing.
    this._subscriptionStates.clear();
    this.applySubscriptions();
  }

  /**
   * Set participant volume (used for bubble attenuation and DND)
   */
  setParticipantVolume(identity: string, volume: number): void {
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      const participant = this.findParticipantByIdentity(room, identity);
      if (!participant) return;

      const publications = Array.from(participant.trackPublications.values());
      for (const pub of publications) {
        const track = (pub as any).track;
        if (!track) continue;

        const kind = (pub as any).kind ?? track.kind;
        const isAudio = kind === 'audio' || (kind == null && typeof track.setVolume === 'function');
        if (!isAudio) continue;
        if (typeof track.setVolume !== 'function') continue;
        track.setVolume(Math.max(0, Math.min(1, volume)));
      }
    } catch (error) {
      AVLogger.warn('subscription.volume.error', { identity, error: String(error) });
    }
  }

  /**
   * Mute all remote audio (for DND)
   */
  muteAllRemote(): void {
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      const participants = Array.from(room.remoteParticipants.values());
      for (const p of participants) {
        const publications = Array.from(p.trackPublications.values());
        for (const pub of publications) {
          const track = (pub as any).track;
          if (!track) continue;

          const kind = (pub as any).kind ?? track.kind;
          const isAudio = kind === 'audio' || (kind == null && typeof track.setVolume === 'function');
          if (isAudio && typeof track.setVolume === 'function') {
            track.setVolume(0);
          }
        }
      }
    } catch (error) {
      AVLogger.warn('subscription.mute_all.error', { error: String(error) });
    }
  }

  /**
   * Restore remote audio volumes (after DND)
   */
  restoreAllRemote(): void {
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      const participants = Array.from(room.remoteParticipants.values());
      for (const p of participants) {
        const publications = Array.from(p.trackPublications.values());
        for (const pub of publications) {
          const track = (pub as any).track;
          if (!track) continue;

          const kind = (pub as any).kind ?? track.kind;
          const isAudio = kind === 'audio' || (kind == null && typeof track.setVolume === 'function');
          if (isAudio && typeof track.setVolume === 'function') {
            track.setVolume(1);
          }
        }
      }

      // Re-apply bubble attenuation
      if (this._desiredParticipants.length > 0) {
        this.applyBubbleAttenuation(this._desiredParticipants);
      }
    } catch (error) {
      AVLogger.warn('subscription.restore_all.error', { error: String(error) });
    }
  }

  /**
   * Ensure audio subscriptions for all participants (up to limit)
   */
  ensureAudioSubscriptions(maxCount: number = 32): void {
    const room = this.deps.getRoom();
    if (!room) return;
    if (this.deps.isDND()) return;
    if (!this.deps.isSignalOpen()) return;

    try {
      const participants = Array.from(room.remoteParticipants.values());
      let count = 0;

      for (const p of participants) {
        if (count >= maxCount) break;

        const publications = Array.from(p.trackPublications.values());
        for (const pub of publications) {
          const kind = (pub as any).kind ?? (pub as any).track?.kind;
          if (kind === 'audio') {
            this.setSubscribed(pub as RemoteTrackPublication, true);
            count++;
          }
        }
      }

      AVLogger.debug('subscription.ensure_audio', { count, maxCount });
    } catch (error) {
      AVLogger.warn('subscription.ensure_audio.error', { error: String(error) });
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.stop();
  }

  // ============================================================================
  // Private: Subscription Logic
  // ============================================================================

  private handleDesiredIdsUpdate(ids: string[]): void {
    const normalized = Array.from(new Set(ids.map((id) => String(id || '')))).sort();
    const prev = JSON.stringify(this._desiredParticipants.slice().sort());
    const next = JSON.stringify(normalized);

    if (prev === next) return;

    this._desiredParticipants = normalized;

    // Debounce apply
    this.clearDebounceTimer();
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.applySubscriptions();
    }, 200);
  }

  private applySubscriptions(): void {
    const room = this.deps.getRoom();
    if (!room) return;
    if (this.deps.isDND()) return;
    if (!this.deps.isSignalOpen()) return;

    const participants = Array.from(room.remoteParticipants.values());
    const participantCount = participants.length;

    // Count video publications to detect track changes (e.g. screen share restart)
    let videoPublicationCount = 0;
    for (const p of participants) {
      const publications = Array.from(p.trackPublications.values());
      for (const pub of publications) {
        const kind = (pub as any).kind ?? (pub as any).track?.kind;
        if (kind === 'video') videoPublicationCount++;
      }
    }

    // Build deduplication key
    const key = [
      JSON.stringify(this._desiredParticipants),
      JSON.stringify(this._activeSpeakers.slice(0, this.config.maxVideoSubscriptions)),
      participantCount,
      videoPublicationCount,
    ].join('|');

    if (key === this._lastApplyKey) return;
    this._lastApplyKey = key;

    AVLogger.debug('subscription.apply', {
      desiredCount: this._desiredParticipants.length,
      speakerCount: this._activeSpeakers.length,
      participantCount,
    });

    try {
      const desiredSet = new Set(this._desiredParticipants);
      const priorityVideoSet = new Set(
        this._desiredParticipants.slice(0, this.config.maxVideoSubscriptions)
      );
      const activeSpeakerSet = new Set(
        this._activeSpeakers.slice(0, this.config.maxVideoSubscriptions)
      );
      const fewParticipants =
        participantCount <= this.config.maxVideoSubscriptions ||
        this.config.maxVideoSubscriptions === 0;

      for (const p of participants) {
        const identity = String(p.identity || '');
        const shouldSubscribe = desiredSet.has(identity);
        const publications = Array.from(p.trackPublications.values());

        for (const pub of publications) {
          const kind = (pub as any).kind ?? (pub as any).track?.kind;
          const source = (pub as any).source ?? (pub as any).track?.source;

          if (kind === 'audio') {
            // Always subscribe to audio if in desired set
            this.setDesired(pub as RemoteTrackPublication, identity, 'audio', true);
          }

          if (kind === 'video') {
            // Subscribe to video based on priority
            const isScreenShare = source === 'screen_share';
            const isPriority = priorityVideoSet.has(identity);
            const isActiveSpeaker = activeSpeakerSet.has(identity);
            const shouldHaveVideo =
              isScreenShare || fewParticipants || isPriority || isActiveSpeaker || shouldSubscribe;

            this.setDesired(pub as RemoteTrackPublication, identity, 'video', shouldHaveVideo);
          }
        }
      }

      emitAudioTracksChanged();
    } catch (error) {
      AVLogger.error('subscription.apply.error', { error: String(error) });
    }
  }

  private setDesired(
    pub: RemoteTrackPublication,
    identity: string,
    kind: 'audio' | 'video',
    should: boolean
  ): void {
    const key = `${identity}:${kind}`;
    const current = this._subscriptionStates.get(key);

    // Video hysteresis: don't turn off video too quickly
    if (kind === 'video' && !should) {
      const lastOn = this._lastVideoOnAt.get(identity) || 0;
      if (Date.now() - lastOn < this.config.videoRetentionMs) {
        return;
      }
    }

    if (kind === 'video' && should) {
      this._lastVideoOnAt.set(identity, Date.now());
    }

    // Update state if changed
    if (current?.[kind] !== should) {
      const state = this._subscriptionStates.get(key) || { audio: false, video: false };
      state[kind] = should;
      this._subscriptionStates.set(key, state);
    }

    // Always apply subscription — a new publication for the same identity
    // (e.g. screen share restart) needs subscribing even when state unchanged.
    // setSubscribed() has its own guard to avoid redundant operations.
    this.setSubscribed(pub, should);
  }

  private setSubscribed(pub: RemoteTrackPublication, should: boolean): void {
    try {
      const isCurrentlySubscribed = this.isSubscribed(pub);
      if (isCurrentlySubscribed === should) return;
      if (!this.deps.isSignalOpen()) return;

      if (typeof (pub as any).setSubscribed === 'function') {
        (pub as any).setSubscribed(should);
      }
    } catch (error) {
      AVLogger.warn('subscription.set.error', { error: String(error) });
    }
  }

  private isSubscribed(pub: RemoteTrackPublication): boolean {
    try {
      if (typeof (pub as any).isSubscribed === 'boolean') return (pub as any).isSubscribed;
      if (typeof (pub as any).subscribed === 'boolean') return (pub as any).subscribed;
      return !!(pub as any).track;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Private: Bubble Attenuation
  // ============================================================================

  private applyBubbleAttenuation(bubbleIds: string[]): void {
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      const bubbleSet = new Set(bubbleIds.map((id) => String(id)));
      const participants = Array.from(room.remoteParticipants.values());

      for (const p of participants) {
        const identity = String(p.identity || '');
        const inBubble = bubbleSet.has(identity);
        const publications = Array.from(p.trackPublications.values());

        for (const pub of publications) {
          const kind = (pub as any).kind ?? (pub as any).track?.kind;
          if (kind !== 'audio') continue;

          const track = (pub as any).track;
          if (!track) continue;

          // Bubble members at full volume, others attenuated
          const volume = inBubble ? 1 : this._bubbleAttenuation;
          if (typeof track.setVolume === 'function') {
            track.setVolume(volume);
          }
        }
      }
    } catch (error) {
      AVLogger.warn('subscription.attenuation.error', { error: String(error) });
    }
  }

  // ============================================================================
  // Private: Fallback Timer
  // ============================================================================

  private startFallbackTimer(): void {
    if (this._fallbackTimer) return;

    this._fallbackTimer = setInterval(() => {
      if (this._disposed) return;
      if (this.deps.isDND()) return;

      // Only use fallback if no proximity data recently
      const timeSinceProximity = Date.now() - this._lastProximityAt;
      if (timeSinceProximity < 3000) return;

      this.applyFallbackSubscriptions();
    }, this.config.fallbackIntervalMs);
  }

  private stopFallbackTimer(): void {
    if (this._fallbackTimer) {
      clearInterval(this._fallbackTimer);
      this._fallbackTimer = null;
    }
  }

  private applyFallbackSubscriptions(): void {
    const room = this.deps.getRoom();
    if (!room) return;
    if (!this.deps.isSignalOpen()) return;

    try {
      const participants = Array.from(room.remoteParticipants.values());
      const chosen = participants.slice(0, this.config.maxAudioSubscriptions);

      for (const p of participants) {
        const identity = String(p.identity || '');
        const shouldSubscribe = chosen.includes(p);
        const publications = Array.from(p.trackPublications.values());

        for (const pub of publications) {
          const kind = (pub as any).kind ?? (pub as any).track?.kind;
          if (kind === 'audio') {
            this.setDesired(pub as RemoteTrackPublication, identity, 'audio', shouldSubscribe);
          }
        }
      }
    } catch (error) {
      AVLogger.warn('subscription.fallback.error', { error: String(error) });
    }
  }

  private clearDebounceTimer(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  // ============================================================================
  // Private: Helpers
  // ============================================================================

  private findParticipantByIdentity(room: Room, identity: string): RemoteParticipant | null {
    const participants = Array.from(room.remoteParticipants.values());
    return (
      participants.find((p) => p.identity === identity) ||
      (room.remoteParticipants.get(identity) as RemoteParticipant | undefined) ||
      null
    );
  }
}
