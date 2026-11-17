/**
 * ZonePermissionsManager - applies the H4 audio-zone SFU-hard boundary
 *
 * Owns the one write path to `localParticipant.setTrackSubscriptionPermissions`.
 * It stores the last server allow-list so ConnectionManager.switchTo() can
 * restore it via applyBaseline() on a fresh room (deny-all when no list was
 * received yet), before any track is published. If applying permissions
 * fails, it disconnects the room fail-closed instead of leaving a wider
 * previous list in place at the SFU. The `av_zone_permissions` Colyseus
 * handler (realtime/handlers) narrows the allow-list to the identities
 * that currently share this client's island, on every membership transition.
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
  private lastAllowList: { islandId: string; allow: string[] } | null = null;

  constructor(private readonly deps: ZonePermissionsManagerDeps) {}

  /**
   * Deny-all baseline: nobody may subscribe to this participant's tracks
   * until the server explicitly grants island-mates via applyAllowList().
   */
  applyDenyAll(): void {
    this.apply([], 'deny_all');
  }

  applyBaseline(): void {
    if (this.lastAllowList) {
      this.apply(this.lastAllowList.allow, 'restore', this.lastAllowList.islandId);
    } else {
      this.apply([], 'deny_all');
    }
  }

  applyAllowList(payload: ZoneAllowListPayload): void {
    if (this._disposed) return;
    this.lastAllowList = { islandId: payload.islandId, allow: [...payload.allow] };
    this.apply(this.lastAllowList.allow, 'allow_list', this.lastAllowList.islandId);
  }

  dispose(): void {
    this._disposed = true;
    this.lastAllowList = null;
  }

  private apply(allow: readonly string[], reason: 'deny_all' | 'allow_list' | 'restore', islandId?: string): void {
    if (this._disposed) return;
    const room = this.deps.getRoom();
    if (!room) return;

    try {
      room.localParticipant.setTrackSubscriptionPermissions(false, buildTrackPermissions(allow));
      AVLogger.debug('zone_permissions.applied', { reason, islandId, allowCount: allow.length });
    } catch (error) {
      AVLogger.error('zone_permissions.apply.error', { reason, error: String(error) });
      // Disconnect fail-closed: a failed narrowing would leave the previous, wider
      // list at the SFU; the existing reconnect logic rebuilds and applies the
      // baseline before every publish.
      try {
        void room.disconnect().catch(() => {});
      } catch {}
    }
  }
}
