/**
 * Periodic drift correction for H4 audio-zone privacy (defense-in-depth).
 *
 * The primary, SFU-hard boundary is the publisher's own
 * `setTrackSubscriptionPermissions` (apps/web/src/av — applied on every
 * room connect as an immediate deny-all, then narrowed to the current
 * island's allow-list on each `av_zone_permissions` Colyseus push). That
 * boundary does not depend on this module, on the LiveKit admin API, or
 * on any admin credentials being configured at all — see
 * livekitAdmin.ts's module doc.
 *
 * This module runs two independent correction loops on the same
 * interval, with different availability requirements:
 *
 * - Colyseus repush (`rePushAllForRoom`, always runs): heals a publisher
 *   who never applied a fresh `av_zone_permissions` push at all — most
 *   commonly a client that reconnects to LiveKit (ConnectionManager.
 *   switchTo, e.g. after SIGNAL_LOST) without any Colyseus-side
 *   membership transition happening in between. The client re-applies a
 *   deny-all baseline on every such reconnect, but nothing re-triggers a
 *   push if the player didn't cross a zone boundary meanwhile — see
 *   membershipTracker.ts's onMove(), which only pushes on a *change*.
 *   This is a pure Colyseus send; it needs no LiveKit admin credentials
 *   and must not be gated behind `admin` being configured, or the exact
 *   deployments most likely to skip optional admin credentials (minimal
 *   OSS installs) would silently lose this heal entirely.
 * - LiveKit forced-unsubscribe (`correctCrossIslandSubscriptions`, only
 *   when `admin` is configured): polls LiveKit's actual subscriber graph
 *   and forces cross-island pairs apart via
 *   `updateSubscriptions(..., subscribe=false)`. This is the layer that
 *   needs the admin API, and it heals what the Colyseus repush cannot: a
 *   publisher running an old/never-updated client that never applies the
 *   permission at all (see H4 spec risk #1 — closing that gap fully
 *   requires a minimum client-version gate, a product decision, not
 *   something this server module can enforce).
 *
 * `updateSubscriptions` is itself fail-open by LiveKit's own semantics
 * (a determined/adaptive subscriber can re-request), so even as a
 * defense-in-depth layer this is a correction loop, not a guarantee —
 * see livekitAdmin.ts's module doc and H4 spec risk #6. On any admin-API
 * failure this module never widens access; it only skips that one
 * correction and retries next cycle. Because the primary boundary
 * already defaults to deny-all independent of this module, an admin-API
 * outage here does not itself open access — it only means a
 * non-applying client goes uncorrected for the duration of the outage.
 */

import type { ParticipantInfo } from 'livekit-server-sdk';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { getActiveWorldRooms } from '../WorldRoom.js';
import { getRoomTenantSlug } from '../handlers/zoneLockHandler.js';
import { snapshot } from './membershipTracker.js';
import { rePushAllForRoom } from './permissionOrchestrator.js';
import type { LivekitAdminClient } from './livekitAdmin.js';

const RECONCILE_INTERVAL_MS = Number(process.env.AUDIO_ZONE_RECONCILE_INTERVAL_MS ?? 4000);

export function startAudioZoneReconciler(room: WorldRoom): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void reconcileOnce(room).catch((e) => logger.error('[AudioZones] reconcile cycle crashed', e));
  }, RECONCILE_INTERVAL_MS);
}

// Merge every same-tenant WorldRoom shard's local membership tracker into
// one "desired" island snapshot. Multiple shards can back one tenant once
// maxClients is exceeded, but they all publish into the same LiveKit room
// (`<tenant>:world`) — the reconciler must see the whole tenant.
// Every shard runs its own reconcile loop and reaches the same
// conclusion (idempotent corrections); see H4 spec risk #4 for the known
// cost of this (no single-leader election yet — architecture debt, not a
// correctness gap).
export function buildTenantSnapshot(tenantSlug: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const candidate of getActiveWorldRooms()) {
    if (getRoomTenantSlug(candidate) !== tenantSlug) continue;
    for (const [identity, island] of snapshot(candidate.audioZones.tracker)) merged.set(identity, island);
  }
  return merged;
}

async function correctCrossIslandSubscriptions(
  admin: LivekitAdminClient,
  roomName: string,
  participants: ParticipantInfo[],
  desired: Map<string, string>,
): Promise<void> {
  for (const publisher of participants) {
    const publisherIsland = desired.get(publisher.identity);
    // Untracked identity (npc-* not yet wired into audio-zone membership,
    // or a stale LiveKit participant): do not touch, see H4 spec risk #9.
    if (!publisherIsland) continue;
    const trackSids = publisher.tracks.map((t) => t.sid);
    if (trackSids.length === 0) continue;

    for (const subscriber of participants) {
      if (subscriber.identity === publisher.identity) continue;
      if (desired.get(subscriber.identity) === publisherIsland) continue;
      try {
        await admin.updateSubscriptions(roomName, subscriber.identity, trackSids, false);
      } catch (e) {
        logger.warn('[AudioZones] reconciler could not force-unsubscribe a cross-island pair; retrying next cycle', e);
      }
    }
  }
}

async function runLivekitAdminCorrection(admin: LivekitAdminClient, room: WorldRoom): Promise<void> {
  const tenantSlug = getRoomTenantSlug(room);
  const roomName = `${tenantSlug}:world`;
  const desired = buildTenantSnapshot(tenantSlug);

  let participants: ParticipantInfo[];
  try {
    participants = await admin.listParticipants(roomName);
  } catch (e) {
    logger.warn('[AudioZones] reconciler could not list participants; skipping cycle (fail-closed, no widening)', e);
    return;
  }

  await correctCrossIslandSubscriptions(admin, roomName, participants, desired);
}

export async function reconcileOnce(room: WorldRoom): Promise<void> {
  const admin = room.audioZones.admin;
  // No admin credentials configured: only the LiveKit forced-unsubscribe
  // layer is disabled here (fail-closed — it only ever narrows access, so
  // skipping it cannot widen anything). The Colyseus repush below is a
  // separate, always-available heal and must run regardless — see this
  // module's doc comment for why gating it behind `admin` would be wrong.
  if (admin) await runLivekitAdminCorrection(admin, room);

  // Heal any `av_zone_permissions` push a publisher never (re-)applied,
  // most commonly after a LiveKit-level reconnect with no intervening
  // zone-membership change. Pure Colyseus send; no admin API involved.
  rePushAllForRoom(room.audioZones.orchestrator, room, room.audioZones.tracker);
}
