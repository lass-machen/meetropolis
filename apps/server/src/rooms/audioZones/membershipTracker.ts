/**
 * Server-authoritative island membership with asymmetric hysteresis.
 *
 * Rule (spec H4, "fail toward privacy"):
 *  - ENTRY into a strictly more private island (open -> zone) applies
 *    immediately. No delay: privacy should tighten as fast as possible.
 *  - EXIT from a zone (zone -> open, or zone A -> zone B) applies in two
 *    steps: the departure from the old zone is immediate (other zone
 *    members stop hearing the mover right away), but the identity is
 *    parked in a per-identity "isolated" island — shared with nobody —
 *    until N consecutive samples (or a minimum elapsed time) confirm the
 *    new island. Only then is the new island's allow-list actually
 *    opened up to the mover. This absorbs polygon-edge jitter: a player
 *    standing on a zone boundary cannot flap other members' allow-lists
 *    every movement tick, and can never observe a wider audience than
 *    intended even mid-jitter.
 *
 * This module is pure/synchronous and holds no I/O; onMove() only reads
 * a pre-computed "raw island" (see zoneCatalog.ts for how that's derived
 * from position + polygon) and returns whether/how the tracked snapshot
 * changed. Colyseus/LiveKit side effects live in permissionOrchestrator.ts.
 */

import { isZoneIsland, isolatedIslandFor, type IslandSnapshot } from './islandModel.js';

interface MemberState {
  committedIsland: string;
  pendingIsland: string | null;
  pendingSince: number;
  pendingCount: number;
}

export interface MembershipTracker {
  members: Map<string, MemberState>;
}

export interface TransitionResult {
  changed: boolean;
  oldIsland: string | null;
  newIsland: string;
}

export interface HysteresisConfig {
  minSamples: number;
  minMs: number;
}

export function defaultHysteresisConfig(): HysteresisConfig {
  return {
    minSamples: Number(process.env.AUDIO_ZONE_HYSTERESIS_SAMPLES ?? 3),
    minMs: Number(process.env.AUDIO_ZONE_HYSTERESIS_MS ?? 350),
  };
}

export function createMembershipTracker(): MembershipTracker {
  return { members: new Map() };
}

export function getIsland(tracker: MembershipTracker, identity: string): string | null {
  return tracker.members.get(identity)?.committedIsland ?? null;
}

export function snapshot(tracker: MembershipTracker): IslandSnapshot {
  const out = new Map<string, string>();
  for (const [identity, state] of tracker.members) out.set(identity, state.committedIsland);
  return out;
}

const NO_CHANGE: TransitionResult = { changed: false, oldIsland: null, newIsland: '' };

function applyFirstJoin(tracker: MembershipTracker, identity: string, rawIsland: string): TransitionResult {
  tracker.members.set(identity, { committedIsland: rawIsland, pendingIsland: null, pendingSince: 0, pendingCount: 0 });
  return { changed: true, oldIsland: null, newIsland: rawIsland };
}

function resolveJitterBackIntoCommitted(state: MemberState): TransitionResult {
  if (state.pendingIsland !== null) {
    state.pendingIsland = null;
    state.pendingCount = 0;
  }
  return NO_CHANGE;
}

function applyImmediateEntry(state: MemberState, rawIsland: string): TransitionResult {
  const oldIsland = state.committedIsland;
  state.committedIsland = rawIsland;
  state.pendingIsland = null;
  state.pendingCount = 0;
  return { changed: true, oldIsland, newIsland: rawIsland };
}

// Commit a pending exit destination that has already met the hysteresis
// bar (samples or elapsed time). Shared by the confirmed branch of
// applyZoneExit (triggered by a fresh onMove sample) and
// sweepStalledExits (triggered by elapsed time alone, with no fresh
// sample) so both paths produce identical transitions.
function commitPending(state: MemberState): TransitionResult {
  const priorIsland = state.committedIsland;
  const newIsland = state.pendingIsland as string;
  state.committedIsland = newIsland;
  state.pendingIsland = null;
  state.pendingCount = 0;
  return { changed: true, oldIsland: priorIsland, newIsland };
}

// Committed island is a zone and the raw reading disagrees: close the old
// zone immediately (isolate), then accumulate hysteresis samples toward
// the raw island before committing to it.
function applyZoneExit(
  state: MemberState,
  identity: string,
  rawIsland: string,
  now: number,
  cfg: HysteresisConfig,
): TransitionResult {
  const isolated = isolatedIslandFor(identity);
  const oldIsland = state.committedIsland;
  const justIsolated = oldIsland !== isolated;
  if (justIsolated) state.committedIsland = isolated;

  if (state.pendingIsland !== rawIsland) {
    state.pendingIsland = rawIsland;
    state.pendingSince = now;
    state.pendingCount = 1;
  } else {
    state.pendingCount += 1;
  }

  const confirmed = state.pendingCount >= cfg.minSamples || now - state.pendingSince >= cfg.minMs;
  if (confirmed) return commitPending(state);
  if (justIsolated) return { changed: true, oldIsland, newIsland: isolated };
  return NO_CHANGE;
}

/**
 * Record a fresh position-derived island reading for `identity`. Returns
 * whether the tracker's committed snapshot changed and, if so, the
 * old/new island pair to feed into islandModel.computeAffectedIdentities.
 */
export function onMove(
  tracker: MembershipTracker,
  identity: string,
  rawIsland: string,
  now: number = Date.now(),
  cfg: HysteresisConfig = defaultHysteresisConfig(),
): TransitionResult {
  const state = tracker.members.get(identity);
  if (!state) return applyFirstJoin(tracker, identity, rawIsland);
  if (rawIsland === state.committedIsland) return resolveJitterBackIntoCommitted(state);

  // "Mid-exit" covers both a still-committed zone AND the isolated
  // sentinel a previous call may have parked this identity in. Any raw
  // reading while mid-exit — including one that points back at a zone —
  // stays hysteresis-gated until confirmed; only a genuinely settled
  // `open` commitment gets the fast, no-delay "entry" path. This matches
  // the spec's explicit A->B rule (exit closes immediately, the next
  // island only opens after hysteresis) rather than re-deriving it from
  // the more general "entry into a zone is always immediate" heuristic,
  // which would let a jittering zone-to-zone move skip the debounce.
  const midExit = isZoneIsland(state.committedIsland) || state.committedIsland === isolatedIslandFor(identity);
  if (!midExit) return applyImmediateEntry(state, rawIsland);
  return applyZoneExit(state, identity, rawIsland, now, cfg);
}

// Remove a departed participant entirely (onLeave). Returns their last
// committed island so the caller can notify former islandmates.
export function removeMember(tracker: MembershipTracker, identity: string): string | null {
  const state = tracker.members.get(identity);
  tracker.members.delete(identity);
  return state?.committedIsland ?? null;
}

export interface StalledExit {
  identity: string;
  transition: TransitionResult;
}

/**
 * Advance every member parked mid-exit whose pending destination has been
 * stable for at least `cfg.minMs`, without requiring a fresh onMove
 * sample. onMove() only re-evaluates a pending exit's confirmation when a
 * new position sample arrives, and trackMove() is only ever called from
 * movement, join, map-switch, or editor recompute - never from a timer.
 * A player who exits a zone and then stands still would otherwise stay
 * parked in the isolated:<identity> sentinel forever, cut off from
 * open-world audio/video with no recovery trigger. Call this on its own
 * short interval (see hysteresisSweeper.ts), independent of movement.
 */
export function sweepStalledExits(tracker: MembershipTracker, now: number, cfg: HysteresisConfig): StalledExit[] {
  const out: StalledExit[] = [];
  for (const [identity, state] of tracker.members) {
    if (state.pendingIsland === null) continue;
    if (now - state.pendingSince < cfg.minMs) continue;
    out.push({ identity, transition: commitPending(state) });
  }
  return out;
}
