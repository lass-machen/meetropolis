/**
 * ZonePermissionsManager - applies the H4 audio-zone SFU-hard boundary
 *
 * Owns the one write path to `localParticipant.setTrackSubscriptionPermissions`.
 * Two callers:
 * - ConnectionManager.switchTo(): applies a deny-all baseline immediately
 *   on connect, before any track is published. Without this, a freshly
 *   published track would be subscribable by any client using LiveKit's
 *   default `allParticipantsAllowed: true` until the first real
 *   `av_zone_permissions` push arrives and is applied - a race window
 *   this closes entirely.
 * - The `av_zone_permissions` Colyseus handler (realtime/handlers):
 *   narrows the allow-list to the identities that currently share this
 *   client's island, on every membership transition.
 */

import type { Room } from 'livekit-client';
import type { Disposable } from '../core/types';
import { AVLogger } from '../AVLogger';
import { buildTrackPermissions } from '../core/zonePermissions';

export interface ZonePermissionsManagerDeps {
  getRoom: () => Room | null;
}

export interface ZoneAllowListPayload {
  islandId: string;
  allow: readonly string[];
}

export class ZonePermissionsManager implements Disposable {
  private _disposed = false;

  constructor(private readonly deps: ZonePermissionsManagerDeps) {}

  /**
   * Deny-all baseline: nobody may subscribe to this participant's tracks
   * until the server explicitly grants island-mates via applyAllowList().
   */
  applyDenyAll(): void {
    this.apply([], 'deny_all');
  }

  applyAllowList(payload: ZoneAllowListPayload): void {
    this.apply(payload.allow, 'allow_list', payload.islandId);
  }

  dispose(): void {
    this._disposed = true;
  }

  private apply(allow: readonly string[], reason: 'deny_all' | 'allow_list', islandId?: string): void {
    if (this._disposed) return;
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      room.localParticipant.setTrackSubscriptionPermissions(false, buildTrackPermissions(allow));
      AVLogger.debug('zone_permissions.applied', { reason, islandId, allowCount: allow.length });
    } catch (error) {
      AVLogger.warn('zone_permissions.apply.error', { reason, error: String(error) });
    }
  }
}
