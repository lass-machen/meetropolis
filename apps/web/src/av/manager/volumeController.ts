/**
 * VolumeController - Coordinates volume and DND features
 */

import type { Disposable } from '../core/types';
import type { DoNotDisturbInterface, SubscriptionManagerInterface } from './types';

export interface VolumeControllerDeps {
  dnd: DoNotDisturbInterface;
  subscriptionManager: SubscriptionManagerInterface;
}

export class VolumeController implements Disposable {
  private _disposed = false;

  constructor(private readonly deps: VolumeControllerDeps) {}

  get dndEnabled(): boolean {
    return this.deps.dnd.enabled;
  }

  async setDoNotDisturb(enabled: boolean): Promise<void> {
    if (this._disposed) return;
    await this.deps.dnd.setEnabled(enabled);
  }

  setParticipantVolume(identity: string, volume: number): void {
    if (this._disposed) return;
    this.deps.subscriptionManager.setParticipantVolume(identity, volume);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
  }
}
