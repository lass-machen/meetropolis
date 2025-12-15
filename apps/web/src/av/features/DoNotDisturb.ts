/**
 * Do Not Disturb (DND) Feature Module
 *
 * Single source of truth for DND state.
 * Handles:
 * - Saving mic/cam state before DND
 * - Disabling all tracks when DND is enabled
 * - Restoring tracks when DND is disabled
 * - Muting remote audio during DND
 */

import type { DNDState, Disposable, Unsubscribe } from '../core/types';
import { AVLogger } from '../AVLogger';

export type DNDChangeHandler = (enabled: boolean, state: DNDState) => void;

export interface DNDDeps {
  // Track control
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  stopScreenshare: () => Promise<void>;

  // Get current track state
  isMicrophoneEnabled: () => boolean;
  isCameraEnabled: () => boolean;

  // Remote audio control
  muteAllRemote: () => void;
  restoreAllRemote: () => void;
}

export class DoNotDisturb implements Disposable {
  private _state: DNDState = {
    enabled: false,
    micBeforeDND: false,
    camBeforeDND: false,
  };

  private _listeners: Set<DNDChangeHandler> = new Set();
  private _disposed = false;
  private _op: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DNDDeps) {}

  // ============================================================================
  // Public API
  // ============================================================================

  get enabled(): boolean {
    return this._state.enabled;
  }

  get state(): DNDState {
    return { ...this._state };
  }

  /**
   * Enable or disable DND
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    if (this._state.enabled === enabled) return;

    AVLogger.info('dnd.set', { enabled });

    if (enabled) this.prepareEnable();
    else this.prepareDisable();
    this.notifyListeners();

    // Side-effects run asynchronously so UI is never blocked by track operations.
    this.enqueue(async () => {
      if (enabled) await this.enableSideEffects();
      else await this.disableSideEffects();
    });
  }

  /**
   * Toggle DND state
   */
  async toggle(): Promise<boolean> {
    await this.setEnabled(!this._state.enabled);
    return this._state.enabled;
  }

  /**
   * Subscribe to DND changes
   */
  subscribe(handler: DNDChangeHandler): Unsubscribe {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._listeners.clear();
  }

  // ============================================================================
  // Private
  // ============================================================================

  private enqueue(task: () => Promise<void>): void {
    this._op = this._op.catch(() => {}).then(task);
  }

  private prepareEnable(): void {
    // IMPORTANT: Save state BEFORE disabling anything
    this._state.micBeforeDND = this.deps.isMicrophoneEnabled();
    this._state.camBeforeDND = this.deps.isCameraEnabled();

    AVLogger.debug('dnd.enable', {
      micBefore: this._state.micBeforeDND,
      camBefore: this._state.camBeforeDND,
    });

    this._state.enabled = true;
  }

  private prepareDisable(): void {
    this._state.enabled = false;
  }

  private async enableSideEffects(): Promise<void> {
    if (this._disposed) return;
    if (!this._state.enabled) return;

    // Disable local tracks
    try {
      await this.deps.setMicrophoneEnabled(false);
    } catch (error) {
      AVLogger.warn('dnd.mic_disable.error', { error: String(error) });
    }

    if (!this._state.enabled) return;

    try {
      await this.deps.setCameraEnabled(false);
    } catch (error) {
      AVLogger.warn('dnd.cam_disable.error', { error: String(error) });
    }

    if (!this._state.enabled) return;

    try {
      await this.deps.stopScreenshare();
    } catch (error) {
      AVLogger.warn('dnd.screenshare_stop.error', { error: String(error) });
    }

    if (!this._state.enabled) return;

    // Mute all remote audio immediately
    this.deps.muteAllRemote();
  }

  private async disableSideEffects(): Promise<void> {
    if (this._disposed) return;
    if (this._state.enabled) return;

    AVLogger.debug('dnd.disable', {
      restoreMic: this._state.micBeforeDND,
      restoreCam: this._state.camBeforeDND,
    });

    // Restore remote audio first
    this.deps.restoreAllRemote();

    // Restore local tracks based on saved state
    if (this._state.micBeforeDND) {
      try {
        await this.deps.setMicrophoneEnabled(true);
      } catch (error) {
        AVLogger.warn('dnd.mic_restore.error', { error: String(error) });
      }
    }

    if (this._state.enabled) return;

    if (this._state.camBeforeDND) {
      try {
        await this.deps.setCameraEnabled(true);
      } catch (error) {
        AVLogger.warn('dnd.cam_restore.error', { error: String(error) });
      }
    }

    // Reset saved state
    if (!this._state.enabled) {
      this._state.micBeforeDND = false;
      this._state.camBeforeDND = false;
    }
  }

  private notifyListeners(): void {
    const state = this.state;
    for (const handler of this._listeners) {
      try {
        handler(this._state.enabled, state);
      } catch (error) {
        AVLogger.error('dnd.listener.error', { error: String(error) });
      }
    }
  }
}
