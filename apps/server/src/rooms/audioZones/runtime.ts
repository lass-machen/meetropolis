/**
 * Composition root + entry points for H4 audio-zone privacy.
 *
 * Bundles the per-room state (zone catalog, membership tracker, push
 * orchestrator, LiveKit admin client) and exposes the handful of
 * functions the room lifecycle/message handlers call into:
 * onJoin, onMove, onLeave, onMapChange, onZonesInvalidated.
 *
 * All of these are synchronous membership-state mutations followed by a
 * debounced Colyseus push; none of them talk to the LiveKit admin API
 * directly (that only happens in reconciler.ts on its own interval).
 */

import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';
import { getRoomTenantSlug } from '../handlers/zoneLockHandler.js';
import {
  createZoneCatalog,
  ensureZonesLoaded,
  invalidateZones,
  resolveIsland,
  type ZoneCatalog,
} from './zoneCatalog.js';
import {
  createMembershipTracker,
  onMove as trackerOnMove,
  removeMember,
  snapshot,
  type MembershipTracker,
} from './membershipTracker.js';
import { computeAffectedIdentities, membersOfIsland } from './islandModel.js';
import {
  createPermissionOrchestrator,
  disposeOrchestrator,
  scheduleAllowListPush,
  type PermissionOrchestrator,
} from './permissionOrchestrator.js';
import { createLivekitAdminClient, type LivekitAdminClient } from './livekitAdmin.js';
import { startAudioZoneReconciler } from './reconciler.js';
import { startHysteresisSweeper } from './hysteresisSweeper.js';

export interface AudioZoneRuntime {
  catalog: ZoneCatalog;
  tracker: MembershipTracker;
  orchestrator: PermissionOrchestrator;
  admin: LivekitAdminClient | null;
  reconcileInterval: ReturnType<typeof setInterval> | null;
  hysteresisSweepInterval: ReturnType<typeof setInterval> | null;
}

export function createAudioZoneRuntime(): AudioZoneRuntime {
  return {
    catalog: createZoneCatalog(),
    tracker: createMembershipTracker(),
    orchestrator: createPermissionOrchestrator(),
    admin: createLivekitAdminClient(),
    reconcileInterval: null,
    hysteresisSweepInterval: null,
  };
}

export function startAudioZoneRuntime(room: WorldRoom): void {
  room.audioZones.reconcileInterval = startAudioZoneReconciler(room);
  room.audioZones.hysteresisSweepInterval = startHysteresisSweeper(room);
}

export function stopAudioZoneRuntime(room: WorldRoom): void {
  const rt = room.audioZones;
  if (rt.reconcileInterval) {
    clearInterval(rt.reconcileInterval);
    rt.reconcileInterval = null;
  }
  if (rt.hysteresisSweepInterval) {
    clearInterval(rt.hysteresisSweepInterval);
    rt.hysteresisSweepInterval = null;
  }
  disposeOrchestrator(rt.orchestrator);
}

// Eagerly warm the zone-polygon cache for a map. Call before the first
// `trackMove`/`trackJoin` for that map (onCreate default map, onJoin,
// change_map) so island resolution never silently falls back to `open`
// just because the DB fetch hadn't landed yet.
export async function warmZoneCatalog(room: WorldRoom, mapId: string, prisma: PrismaClient): Promise<void> {
  if (!mapId) return;
  await ensureZonesLoaded(room.audioZones.catalog, mapId, getRoomTenantSlug(room), prisma);
}

// Recompute + push one player's island membership based on their current
// (mapId, x, y). Used for the regular `move` handler as well as the
// initial assignment on join and after a map change.
export function trackMove(room: WorldRoom, sessionId: string): void {
  const player = room.state.players.get(sessionId);
  if (!player || !player.identity) return;

  const rawIsland = resolveIsland(room.audioZones.catalog, player.mapId, { x: player.x, y: player.y });
  const result = trackerOnMove(room.audioZones.tracker, player.identity, rawIsland);
  if (!result.changed) return;

  const snap = snapshot(room.audioZones.tracker);
  const affected = computeAffectedIdentities(player.identity, result.oldIsland, result.newIsland, snap, snap);
  scheduleAllowListPush(room.audioZones.orchestrator, room, room.audioZones.tracker, affected);
}

// Remove a departed participant and notify whoever shared their last
// island that the allow-list shrank.
export function trackLeave(room: WorldRoom, identity: string): void {
  if (!identity) return;
  const lastIsland = removeMember(room.audioZones.tracker, identity);
  if (!lastIsland) return;
  const snap = snapshot(room.audioZones.tracker);
  const affected = membersOfIsland(lastIsland, snap);
  if (affected.length === 0) return;
  scheduleAllowListPush(room.audioZones.orchestrator, room, room.audioZones.tracker, affected);
}

// Zone geometry changed (editor_update): drop the cached polygons and
// recompute every currently-tracked player's island so stale zone shapes
// never leave a stale allow-list in place.
export async function refreshZonesAndRecompute(room: WorldRoom, mapId: string, prisma: PrismaClient): Promise<void> {
  invalidateZones(room.audioZones.catalog, mapId);
  await warmZoneCatalog(room, mapId, prisma);
  room.state.players.forEach((player, sessionId) => {
    if (player.mapId === mapId) trackMove(room, sessionId);
  });
}
