/**
 * Screenshare Feature Module
 *
 * Handles screen sharing logic including:
 * - Web browser screenshare via getDisplayMedia
 * - Electron app screenshare via custom picker
 * - Auto-stop when user ends share via browser UI
 */

import type { Room, LocalTrack, LocalVideoTrack as LocalVideoTrackType, Track as TrackNs } from 'livekit-client';
import type { Disposable } from '../core/types';
import { AVLogger } from '../AVLogger';
import { listPublications, readPubSource, type TrackLike } from '../../types/livekit';

interface DesktopBridge {
  pickDisplaySource?: (opts: { types: string[] }) => Promise<{ id?: string } | null>;
  beginActivityAssertion?: (reason: string) => Promise<unknown>;
  endActivityAssertion?: () => Promise<unknown>;
}

interface ChromeMediaConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
}

export interface ScreenshareDeps {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  ensureConnected: () => Promise<void>;
  waitForConnected: (timeoutMs?: number) => Promise<boolean>;
}

export class Screenshare implements Disposable {
  private _isSharing = false;
  private _isPending = false;
  private _desiredSharing = false;
  private _tracks: LocalTrack[] = [];
  private _trackEndedCleanups: Array<() => void> = [];
  private _reacquireTimer: ReturnType<typeof setTimeout> | null = null;
  private _visibilityHandler: (() => void) | null = null;
  private _disposed = false;

  constructor(private readonly deps: ScreenshareDeps) {}

  // ============================================================================
  // Public API
  // ============================================================================

  get isSharing(): boolean {
    return this._isSharing;
  }

  get isPending(): boolean {
    return this._isPending;
  }

  get desiredSharing(): boolean {
    return this._desiredSharing;
  }

  /**
   * Start screen sharing
   * Returns true if sharing started successfully
   */
  async start(): Promise<boolean> {
    if (this._disposed) return false;
    if (this._isPending) return false;
    if (this._isSharing) return true;
    if (this.checkIsSharing()) {
      this._isSharing = true;
      return true;
    }

    this._desiredSharing = true;
    this._clearReacquire();
    this._isPending = true;
    AVLogger.info('screenshare.start');

    try {
      // Get tracks based on environment (Electron vs Web)
      const tracks = await this.captureTracks();

      if (!tracks || tracks.length === 0) {
        AVLogger.info('screenshare.cancelled');
        this._isPending = false;
        return false;
      }

      // Get room - we need it for publishing
      let room = this.deps.getRoom();

      // If no room, try to connect first
      if (!room || !this.deps.isSignalOpen()) {
        if (room && !this.deps.isSignalOpen()) {
          AVLogger.warn('screenshare.signal_closed');
        }
        AVLogger.debug('screenshare.waiting_for_room');
        await this.deps.ensureConnected();
        // Increase timeout for Docker Desktop which has slower ICE negotiation
        const connected = await this.deps.waitForConnected(20000);

        if (!connected) {
          AVLogger.warn('screenshare.connection_failed', { reason: 'timeout' });
          this.cleanupTracks(tracks);
          this._isPending = false;
          return false;
        }

        room = this.deps.getRoom();
        if (!room) {
          AVLogger.warn('screenshare.connection_failed', { reason: 'no_room_after_wait' });
          this.cleanupTracks(tracks);
          this._isPending = false;
          return false;
        }
      }

      // Publish tracks
      for (const track of tracks) {
        await room.localParticipant.publishTrack(track);

        // Set content hint for screen content
        try {
          const mst = (track as TrackLike).mediaStreamTrack;
          if (mst && 'contentHint' in mst) {
            mst.contentHint = 'detail';
          }
        } catch {}

        // Watch for track ended (user stops via browser UI)
        this.watchTrackEnded(track);

        AVLogger.debug('screenshare.track_published', {
          kind: String((track as TrackLike).kind),
          source: String((track as TrackLike).source),
        });
      }

      this._tracks = tracks;
      this._isSharing = true;
      this._isPending = false;
      void this._beginAppNapPrevention();

      AVLogger.info('screenshare.started');
      return true;
    } catch (error) {
      AVLogger.error('screenshare.start.error', { error: String(error) });
      this._isPending = false;
      return false;
    }
  }

  /**
   * Stop screen sharing
   * @param options.preserveDesired - If true, keep _desiredSharing so screenshare
   *   can be restored after reconnect or system interruption.
   */
  async stop(options?: { preserveDesired?: boolean }): Promise<void> {
    if (this._disposed) return;

    this._clearReacquire();

    if (!options?.preserveDesired) {
      this._desiredSharing = false;
    }

    if (!this._isSharing && this._tracks.length === 0) {
      // Best-effort cleanup for desync cases where we didn't create the tracks locally
      const room = this.deps.getRoom();
      if (!room) return;
      await this.unpublishPublishedTracks(room);
      return;
    }

    AVLogger.info('screenshare.stop', { preserveDesired: !!options?.preserveDesired });

    const room = this.deps.getRoom();

    // Cleanup ended handlers
    this._cleanupTrackEndedHandlers();

    // Unpublish and stop all tracks we created
    for (const track of this._tracks) {
      try {
        if (room) {
          await room.localParticipant.unpublishTrack(track);
        }
        track.stop();
      } catch (error) {
        AVLogger.warn('screenshare.track_stop.error', { error: String(error) });
      }
    }

    this._tracks = [];
    this._isSharing = false;
    void this._endAppNapPrevention();

    // Also ensure any currently published screenshare tracks are cleaned up
    if (room) {
      await this.unpublishPublishedTracks(room);
    }

    AVLogger.info('screenshare.stopped');
  }

  /**
   * Check if currently sharing by examining published tracks
   */
  checkIsSharing(): boolean {
    const room = this.deps.getRoom();
    if (!room) return false;

    try {
      const publications = listPublications(room.localParticipant);
      return publications.some((pub) => {
        const source = readPubSource(pub);
        return source === 'screen_share' || source === 'screen_share_audio';
      });
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._clearReacquire();
    this.stop().catch(() => {});
  }

  // ============================================================================
  // Private
  // ============================================================================

  /**
   * Prevent macOS App Nap while screen sharing (Tauri desktop only).
   */
  private async _beginAppNapPrevention(): Promise<void> {
    try {
      const win = window as Window & { desktop?: DesktopBridge };
      if (typeof win.desktop?.beginActivityAssertion === 'function') {
        await win.desktop.beginActivityAssertion('Screen sharing active');
        AVLogger.debug('screenshare.app_nap_prevention.started');
      }
    } catch {}
  }

  /**
   * Allow App Nap again after screen sharing stops.
   */
  private async _endAppNapPrevention(): Promise<void> {
    try {
      const win = window as Window & { desktop?: DesktopBridge };
      if (typeof win.desktop?.endActivityAssertion === 'function') {
        await win.desktop.endActivityAssertion();
        AVLogger.debug('screenshare.app_nap_prevention.ended');
      }
    } catch {}
  }

  private async captureTracks(): Promise<LocalTrack[]> {
    const isElectron = this.isElectronEnvironment();

    if (isElectron) {
      return this.captureElectron();
    } else {
      return this.captureWeb();
    }
  }

  private isElectronEnvironment(): boolean {
    try {
      const win = window as Window & { desktop?: DesktopBridge };
      // Tauri doesn't have pickDisplaySource
      return !!(win.desktop && typeof win.desktop.pickDisplaySource === 'function');
    } catch {
      return false;
    }
  }

  private async captureElectron(): Promise<LocalTrack[]> {
    try {
      const win = window as Window & { desktop?: DesktopBridge };
      const choice = await win.desktop?.pickDisplaySource?.({ types: ['screen', 'window'] });

      if (!choice || !choice.id) {
        return [];
      }

      // Get stream using Electron's desktop capturer
      const videoConstraint: ChromeMediaConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: choice.id,
          maxFrameRate: 30,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraint as unknown as MediaTrackConstraints,
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        return [];
      }

      // Create LiveKit track with correct source
      const { LocalVideoTrack, Track } = await import('livekit-client');
      const lkTrack = new LocalVideoTrack(videoTrack, undefined, false);
      (lkTrack as LocalVideoTrackType & { source?: TrackNs.Source }).source = Track.Source.ScreenShare;

      return [lkTrack];
    } catch (error) {
      AVLogger.error('screenshare.electron.error', { error: String(error) });
      return [];
    }
  }

  private async unpublishPublishedTracks(room: Room): Promise<void> {
    try {
      const publications = listPublications(room.localParticipant);
      for (const pub of publications) {
        const source = readPubSource(pub);
        const track = pub.track;
        if (!track) continue;
        if (source !== 'screen_share' && source !== 'screen_share_audio') continue;

        try {
          await room.localParticipant.unpublishTrack(track as unknown as LocalTrack);
        } catch {}
        try {
          track.stop?.();
        } catch {}
      }
    } catch {}
  }

  private async captureWeb(): Promise<LocalTrack[]> {
    try {
      const { createLocalScreenTracks } = await import('livekit-client');

      // Try with audio first
      const videoOpts = { frameRate: 30, resolution: { width: 1920, height: 1080 } };
      try {
        const tracks = await createLocalScreenTracks({ video: videoOpts, audio: true } as unknown as Parameters<
          typeof createLocalScreenTracks
        >[0]);
        return tracks;
      } catch {
        // Fallback without audio
        const tracks = await createLocalScreenTracks({ video: videoOpts, audio: false } as unknown as Parameters<
          typeof createLocalScreenTracks
        >[0]);
        return tracks;
      }
    } catch (error) {
      // User cancelled or permission denied
      AVLogger.debug('screenshare.web.cancelled', { error: String(error) });
      return [];
    }
  }

  private watchTrackEnded(track: LocalTrack): void {
    const mst = (track as TrackLike).mediaStreamTrack;
    if (!mst) return;

    const handler = () => {
      // Determine if this was a user action or system/WebKit killing the track
      const isPageVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      const isSystemEnded = !isPageVisible;

      AVLogger.warn('screenshare.track_ended', {
        isPageVisible,
        isSystemEnded,
        readyState: mst.readyState,
      });

      if (isSystemEnded) {
        // System killed the track (App Nap, Stage Manager, etc.)
        // Do not clear _desiredSharing: restore the share when possible.
        AVLogger.warn('screenshare.ended_by_system');
        this._isSharing = false;
        void this._endAppNapPrevention();
        this._tracks = [];
        this._cleanupTrackEndedHandlers();
        // Try to re-acquire after a short delay when page becomes visible
        this._scheduleReacquire();
      } else {
        // User explicitly stopped sharing via browser UI
        AVLogger.info('screenshare.ended_by_user');
        this._desiredSharing = false;
        this.stop().catch(() => {});
      }
    };

    mst.addEventListener('ended', handler, { once: true });

    this._trackEndedCleanups.push(() => {
      mst.removeEventListener('ended', handler);
    });
  }

  /**
   * Remove all track-ended event listeners.
   */
  private _cleanupTrackEndedHandlers(): void {
    for (const cleanup of this._trackEndedCleanups) {
      try {
        cleanup();
      } catch {}
    }
    this._trackEndedCleanups = [];
  }

  /**
   * Schedule re-acquisition of screenshare when the page becomes visible again.
   * This handles macOS killing the capture track when the app goes to the background
   * (e.g. Stage Manager, App Nap).
   */
  private _scheduleReacquire(): void {
    // Clean up any existing listener
    this._clearReacquire();

    if (!this._desiredSharing || this._disposed) return;

    const handler = () => {
      if (document.visibilityState === 'visible' && this._desiredSharing && !this._isSharing && !this._isPending) {
        AVLogger.info('screenshare.reacquire_on_visible');
        this._clearReacquire();
        // Small delay to let the system settle
        this._reacquireTimer = setTimeout(() => {
          this._reacquireTimer = null;
          if (this._desiredSharing && !this._isSharing && !this._isPending) {
            this.start().catch((err) => {
              AVLogger.warn('screenshare.reacquire_failed', { error: String(err) });
            });
          }
        }, 500);
      }
    };

    this._visibilityHandler = handler;
    document.addEventListener('visibilitychange', handler);
  }

  /**
   * Clear any pending reacquire timer and visibility listener.
   */
  private _clearReacquire(): void {
    if (this._reacquireTimer) {
      clearTimeout(this._reacquireTimer);
      this._reacquireTimer = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  private cleanupTracks(tracks: LocalTrack[]): void {
    for (const track of tracks) {
      try {
        track.stop();
      } catch {}
    }
  }
}
