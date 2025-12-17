/**
 * Screenshare Feature Module
 *
 * Handles screen sharing logic including:
 * - Web browser screenshare via getDisplayMedia
 * - Electron app screenshare via custom picker
 * - Auto-stop when user ends share via browser UI
 */

import type { Room, LocalTrack } from 'livekit-client';
import type { Disposable } from '../core/types';
import { AVLogger } from '../AVLogger';

export interface ScreenshareDeps {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  ensureConnected: () => Promise<void>;
  waitForConnected: (timeoutMs?: number) => Promise<boolean>;
}

export class Screenshare implements Disposable {
  private _isSharing = false;
  private _isPending = false;
  private _tracks: LocalTrack[] = [];
  private _trackEndedCleanups: Array<() => void> = [];
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
        const connected = await this.deps.waitForConnected(8000);

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
          const mst = (track as any).mediaStreamTrack;
          if (mst && 'contentHint' in mst) {
            mst.contentHint = 'detail';
          }
        } catch {}

        // Watch for track ended (user stops via browser UI)
        this.watchTrackEnded(track);

        AVLogger.debug('screenshare.track_published', {
          kind: (track as any).kind,
          source: (track as any).source,
        });
      }

      this._tracks = tracks;
      this._isSharing = true;
      this._isPending = false;

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
   */
  async stop(): Promise<void> {
    if (this._disposed) return;
    if (!this._isSharing && this._tracks.length === 0) {
      // Best-effort cleanup for desync cases where we didn't create the tracks locally
      const room = this.deps.getRoom();
      if (!room) return;
      await this.unpublishPublishedTracks(room);
      return;
    }

    AVLogger.info('screenshare.stop');

    const room = this.deps.getRoom();

    // Cleanup ended handlers
    for (const cleanup of this._trackEndedCleanups) {
      try {
        cleanup();
      } catch {}
    }
    this._trackEndedCleanups = [];

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
      const publications = Array.from(room.localParticipant.trackPublications.values());
      return publications.some((pub: any) => {
        const source = pub.source ?? pub.track?.source;
        return source === 'screen_share' || source === 'screen_share_audio';
      });
    } catch {
      return false;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this.stop().catch(() => {});
  }

  // ============================================================================
  // Private
  // ============================================================================

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
      const win = window as any;
      // Tauri doesn't have pickDisplaySource
      return !!(win.desktop && typeof win.desktop.pickDisplaySource === 'function');
    } catch {
      return false;
    }
  }

  private async captureElectron(): Promise<LocalTrack[]> {
    try {
      const win = window as any;
      const choice = await win.desktop.pickDisplaySource({ types: ['screen', 'window'] });

      if (!choice || !choice.id) {
        return [];
      }

      // Get stream using Electron's desktop capturer
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: choice.id,
            maxFrameRate: 30,
          },
        } as any,
      } as any);

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        return [];
      }

      // Create LiveKit track with correct source
      const { LocalVideoTrack, Track } = await import('livekit-client');
      const lkTrack = new LocalVideoTrack(videoTrack, undefined, false);
      (lkTrack as any).source = Track.Source.ScreenShare;

      return [lkTrack];

    } catch (error) {
      AVLogger.error('screenshare.electron.error', { error: String(error) });
      return [];
    }
  }

  private async unpublishPublishedTracks(room: Room): Promise<void> {
    try {
      const publications = Array.from(room.localParticipant.trackPublications.values()) as any[];
      for (const pub of publications) {
        const source = pub?.source ?? pub?.track?.source;
        const track = pub?.track;
        if (!track) continue;
        if (source !== 'screen_share' && source !== 'screen_share_audio') continue;

        try {
          await room.localParticipant.unpublishTrack(track);
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
      try {
        const tracks = await createLocalScreenTracks({
          video: {
            frameRate: 30,
            resolution: { width: 1920, height: 1080 },
          } as any,
          audio: true,
        });

        return tracks;

      } catch {
        // Fallback without audio
        const tracks = await createLocalScreenTracks({
          video: {
            frameRate: 30,
            resolution: { width: 1920, height: 1080 },
          } as any,
          audio: false,
        });

        return tracks;
      }

    } catch (error) {
      // User cancelled or permission denied
      AVLogger.debug('screenshare.web.cancelled', { error: String(error) });
      return [];
    }
  }

  private watchTrackEnded(track: LocalTrack): void {
    const mst = (track as any).mediaStreamTrack;
    if (!mst) return;

    const handler = () => {
      AVLogger.info('screenshare.ended_by_user');
      this.stop().catch(() => {});
    };

    mst.addEventListener('ended', handler, { once: true });

    this._trackEndedCleanups.push(() => {
      mst.removeEventListener('ended', handler);
    });
  }

  private cleanupTracks(tracks: LocalTrack[]): void {
    for (const track of tracks) {
      try {
        track.stop();
      } catch {}
    }
  }
}
