/**
 * PublishingManager - Delegates track publishing to TrackManager
 */

import type { Disposable } from '../core/types';
import type { TrackManagerInterface, DoNotDisturbInterface } from './types';
import { AVLogger } from '../AVLogger';

export interface PublishingManagerDeps {
  trackManager: TrackManagerInterface;
  dnd: DoNotDisturbInterface;
}

export class PublishingManager implements Disposable {
  private _disposed = false;

  constructor(private readonly deps: PublishingManagerDeps) {}

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    if (this.deps.dnd.enabled && enabled) {
      AVLogger.debug('manager.mic.blocked_by_dnd');
      return;
    }
    await this.deps.trackManager.setMicrophoneEnabled(enabled);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    if (this.deps.dnd.enabled && enabled) {
      AVLogger.debug('manager.cam.blocked_by_dnd');
      return;
    }
    await this.deps.trackManager.setCameraEnabled(enabled);
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    if (this._disposed) return;
    await this.deps.trackManager.useMicrophoneDevice(deviceId);
  }

  async republishMicrophone(): Promise<void> {
    if (this._disposed) return;
    if (this.deps.dnd.enabled) {
      AVLogger.debug('manager.mic.republish.blocked_by_dnd');
      return;
    }
    await this.deps.trackManager.republishMicrophone();
  }

  async useCameraDevice(deviceId: string): Promise<void> {
    if (this._disposed) return;
    await this.deps.trackManager.useCameraDevice(deviceId);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
  }
}
