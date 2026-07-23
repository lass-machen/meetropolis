/**
 * Periodic timer that advances stalled exit-hysteresis transitions (H4
 * audio-zone privacy) independent of player movement.
 *
 * membershipTracker.onMove() only re-checks a pending exit's confirmation
 * (N samples OR minMs elapsed) when a fresh position sample arrives, and
 * trackMove() (runtime.ts) is only ever invoked from the move handler,
 * join, map-switch, or editor recompute - never from a timer. A player
 * who exits a zone and then stops moving would otherwise stay parked in
 * the isolated:<identity> sentinel forever: cut off from open-world
 * audio/video with no recovery trigger. This sweeper runs on its own
 * short interval, independent of both movement and the slower (LiveKit
 * admin-API-bound) reconciler, so a stalled exit resolves within one
 * sweep interval of the hysteresis window closing.
 */

import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { computeAffectedIdentities } from './islandModel.js';
import { defaultHysteresisConfig, snapshot, sweepStalledExits } from './membershipTracker.js';
import { scheduleAllowListPush } from './permissionOrchestrator.js';

const SWEEP_INTERVAL_MS = Number(process.env.AUDIO_ZONE_HYSTERESIS_SWEEP_MS ?? 200);

export function startHysteresisSweeper(room: WorldRoom): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      sweepOnce(room);
    } catch (e) {
      logger.error('[AudioZones] hysteresis sweep crashed', e);
    }
  }, SWEEP_INTERVAL_MS);
}

export function sweepOnce(room: WorldRoom): void {
  const stalled = sweepStalledExits(room.audioZones.tracker, Date.now(), defaultHysteresisConfig());
  if (stalled.length === 0) return;

  const snap = snapshot(room.audioZones.tracker);
  for (const { identity, transition } of stalled) {
    const affected = computeAffectedIdentities(identity, transition.oldIsland, transition.newIsland, snap, snap);
    scheduleAllowListPush(room.audioZones.orchestrator, room, room.audioZones.tracker, affected);
  }
}
